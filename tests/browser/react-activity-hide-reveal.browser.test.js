import { Activity, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { Tracker as ReactTracker } from '../../packages/react/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { waitFor } from './support/wait-for.js';
import { dispatchPointerActivation as activate } from './support/pointer.js';

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Builds a stable ref callback that records one `whenRuntimeDestroyed()` resolution
 * per distinct runtime generation handed to it. React re-invokes a ref
 * callback with the current instance whenever the `ref` prop itself gets a
 * new identity, even when the underlying instance is unchanged, so a `WeakSet`
 * guards against subscribing more than once to the same generation's promise.
 * This mirrors the cumulative destroy-count tracking the removed `onDestroy`
 * prop used to give. Build one tracker per test and reuse its returned
 * function as the `ref` prop across every render.
 *
 * @param {unknown[]} destroyEvents - Mutable collection appended to on destroy.
 * @param {(handle: import('../../packages/react/src/index.ts').TrackerHandle | null) => void} onHandle - Called with every handle, including `null` on unmount.
 * @returns {(handle: import('../../packages/react/src/index.ts').TrackerHandle | null) => void} Ref callback.
 */
function createDestroyTracker(destroyEvents, onHandle) {
  const trackedHandles = new WeakSet();

  return (handle) => {
    onHandle(handle);

    if (handle !== null && !trackedHandles.has(handle)) {
      trackedHandles.add(handle);
      handle.whenRuntimeDestroyed().then(() => destroyEvents.push(true));
    }
  };
}

describe('React effect-disconnection safety across an Activity hide/reveal race', () => {
  it('keeps mount, render and events working when reveal happens before the deferred destroy microtask runs', async () => {
    const target = document.createElement('div');

    target.className = 'fast-reveal-target';
    document.body.appendChild(target);

    const container = document.createElement('div');

    document.body.appendChild(container);

    const destroyEvents = [];
    const markerEvents = [];
    let trackerHandle = null;
    const trackerRef = createDestroyTracker(destroyEvents, (handle) => {
      trackerHandle = handle;
    });

    const root = createRoot(container);
    const renderHarness = (visible) =>
      root.render(
        createElement(
          Activity,
          { mode: visible ? 'visible' : 'hidden' },
          createElement(ReactTracker, {
            onMarkerActivate: (payload) => markerEvents.push(payload),
            options: {
              clustering: { enabled: false },
              updates: {
                interval: { enabled: false },
                mutation: { enabled: false },
                resize: { enabled: false },
                scroll: { enabled: false },
              },
            },
            ref: trackerRef,
            rules: [{ selector: '.fast-reveal-target' }],
          }),
        ),
      );

    flushSync(() => renderHarness(true));
    await waitFor(() => trackerHandle !== null, 'the initial fast-scenario handle');
    trackerHandle.refresh();

    await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the initial fast-scenario mount');

    const rootBeforeHide = container.querySelector('.rxtt');

    flushSync(() => renderHarness(false));

    // Reveal immediately, synchronously, with no await: the deferred destroy
    // microtask queued by the hide's useLayoutEffect cleanup has not run yet
    // by the time this line executes.
    flushSync(() => renderHarness(true));
    await waitFor(() => trackerHandle !== null, 'the post-fast-reveal handle');

    // Ground truth verified directly against Chromium with React 19.2's real
    // Activity component: reveal's effect setup
    // (Tracker.tsx:290-291) increments lifecycleGenerationRef synchronously,
    // before the JS call stack unwinds far enough for the hide's queued
    // microtask to run. When that microtask does fire, its captured
    // generation no longer matches lifecycleGenerationRef.current
    // (Tracker.tsx:351), so the real runtime.destroy() is correctly skipped
    // and the same runtime/DOM root is reused across the hide/reveal cycle.
    expect(container.querySelector('.rxtt')).toBe(rootBeforeHide);

    trackerHandle.refresh();
    await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the post-fast-reveal marker');

    // marker:activate is published synchronously (DOM event -> Core emit ->
    // React callback, no microtask/timer in between), so both assertions hold
    // immediately. destroyEvents is a permanent-absence check, not a race: the
    // hide's queued destroy microtask already ran to completion during the
    // waitFor() above (microtasks always drain before that call's setTimeout
    // polling resumes) and was a no-op because reveal's synchronous generation
    // bump made it stale - it can never fire late for this generation.
    activate(container.querySelector('.rxtt__marker'), 91);

    expect(markerEvents).toHaveLength(1);
    expect(destroyEvents).toHaveLength(0);

    flushSync(() => root.unmount());
  });

  it('mounts a fresh runtime and keeps render and events working when reveal happens after a real destroy has completed', async () => {
    const target = document.createElement('div');

    target.className = 'slow-reveal-target';
    document.body.appendChild(target);

    const container = document.createElement('div');

    document.body.appendChild(container);

    const destroyEvents = [];
    const markerEvents = [];
    let trackerHandle = null;
    const trackerRef = createDestroyTracker(destroyEvents, (handle) => {
      trackerHandle = handle;
    });

    const root = createRoot(container);
    const renderHarness = (visible) =>
      root.render(
        createElement(
          Activity,
          { mode: visible ? 'visible' : 'hidden' },
          createElement(ReactTracker, {
            onMarkerActivate: (payload) => markerEvents.push(payload),
            options: {
              clustering: { enabled: false },
              updates: {
                interval: { enabled: false },
                mutation: { enabled: false },
                resize: { enabled: false },
                scroll: { enabled: false },
              },
            },
            ref: trackerRef,
            rules: [{ selector: '.slow-reveal-target' }],
          }),
        ),
      );

    flushSync(() => renderHarness(true));
    await waitFor(() => trackerHandle !== null, 'the initial slow-scenario handle');
    trackerHandle.refresh();

    await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the initial slow-scenario mount');

    const rootBeforeHide = container.querySelector('.rxtt');

    flushSync(() => renderHarness(false));

    // Let the deferred destroy microtask actually run and complete a real
    // runtime.destroy() before revealing again. This is a positive,
    // eventually-true condition, so polling for it (rather than a fixed
    // sleep) is safe and matches the -repeated.browser.test.js pattern.
    await waitFor(() => destroyEvents.length === 1, 'the slow hide destroy notification');

    flushSync(() => renderHarness(true));
    await waitFor(() => trackerHandle !== null, 'the post-slow-reveal handle');

    // Ground truth verified directly against Chromium: Activity keeps the
    // React-owned DOM node (Tracker.tsx's renderRootRef div) attached and
    // reuses it across the hide/reveal cycle, even though the underlying
    // Tracker runtime was genuinely destroyed and reveal's setup creates a
    // brand new one (Tracker.tsx:258-261, runtime.isDestroyed() is true).
    expect(container.querySelector('.rxtt')).toBe(rootBeforeHide);

    trackerHandle.refresh();
    await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the post-slow-reveal marker');

    // Synchronous marker:activate publication, and every prior waitFor() in
    // this test already drained any pending microtask/timer boundary from the
    // mount/destroy sequence above, so both checks hold immediately.
    activate(container.querySelector('.rxtt__marker'), 92);

    expect(markerEvents).toHaveLength(1);
    // No second, spurious destroy notification from the fresh runtime.
    expect(destroyEvents).toHaveLength(1);

    flushSync(() => root.unmount());
  });

  it('reconnects AUTO-mode observers after a slow hide-reveal so a newly matching element is auto-detected without an explicit render() call', async () => {
    const sourceRoot = document.createElement('div');

    document.body.appendChild(sourceRoot);

    const container = document.createElement('div');

    document.body.appendChild(container);

    const destroyEvents = [];
    const trackerRef = createDestroyTracker(destroyEvents, () => {});

    const root = createRoot(container);
    const renderHarness = (visible) =>
      root.render(
        createElement(
          Activity,
          { mode: visible ? 'visible' : 'hidden' },
          createElement(ReactTracker, {
            options: { clustering: { enabled: false } },
            ref: trackerRef,
            rules: [{ selector: '.auto-reveal-target' }],
            sourceRoot,
          }),
        ),
      );

    flushSync(() => renderHarness(true));

    const firstTarget = document.createElement('div');

    firstTarget.className = 'auto-reveal-target';
    sourceRoot.appendChild(firstTarget);

    await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the AUTO-mode initial marker');

    flushSync(() => renderHarness(false));

    await waitFor(() => destroyEvents.length === 1, 'the AUTO-mode hide destroy notification');

    flushSync(() => renderHarness(true));

    const secondTarget = document.createElement('div');

    secondTarget.className = 'auto-reveal-target';
    sourceRoot.appendChild(secondTarget);

    // Ground truth verified directly against Chromium: after a real destroy
    // and a fresh remount driven entirely by Activity/AUTO-mode observers (no
    // explicit .render() call anywhere in this test), the fresh runtime's own
    // MutationObserver (reconnected during the fresh mount) picks up the
    // newly appended matching element on its own and renders a second marker.
    await waitFor(
      () => container.querySelectorAll('.rxtt__marker').length === 2,
      'AUTO-mode auto-detection of the element added after reveal',
    );

    flushSync(() => root.unmount());
  });
});
