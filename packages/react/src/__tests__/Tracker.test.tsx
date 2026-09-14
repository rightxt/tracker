// @vitest-environment jsdom

import { StrictMode, Suspense, act, createRef, startTransition } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Tracker } from '../Tracker.js';

import type { TrackerHandle } from '../Tracker.js';
import type { ReactElement } from 'react';

/** Deterministic options used by Tracker DOM tests. */
const TEST_OPTIONS = {
  a11y: { enabled: true, keyboard: true },
  clustering: { enabled: false },
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
} as const;

/** Flushes React work and deferred lifecycle destruction. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe('React Tracker', () => {
  it('hydrates the deterministic server shell without a recoverable mismatch before applying client runtime state', async () => {
    const tracker = <Tracker options={{ orientation: 'horizontal' }} />;
    const serverHtml = renderToString(tracker);

    // Only the documented server invariants: a hidden, non-interactive shell
    // without geometry or projected markers. Configured orientation/placement
    // is explicitly not an authoritative server output.
    expect(serverHtml).toContain('data-rxtt-geometry="unavailable"');
    expect(serverHtml).toContain('aria-disabled="true"');

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.append(container);

    expect(container.querySelector('.rxtt')).not.toBeNull();
    expect(container.querySelector('.rxtt__marker')).toBeNull();

    const onRecoverableError = vi.fn();
    const root = hydrateRoot(container, tracker, { onRecoverableError });

    await flush();

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector('.rxtt')?.getAttribute('data-rxtt-orientation')).toBe('horizontal');

    await act(async () => root.unmount());
    await flush();
  });

  it('keeps keyed item nodes stable during an isolated selection transition', async () => {
    const container = document.createElement('div');
    const sourceRoot = document.createElement('main');
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    const root = createRoot(container);

    firstTarget.className = 'selection-target';
    secondTarget.className = 'selection-target';
    sourceRoot.append(firstTarget, secondTarget);
    document.body.append(sourceRoot, container);

    await act(async () => {
      root.render(
        <Tracker options={TEST_OPTIONS} rules={[{ selector: '.selection-target' }]} sourceRoot={sourceRoot} />,
      );
    });

    const trackerRoot = container.querySelector<HTMLElement>('.rxtt');
    const before = [...container.querySelectorAll<HTMLElement>('.rxtt__marker')];

    expect(before).toHaveLength(2);
    expect(before[0]?.getAttribute('data-rxtt-selected')).toBe('true');

    await act(async () => {
      trackerRoot?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    });

    const after = [...container.querySelectorAll<HTMLElement>('.rxtt__marker')];

    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[0]?.hasAttribute('data-rxtt-selected')).toBe(false);
    expect(after[1]?.getAttribute('data-rxtt-selected')).toBe('true');

    await act(async () => root.unmount());
    await flush();
  });

  it('exposes one React ref handle for the mounted runtime generation and its terminal lifetime', async () => {
    const container = document.createElement('div');
    const handle = createRef<TrackerHandle>();
    const root = createRoot(container);

    document.body.append(container);

    await act(async () => {
      root.render(<Tracker options={TEST_OPTIONS} ref={handle} />);
    });

    expect(handle.current).not.toBeNull();
    expect(handle.current?.getState()).toBe('mounted');

    const completedBefore = handle.current?.getStats().renders.completed ?? 0;

    await act(async () => handle.current?.refresh());

    expect(handle.current?.getState()).toBe('mounted');
    expect(handle.current?.getStats().renders.completed ?? 0).toBeGreaterThan(completedBefore);

    const destroyed = handle.current?.whenRuntimeDestroyed();

    expect(handle.current?.whenRuntimeDestroyed()).toBe(destroyed);

    await act(async () => root.unmount());
    await flush();

    expect(handle.current).toBeNull();
    await expect(destroyed).resolves.toBeUndefined();
  });

  it('survives Strict Mode effect replay without retiring the active generation', async () => {
    const container = document.createElement('div');
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');
    const handle = createRef<TrackerHandle>();
    const root = createRoot(container);

    target.className = 'strict-mode-target';
    sourceRoot.append(target);
    document.body.append(sourceRoot, container);

    await act(async () => {
      root.render(
        <StrictMode>
          <Tracker
            options={TEST_OPTIONS}
            ref={handle}
            rules={[{ selector: '.strict-mode-target' }]}
            sourceRoot={sourceRoot}
          />
        </StrictMode>,
      );
    });
    await flush();

    expect(handle.current?.getState()).toBe('mounted');
    expect(container.querySelectorAll('.rxtt__marker')).toHaveLength(1);

    await act(async () => handle.current?.refresh());
    expect(handle.current?.getState()).toBe('mounted');

    await act(async () => root.unmount());
    await flush();
  });

  it('updates callback props only when their React render commits, without replacing the runtime', async () => {
    const container = document.createElement('div');
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');
    const callbackA = vi.fn();
    const callbackB = vi.fn();
    const callbackC = vi.fn();
    const root = createRoot(container);

    target.className = 'callback-commit-target';
    sourceRoot.append(target);
    document.body.append(sourceRoot, container);

    let resolveSuspense: () => void = () => {};
    const suspensePromise = new Promise<void>((resolve) => {
      resolveSuspense = resolve;
    });
    let shouldSuspend = false;

    function SuspendingSibling(): null {
      if (shouldSuspend) {
        throw suspensePromise;
      }

      return null;
    }

    function Harness({ onMarkerActivate }: { onMarkerActivate: (payload: unknown) => void }): ReactElement {
      return (
        <Suspense fallback={<div data-testid="fallback" />}>
          <Tracker
            onMarkerActivate={onMarkerActivate}
            options={TEST_OPTIONS}
            rules={[{ selector: '.callback-commit-target' }]}
            sourceRoot={sourceRoot}
          />
          <SuspendingSibling />
        </Suspense>
      );
    }

    const activateMarker = async (): Promise<void> => {
      await act(async () => {
        container.querySelector('.rxtt__marker')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      });
    };

    // Initial committed callback A.
    await act(async () => {
      root.render(<Harness onMarkerActivate={callbackA} />);
    });
    const trackerRoot = container.querySelector('.rxtt');

    expect(trackerRoot).not.toBeNull();
    expect(container.querySelector('[data-testid="fallback"]')).toBeNull();

    // Ordinary committed re-render swaps callback A for callback B.
    await act(async () => {
      root.render(<Harness onMarkerActivate={callbackB} />);
    });
    await activateMarker();

    expect(callbackA).not.toHaveBeenCalled();
    expect(callbackB).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.rxtt')).toBe(trackerRoot);

    // Suspended, uncommitted transition proposing callback C.
    shouldSuspend = true;
    await act(async () => {
      startTransition(() => {
        root.render(<Harness onMarkerActivate={callbackC} />);
      });
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="fallback"]')).toBeNull();
    expect(container.querySelector('.rxtt')).toBe(trackerRoot);

    await activateMarker();

    expect(callbackB).toHaveBeenCalledTimes(2);
    expect(callbackC).not.toHaveBeenCalled();

    // The transition commits once the sibling stops suspending.
    shouldSuspend = false;
    resolveSuspense();
    await flush();

    await activateMarker();

    expect(callbackC).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.rxtt')).toBe(trackerRoot);

    await act(async () => root.unmount());
    await flush();
  });

  it('applies simultaneous rules and sourceRoot props coherently in one React remount', async () => {
    const container = document.createElement('div');
    const firstSource = document.createElement('main');
    const secondSource = document.createElement('main');
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    const root = createRoot(container);

    firstTarget.className = 'first-source-target';
    secondTarget.className = 'second-source-target';
    firstSource.append(firstTarget);
    secondSource.append(secondTarget);
    document.body.append(firstSource, secondSource, container);

    await act(async () => {
      root.render(
        <Tracker options={TEST_OPTIONS} rules={[{ selector: '.first-source-target' }]} sourceRoot={firstSource} />,
      );
    });
    const trackerRoot = container.querySelector('.rxtt');

    await act(async () => {
      root.render(
        <Tracker options={TEST_OPTIONS} rules={[{ selector: '.second-source-target' }]} sourceRoot={secondSource} />,
      );
    });

    expect(container.querySelector('.rxtt')).toBe(trackerRoot);
    expect(container.querySelectorAll('.rxtt__marker')).toHaveLength(1);

    await act(async () => root.unmount());
    await flush();
  });

  it('destroys its generation after a cross-realm remount failure', async () => {
    const iframe = document.createElement('iframe');
    const container = document.createElement('div');
    const sourceRoot = document.createElement('main');
    const handleBox: { current: TrackerHandle | null } = { current: null };
    const root = createRoot(container);
    const captureHandle = (handle: TrackerHandle | null): void => {
      if (handle !== null) {
        handleBox.current = handle;
      }
    };

    document.body.append(iframe, sourceRoot, container);
    await act(async () => {
      root.render(<Tracker options={TEST_OPTIONS} ref={captureHandle} sourceRoot={sourceRoot} />);
    });
    const retiredHandle = handleBox.current;
    const foreignSource = iframe.contentDocument?.body;

    if (foreignSource === undefined || foreignSource === null) {
      throw new Error('Expected an iframe source document.');
    }

    await expect(
      act(async () => {
        root.render(<Tracker options={TEST_OPTIONS} ref={captureHandle} sourceRoot={foreignSource} />);
      }),
    ).rejects.toMatchObject({ code: 'ERR_TRACKER_REALM_MISMATCH', name: 'TrackerLifecycleError' });
    await flush();

    expect(retiredHandle?.getState()).toBe('destroyed');
    expect(container.querySelector('.rxtt__marker')).toBeNull();
  });

  it('fails closed and retires the committed React runtime when a rules update becomes null', async () => {
    const container = document.createElement('div');
    const sourceRoot = document.createElement('main');
    const target = document.createElement('div');
    const handleBox: { current: TrackerHandle | null } = { current: null };
    const root = createRoot(container);
    const captureHandle = (handle: TrackerHandle | null): void => {
      if (handle !== null) {
        handleBox.current = handle;
      }
    };

    target.className = 'react-rules-update-target';
    sourceRoot.append(target);
    document.body.append(sourceRoot, container);
    await act(async () => {
      root.render(
        <Tracker
          options={TEST_OPTIONS}
          ref={captureHandle}
          rules={[{ selector: '.react-rules-update-target' }]}
          sourceRoot={sourceRoot}
        />,
      );
    });
    const retiredHandle = handleBox.current;

    expect(container.querySelectorAll('.rxtt__marker')).toHaveLength(1);

    await expect(
      act(async () => {
        root.render(
          <Tracker
            options={TEST_OPTIONS}
            ref={captureHandle}
            // @ts-expect-error - intentional invalid declarative rules input for render-phase fail-closed coverage
            rules={null}
            sourceRoot={sourceRoot}
          />,
        );
      }),
    ).rejects.toMatchObject({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' });
    await flush();

    expect(retiredHandle?.getState()).toBe('destroyed');
    expect(container.querySelector('.rxtt__marker')).toBeNull();
  });
});
