import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';

const disabledUpdateOptions = {
  clustering: { enabled: false },
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
};

/**
 * Captures the timer handle scheduled by the given action, tolerating
 * unrelated `setTimeout` scheduling elsewhere in Tracker (e.g. one-time
 * native-axis-behavior probing during mount, or DOM-node retirement on
 * unmount) by only looking at calls newly recorded during the action.
 *
 * The action must schedule exactly one new timer: the recovery-timer contract
 * under test is that a single fallback timer is armed per stopped terminal, so
 * a second concurrent schedule would leave one handle unobserved and its timer
 * leaked. The handle is read at the exact index of that one new call rather
 * than from the tail of the results list.
 *
 * @param {ReturnType<typeof vi.spyOn>} setTimeoutSpy - Spy on the realm's `setTimeout`.
 * @param {() => void} action - Synchronous action expected to schedule exactly one new timer.
 * @returns {unknown} The handle returned by the single new `setTimeout` call.
 */
function captureScheduledHandle(setTimeoutSpy, action) {
  const before = setTimeoutSpy.mock.calls.length;

  action();

  const scheduledCount = setTimeoutSpy.mock.calls.length - before;

  expect(scheduledCount).toBe(1);

  return setTimeoutSpy.mock.results[before].value;
}

/**
 * Reports whether a `clearTimeout` spy was invoked with the given handle.
 *
 * @param {ReturnType<typeof vi.spyOn>} clearTimeoutSpy - Spy on the realm's `clearTimeout`.
 * @param {unknown} handle - Timer handle to look for.
 * @returns {boolean} Whether the handle was cleared.
 */
function wasCleared(clearTimeoutSpy, handle) {
  return clearTimeoutSpy.mock.calls.some((call) => call[0] === handle);
}

