// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrackerSnapshot } from '../../types.js';
import { createTrackerStateIntegration } from '../../__tests__/testIntegration.js';

const disabledUpdateOptions = {
  clustering: { enabled: false },
  updates: {
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
    interval: { enabled: false },
  },
};

/** Removes test-owned roots and restores spies after each scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * A rule `label` resolver runs synchronously, inside `performTrackerInstanceRender()`,
 * while Core is still building the initial mount transaction: `instance.mounted` is
 * already `true` (it must be, for that same render call to execute at all), but
 * `instance.lifecycleState` is still `'mounting'` and `runtimeContext` is still `null`
 * because the render, rule revalidation, and context commit have not finished yet.
 * This is the concrete, reachable transition window: any public accessor
 * invoked from inside such a callback must report the instance as not-yet-mounted.
 */
describe('public mount accessors stay consistent during the initial mount transaction', () => {
  it('reports not-mounted from getState/isMounted/getRoot/getSnapshot while a rule label resolver runs mid-mount, and mounted once mount() returns', () => {
    const sourceRoot = document.createElement('div');
    const renderRoot = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'label-mid-mount-target';
    sourceRoot.appendChild(target);
    document.body.append(sourceRoot, renderRoot);

    let observedDuringLabel: {
      state: string;
      isMounted: boolean;
      root: HTMLElement | null;
      snapshotMounted: boolean;
      snapshotLifecycleMounted: boolean;
    } | null = null;
    let snapshotDuringLabel: TrackerSnapshot | null = null;

    const runtime = createTrackerStateIntegration({
      options: disabledUpdateOptions,
      rules: [
        {
          selector: '.label-mid-mount-target',
          label: () => {
            snapshotDuringLabel = runtime.getSnapshot();
            observedDuringLabel = {
              state: runtime.getState(),
              isMounted: runtime.isMounted(),
              root: runtime.getRoot(),
              snapshotMounted: snapshotDuringLabel.mounted,
              snapshotLifecycleMounted: snapshotDuringLabel.lifecycle.mounted,
            };

            return null;
          },
        },
      ],
    });

    runtime.mount({ renderRoot, sourceRoot });

    expect(observedDuringLabel).toEqual({
      state: 'unmounted',
      isMounted: false,
      // The renderer root is bound synchronously before the render transaction
      // starts, so it is already observable here even though the mount as a
      // whole has not committed yet.
      root: renderRoot,
      snapshotMounted: false,
      snapshotLifecycleMounted: false,
    });
    expect(runtime.getState()).toBe('mounted');
    expect(runtime.isMounted()).toBe(true);
    expect(runtime.getRoot()).toBe(renderRoot);
    expect(runtime.getSnapshot().mounted).toBe(true);
    expect(runtime.getSnapshot().lifecycle.mounted).toBe(true);
    // The snapshot cache only advances once the mount transaction fully
    // commits, so the post-mount snapshot must be a distinct object from the
    // one observed mid-render.
    expect(runtime.getSnapshot()).not.toBe(snapshotDuringLabel);

    runtime.destroy();
    sourceRoot.remove();
    renderRoot.remove();
  });

  it('reuses the exact pre-mount snapshot object while a rule label resolver runs mid-mount, when getSnapshot() was already called before mount()', () => {
    const sourceRoot = document.createElement('div');
    const renderRoot = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'label-primed-cache-target';
    sourceRoot.appendChild(target);
    document.body.append(sourceRoot, renderRoot);

    const capturedDuringLabel: { snapshot: TrackerSnapshot | null } = { snapshot: null };

    const runtime = createTrackerStateIntegration({
      options: disabledUpdateOptions,
      rules: [
        {
          selector: '.label-primed-cache-target',
          label: () => {
            capturedDuringLabel.snapshot = runtime.getSnapshot();

            return null;
          },
        },
      ],
    });

    const primedSnapshot = runtime.getSnapshot();

    expect(primedSnapshot.mounted).toBe(false);

    runtime.mount({ renderRoot, sourceRoot });

    // The snapshot cache is not invalidated until the mount transaction
    // commits, so a resolver reading getSnapshot() mid-mount must observe the
    // exact same (still-correct, not-mounted) object primed before mount().
    expect(capturedDuringLabel.snapshot).toBe(primedSnapshot);
    expect(capturedDuringLabel.snapshot?.mounted).toBe(false);
    expect(runtime.getSnapshot()).not.toBe(primedSnapshot);
    expect(runtime.getSnapshot().mounted).toBe(true);

    runtime.destroy();
    sourceRoot.remove();
    renderRoot.remove();
  });

  it('reports unmounted state from getState/isMounted/getRoot/getSnapshot after a mount rollback', () => {
    const sourceRoot = document.createElement('div');
    const renderRoot = document.createElement('div');

    document.body.append(sourceRoot, renderRoot);

    const runtime = createTrackerStateIntegration({
      options: {
        ...disabledUpdateOptions,
        diagnostics: { warnings: false },
      },
      rules: [{ selector: '.rollback-target' }],
    });
    const observerError = new Error('observer acquisition failed during rollback test');

    vi.spyOn(runtime.instance.observerController, 'connect').mockImplementationOnce(() => {
      throw observerError;
    });

    const primedSnapshot = runtime.getSnapshot();

    expect(() => runtime.mount({ renderRoot, sourceRoot })).toThrow(observerError);

    expect(runtime.getState()).toBe('unmounted');
    expect(runtime.isMounted()).toBe(false);
    expect(runtime.getRoot()).toBeNull();
    expect(runtime.getSnapshot().mounted).toBe(false);
    expect(runtime.getSnapshot().lifecycle.mounted).toBe(false);
    // Rollback must still invalidate the pre-mount cache rather than leaving
    // callers reading a snapshot object minted before the failed attempt.
    expect(runtime.getSnapshot()).not.toBe(primedSnapshot);

    runtime.destroy();
    sourceRoot.remove();
    renderRoot.remove();
  });
});
