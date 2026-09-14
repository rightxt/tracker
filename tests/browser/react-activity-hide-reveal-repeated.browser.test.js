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
 * per distinct underlying runtime generation handed to it. React's `Activity` forces
 * the `useImperativeHandle` factory to re-run on every hide/reveal cycle, so a new
 * handle object is produced even when the underlying runtime generation is unchanged
 * and its `whenRuntimeDestroyed()` promise is still the same pending promise. Dedup
 * must key on that promise instance, not on handle identity - otherwise two distinct
 * handles sharing one still-pending promise would each attach their own `.then()`
 * and double-count the same destroy when it eventually resolves.
 *
 * @param {unknown[]} destroyEvents - Mutable collection appended to on destroy.
 * @param {(handle: import('../../packages/react/src/index.ts').TrackerHandle | null) => void} onHandle - Called with every handle, including `null` on unmount.
 * @returns {(handle: import('../../packages/react/src/index.ts').TrackerHandle | null) => void} Ref callback.
 */
function createDestroyTracker(destroyEvents, onHandle) {
  const trackedPromises = new WeakSet();

  return (handle) => {
    onHandle(handle);

    if (handle !== null) {
      const promise = handle.whenRuntimeDestroyed();

      if (!trackedPromises.has(promise)) {
        trackedPromises.add(promise);
        promise.then(() => destroyEvents.push(true));
      }
    }
  };
}

describe('React effect-disconnection safety across repeated Activity hide/reveal cycles', () => {
  it('accumulates no duplicate runtimes, observers or events across a mixed run of fast and slow hide/reveal cycles', async () => {
    const sourceRoot = document.createElement('div');

    document.body.appendChild(sourceRoot);

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
            options: { clustering: { enabled: false } },
            ref: trackerRef,
            rules: [{ selector: '.repeated-cycle-target' }],
            sourceRoot,
          }),
        ),
      );

    flushSync(() => renderHarness(true));
    await waitFor(() => trackerHandle !== null, 'the initial handle');

    const firstTarget = document.createElement('div');

    firstTarget.className = 'repeated-cycle-target';
    sourceRoot.appendChild(firstTarget);

    await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the initial marker');

    const rootBeforeCycles = container.querySelector('.rxtt');

    // Mixed run: reveal-before-microtask (fast, no destroy) alternated with
    // reveal-after-real-destroy (slow, one destroy per cycle). Each cycle must
    // leave exactly one live runtime generation, one render root and one
    // marker for the single already-tracked element - no accumulation.
    const cyclePlan = ['fast', 'slow', 'fast', 'slow', 'fast', 'slow'];
    let expectedDestroys = 0;

    for (const cycleKind of cyclePlan) {
      trackerHandle = null;
      flushSync(() => renderHarness(false));

      if (cycleKind === 'fast') {
        // Reveal immediately, synchronously, with no await: the deferred
        // destroy microtask queued by this hide's cleanup has not run yet.
        flushSync(() => renderHarness(true));
      } else {
        // Let the deferred destroy microtask actually run and complete a real
        // runtime.destroy() before revealing again.
        expectedDestroys += 1;
        await waitFor(() => destroyEvents.length === expectedDestroys, `destroy #${expectedDestroys} to complete`);
        flushSync(() => renderHarness(true));
      }

      await waitFor(() => trackerHandle !== null, `the handle after a ${cycleKind} cycle`);
      expect(container.querySelector('.rxtt')).toBe(rootBeforeCycles);
      await waitFor(
        () => container.querySelectorAll('.rxtt__marker').length === 1,
        `exactly one marker after a ${cycleKind} cycle`,
      );
    }

    expect(destroyEvents).toHaveLength(3);
    expect(container.querySelectorAll('.rxtt').length).toBe(1);
    expect(container.querySelectorAll('.rxtt__marker').length).toBe(1);

    // Automatic, observer-driven updates must still work on the final
    // generation, with no explicit render()/refresh() call anywhere here.
    const secondTarget = document.createElement('div');

    secondTarget.className = 'repeated-cycle-target';
    sourceRoot.appendChild(secondTarget);

    await waitFor(
      () => container.querySelectorAll('.rxtt__marker').length === 2,
      'auto-detection of the element added after the last cycle',
    );

    // Synchronous marker:activate publication, and the waitFor() immediately
    // above already drained any pending microtask/timer boundary, so this
    // holds immediately with no additional wait.
    activate(container.querySelector('.rxtt__marker'), 93);

    // Exactly one activation reaches React: no duplicate Core event forwarding
    // from a stale generation's subscription.
    expect(markerEvents).toHaveLength(1);
    // No spurious destroy notification beyond the three genuine slow cycles.
    expect(destroyEvents).toHaveLength(3);

    flushSync(() => root.unmount());
  });
});