/** Removes browser fixtures and restores spies after every scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('document pointer-end recovery timer cancellation across engines', () => {
  it('cancels the recovery timer synchronously for normal pointerup and pointercancel terminals', () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    // Each native terminal event gets an isolated fresh-fixture phase with its
    // own Tracker generation and a distinct primary pointer id, so no active
    // pointer state carries between `pointerup` and `pointercancel`.
    const terminals = [
      {
        pointerId: 11,
        dispatchTerminal: (root, shared) =>
          root.dispatchEvent(new window.PointerEvent('pointerup', { ...shared, buttons: 0 })),
      },
      {
        pointerId: 12,
        dispatchTerminal: (root, shared) => root.dispatchEvent(new window.PointerEvent('pointercancel', shared)),
      },
    ];

    for (const { pointerId, dispatchTerminal } of terminals) {
      const tracker = new Tracker({
        options: { ...disabledUpdateOptions, interaction: { drag: true } },
        rules: [{ selector: '#target' }],
      });

      document.body.innerHTML = '<div id="target">target</div>';
      tracker.mount();

      const root = document.querySelector('.rxtt');

      if (root === null) {
        throw new Error(`Expected a tracker root for the pointer-end recovery fixture (pointerId ${pointerId}).`);
      }

      const shared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId };

      root.dispatchEvent(new window.PointerEvent('pointerdown', { ...shared, buttons: 1 }));

      const handle = captureScheduledHandle(setTimeoutSpy, () => {
        dispatchTerminal(root, shared);
      });

      expect(wasCleared(clearTimeoutSpy, handle), `pointerId ${pointerId} terminal handle cleared`).toBe(true);

      tracker.destroy();
      document.body.replaceChildren();
    }
  });

  it('cancels a pending stopped-terminal fallback timer on both unmount and destroy', () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    // Phase A cancels the pending fallback timer through unmount(); phase B
    // through destroy(). Each phase owns a fresh Tracker generation, a distinct
    // primary pointer id, and a descendant blocker that stops pointerup
    // propagation so the fallback recovery timer is left pending with a known
    // exact handle until the lifecycle operation cancels it.
    const phases = [
      { pointerId: 13, teardown: (tracker) => tracker.unmount(), teardownDestroys: false },
      { pointerId: 14, teardown: (tracker) => tracker.destroy(), teardownDestroys: true },
    ];

    for (const { pointerId, teardown, teardownDestroys } of phases) {
      const tracker = new Tracker({
        options: { ...disabledUpdateOptions, interaction: { drag: true } },
        rules: [{ selector: '#target' }],
      });

      document.body.innerHTML = '<div id="target"><span id="blocker">blocker</span></div>';

      const blocker = document.getElementById('blocker');

      blocker.addEventListener('pointerup', (event) => event.stopPropagation());
      tracker.mount();

      const root = document.querySelector('.rxtt');

      if (root === null) {
        throw new Error(`Expected a tracker root for the pointer-end recovery fixture (pointerId ${pointerId}).`);
      }

      const shared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId };

      root.dispatchEvent(new window.PointerEvent('pointerdown', { ...shared, buttons: 1 }));

      const handle = captureScheduledHandle(setTimeoutSpy, () => {
        blocker.dispatchEvent(new window.PointerEvent('pointerup', { ...shared, buttons: 0 }));
      });

      expect(wasCleared(clearTimeoutSpy, handle), `pointerId ${pointerId} handle pending before teardown`).toBe(false);

      teardown(tracker);

      expect(wasCleared(clearTimeoutSpy, handle), `pointerId ${pointerId} handle cleared after teardown`).toBe(true);

      if (!teardownDestroys) {
        tracker.destroy();
      }

      document.body.replaceChildren();
    }
  });

  it('cancels a retired recovery timer and restores pointer usability after fallback recovery on the remounted generation', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const tracker = new Tracker({
      options: { ...disabledUpdateOptions, interaction: { drag: true } },
      rules: [{ scroll: false, selector: '#target' }],
    });

    document.body.innerHTML = '<div id="target"><span id="blocker">blocker</span></div>';

    const blocker = document.getElementById('blocker');

    blocker.addEventListener('pointerup', (event) => event.stopPropagation());

    // Phase A - retired generation: the first stopped-terminal fallback timer
    // stays pending and is cancelled synchronously when its generation unmounts.
    tracker.mount();

    const firstRoot = document.querySelector('.rxtt');

    if (firstRoot === null) {
      throw new Error('Expected a tracker root for the pointer-end recovery fixture.');
    }

    const firstShared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId: 15 };

    firstRoot.dispatchEvent(new window.PointerEvent('pointerdown', { ...firstShared, buttons: 1 }));

    const firstHandle = captureScheduledHandle(setTimeoutSpy, () => {
      blocker.dispatchEvent(new window.PointerEvent('pointerup', { ...firstShared, buttons: 0 }));
    });

    expect(wasCleared(clearTimeoutSpy, firstHandle)).toBe(false);

    tracker.unmount();

    expect(wasCleared(clearTimeoutSpy, firstHandle)).toBe(true);

    // Phase B - live generation: a fresh mount takes its own stopped-terminal
    // session, the real document fallback recovery timer is allowed to fire, and
    // a later independent primary-pointer session is then accepted exactly once.
    tracker.mount();

    const secondRoot = document.querySelector('.rxtt');

    if (secondRoot === null) {
      throw new Error('Expected a tracker root after remount in the pointer-end recovery fixture.');
    }

    const marker = secondRoot.querySelector('.rxtt__marker');

    if (marker === null) {
      throw new Error('Expected a marker on the remounted pointer-end recovery generation.');
    }

    const onMarkerActivate = vi.fn();

    tracker.on('marker:activate', onMarkerActivate);

    const blockedShared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId: 16 };

    secondRoot.dispatchEvent(new window.PointerEvent('pointerdown', { ...blockedShared, buttons: 1 }));

    const secondHandle = captureScheduledHandle(setTimeoutSpy, () => {
      blocker.dispatchEvent(new window.PointerEvent('pointerup', { ...blockedShared, buttons: 0 }));
    });

    expect(secondHandle).not.toBe(firstHandle);
    expect(wasCleared(clearTimeoutSpy, secondHandle)).toBe(false);

    // Let the real fallback recovery timer execute; it is never cancelled here.
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });

    const recoveryShared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId: 17 };

    marker.dispatchEvent(new window.PointerEvent('pointerdown', { ...recoveryShared, buttons: 1 }));
    marker.dispatchEvent(new window.PointerEvent('pointerup', { ...recoveryShared, buttons: 0 }));
    marker.dispatchEvent(new window.MouseEvent('click', recoveryShared));

    expect(onMarkerActivate).toHaveBeenCalledTimes(1);
    expect(tracker.mounted).toBe(true);

    tracker.destroy();
  });

  it('cancels a fallback recovery timer scheduled on a same-origin iframe realm when the frame is torn down via unmount()', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html><body><div id="target"><span id="blocker">blocker</span></div></body></html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;

    if (frameWindow === null || frameDocument?.body == null) {
      throw new Error('Expected a complete pointer-terminal realm fixture.');
    }

    const setTimeoutSpy = vi.spyOn(frameWindow, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(frameWindow, 'clearTimeout');
    const tracker = new Tracker({
      options: { ...disabledUpdateOptions, interaction: { drag: true } },
      rules: [{ selector: '#target' }],
    });

    tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

    const root = frameDocument.querySelector('.rxtt');
    const blocker = frameDocument.getElementById('blocker');

    if (root === null || blocker === null) {
      throw new Error('Expected a tracker root in the pointer-terminal realm fixture.');
    }

    blocker.addEventListener('pointerup', (event) => event.stopPropagation());

    const shared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId: 17 };

    root.dispatchEvent(new frameWindow.PointerEvent('pointerdown', { ...shared, buttons: 1 }));

    const handle = captureScheduledHandle(setTimeoutSpy, () => {
      blocker.dispatchEvent(new frameWindow.PointerEvent('pointerup', { ...shared, buttons: 0 }));
    });

    expect(wasCleared(clearTimeoutSpy, handle)).toBe(false);

    tracker.unmount();

    expect(wasCleared(clearTimeoutSpy, handle)).toBe(true);

    tracker.destroy();
  });
});
