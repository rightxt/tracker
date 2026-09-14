import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';

/** Removes browser fixtures after every observer generation scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Waits for two animation frames plus a macrotask, giving any native
 * MutationObserver microtask and ResizeObserver notification loop a chance
 * to run before assertions are made.
 *
 * @returns {Promise<void>} Resolves after the wait.
 */
function waitForObserverCheckpoint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  });
}

/**
 * Replaces a native per-window observer constructor with a spy that records,
 * per constructed instance, how many times its callback was actually invoked
 * by the browser. Each Tracker connection generation creates exactly one
 * observer instance of a given kind, so `instances[0]` is generation 1 and
 * `instances[1]` is generation 2.
 *
 * @param {string} propertyName - 'MutationObserver' or 'ResizeObserver'.
 * @returns {{ instances: Array<{ invocations: number }>, restore: () => void }} Spy handle.
 */
function installObserverSpy(propertyName) {
  const Native = window[propertyName];
  const instances = [];

  class Spy extends Native {
    constructor(callback) {
      const record = { invocations: 0 };

      super((...args) => {
        record.invocations += 1;
        callback(...args);
      });

      instances.push(record);
    }
  }

  window[propertyName] = Spy;

  return {
    instances,
    restore: () => {
      window[propertyName] = Native;
    },
  };
}

describe('observer generation safety across synchronous remount', () => {
  it('never invokes a retired MutationObserver instance after synchronous unmount/remount to a new source', async () => {
    const sourceA = document.createElement('div');
    const sourceB = document.createElement('div');

    sourceA.className = 'source-a';
    sourceB.className = 'source-b';
    document.body.append(sourceA, sourceB);

    const spy = installObserverSpy('MutationObserver');

    try {
      const tracker = new Tracker({
        options: {
          clustering: { enabled: false },
          updates: {
            mutation: { enabled: true, debounce: 0 },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [{ selector: '.target' }],
      });

      tracker.mount({ sourceRoot: sourceA });

      expect(spy.instances).toHaveLength(1);

      const generation1 = spy.instances[0];

      // Enqueue a native MutationRecord for generation 1 without yielding, so the
      // browser has not yet delivered it through the mutation-observer microtask.
      sourceA.appendChild(document.createElement('span'));

      // Synchronously retire generation 1 and connect generation 2 against sourceB,
      // still before any microtask checkpoint has run.
      tracker.unmount();
      tracker.mount({ sourceRoot: sourceB });

      expect(spy.instances).toHaveLength(2);

      const generation2 = spy.instances[1];

      await waitForObserverCheckpoint();

      expect(generation1.invocations).toBe(0);
      expect(generation2.invocations).toBe(0);

      // Generation 2 must still observe normally.
      sourceB.appendChild(document.createElement('span'));

      await waitForObserverCheckpoint();

      expect(generation1.invocations).toBe(0);
      expect(generation2.invocations).toBeGreaterThan(0);

      tracker.destroy();
    } finally {
      spy.restore();
    }
  });

  it('never invokes a retired ResizeObserver instance after synchronous unmount/remount to a new source', async () => {
    const sourceA = document.createElement('div');
    const sourceB = document.createElement('div');

    sourceA.className = 'source-a';
    sourceB.className = 'source-b';
    sourceA.style.width = '100px';
    sourceB.style.width = '100px';
    document.body.append(sourceA, sourceB);

    const spy = installObserverSpy('ResizeObserver');

    try {
      const tracker = new Tracker({
        options: {
          clustering: { enabled: false },
          updates: {
            mutation: { enabled: false },
            resize: { enabled: true, debounce: 0 },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [{ selector: '.target' }],
      });

      tracker.mount({ sourceRoot: sourceA });

      expect(spy.instances).toHaveLength(1);

      const generation1 = spy.instances[0];

      // Resize generation 1's observed target without yielding, so the browser
      // has not yet run the ResizeObserver notification loop for this change
      // (nor for the routine initial-observation notification every newly
      // observed target receives).
      sourceA.style.width = '200px';

      // Synchronously retire generation 1 and connect generation 2 against sourceB,
      // still before any resize-observation checkpoint has run.
      tracker.unmount();
      tracker.mount({ sourceRoot: sourceB });

      expect(spy.instances).toHaveLength(2);

      const generation2 = spy.instances[1];

      await waitForObserverCheckpoint();

      expect(generation1.invocations).toBe(0);

      // Generation 2 must still observe normally (at minimum its routine
      // initial-observation notification).
      expect(generation2.invocations).toBeGreaterThan(0);

      const generation2InvocationsAfterInitial = generation2.invocations;

      sourceB.style.width = '300px';

      await waitForObserverCheckpoint();

      expect(generation1.invocations).toBe(0);
      expect(generation2.invocations).toBeGreaterThan(generation2InvocationsAfterInitial);

      tracker.destroy();
    } finally {
      spy.restore();
    }
  });
});
