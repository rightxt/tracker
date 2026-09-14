import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';

/**
 * Dispatches a complete primary-pointer activation sequence in the target realm.
 *
 * @param {Element} target - Pointer target.
 * @returns {MouseEvent} The dispatched semantic click event.
 */
function dispatchPrimaryPointerSequence(target) {
  const runtimeWindow = target.ownerDocument.defaultView;

  if (runtimeWindow === null) {
    throw new Error('Expected a Window for the pointer target.');
  }

  const shared = {
    bubbles: true,
    button: 0,
    cancelable: true,
    isPrimary: true,
    pointerId: 41,
  };

  target.dispatchEvent(new runtimeWindow.PointerEvent('pointerdown', { ...shared, buttons: 1 }));

  const pointerUp = new runtimeWindow.PointerEvent('pointerup', { ...shared, buttons: 0 });

  target.dispatchEvent(pointerUp);

  const click = new runtimeWindow.MouseEvent('click', shared);

  target.dispatchEvent(click);

  return click;
}

/** Removes all browser fixtures after each scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('scroll-activation exception safety', () => {
  it('still emits marker:activate, focuses the target, and prevents the default gesture when the platform scrollIntoView throws', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body style="margin: 0; min-height: 1800px;">
          <button id="target" style="position: absolute; top: 900px;">target</button>
        </body>
      </html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;
    const target = frameDocument?.getElementById('target');

    if (frameWindow === null || frameDocument?.body == null || target === null) {
      throw new Error('Expected a complete scroll-activation frame.');
    }

    const markerEvents = [];
    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [
        {
          selector: '#target',
          focus: { enabled: true },
          scroll: { enabled: true, target: 'self' },
        },
      ],
    });

    target.scrollIntoView = () => {
      throw new Error('Simulated platform scrollIntoView failure.');
    };
    tracker.on('marker:activate', (payload) => markerEvents.push(payload));
    tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

    const marker = frameDocument.querySelector('.rxtt__marker');

    if (marker === null) {
      throw new Error('Expected a marker in the scroll-activation frame.');
    }

    const pointerUp = dispatchPrimaryPointerSequence(marker);

    expect(markerEvents).toHaveLength(1);
    expect(pointerUp.defaultPrevented).toBe(true);
    expect(frameDocument.activeElement).toBe(target);
    expect(tracker.getStats().errors.byCode['scroll-into-view-error']).toBe(1);

    tracker.destroy();
    iframe.remove();
  });
});
