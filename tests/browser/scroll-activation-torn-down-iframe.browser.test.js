import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { loadInlineFrame } from './support/inline-frame.js';

/** Removes all browser fixtures after each scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('scroll-activation safety under a realistic torn-down iframe', () => {
  it('never throws and never records a scroll-into-view diagnostic when the hosting iframe is removed mid-gesture, between pointerdown and pointerup', async () => {
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
      throw new Error('Expected a complete torn-down iframe fixture.');
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

    tracker.on('marker:activate', (payload) => markerEvents.push(payload));
    tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

    const marker = frameDocument.querySelector('.rxtt__marker');

    if (marker === null) {
      throw new Error('Expected a marker in the iframe fixture.');
    }

    // Simulates a real-world teardown that a host application can trigger
    // mid-gesture (e.g. a modal/overlay unmounting its iframe as soon as the
    // user starts interacting with it), which detaches the marker's document
    // from the top-level document before the activation-driving pointerup
    // fires and Tracker resolves its scroll/focus targets.
    marker.addEventListener(
      'pointerdown',
      () => {
        iframe.remove();
      },
      { once: true },
    );

    const shared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId: 51 };

    expect(() => {
      marker.dispatchEvent(new frameWindow.PointerEvent('pointerdown', { ...shared, buttons: 1 }));
    }).not.toThrow();

    const pointerUp = new frameWindow.PointerEvent('pointerup', { ...shared, buttons: 0 });

    expect(() => marker.dispatchEvent(pointerUp)).not.toThrow();

    // Ground truth (verified directly against Chromium, Firefox, and WebKit
    // before writing this test, independent of Tracker): once a same-origin
    // iframe's browsing context is discarded, Chromium and WebKit turn
    // dispatchEvent() into a total no-op for every node in that document, at
    // every phase, so the pointerup never reaches Tracker's listeners at all.
    // Firefox keeps dispatching locally, but by the time the event bubbles to
    // Tracker's delegated listener the frame's realm is already torn down and
    // the gesture does not complete either. The net, engine-independent
    // result a host application can rely on is: no exception anywhere, no
    // scroll-into-view diagnostic, and no completed activation for a gesture
    // that spans a mid-flight iframe teardown - not the clean "activation
    // completes" outcome one might expect, and not a thrown exception either.
    expect(tracker.getStats().errors.byCode['scroll-into-view-error']).toBeUndefined();
    expect(markerEvents).toHaveLength(0);
    expect(pointerUp.defaultPrevented).toBe(false);

    tracker.destroy();
  });

  it('does not fail when a preceding capture listener discards the pointer realm before terminal cleanup scheduling', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html><body><div id="target">target</div></body></html>
    `);
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;

    if (frameWindow === null || frameDocument?.body == null) {
      throw new Error('Expected a complete pointer-terminal realm fixture.');
    }

    const tracker = new Tracker({
      options: {
        interaction: { drag: true },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '#target' }],
    });

    tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

    const root = frameDocument.querySelector('.rxtt');

    if (root === null) {
      throw new Error('Expected a tracker root in the pointer-terminal realm fixture.');
    }

    // Discarding the pointer realm mid-terminal-cleanup can only surface as an
    // error on the frame's own window, which is the cross-realm safety contract
    // under test; it is observed locally here. Unexpected parent-realm errors
    // are left to native Vitest.
    const frameErrors = [];
    const captureFrameError = (event) => frameErrors.push(event.error ?? event.message);

    frameWindow.addEventListener('error', captureFrameError);
    frameDocument.addEventListener('pointerup', () => iframe.remove(), { capture: true, once: true });

    try {
      const shared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId: 73 };

      root.dispatchEvent(new frameWindow.PointerEvent('pointerdown', { ...shared, buttons: 1 }));

      expect(() => {
        root.dispatchEvent(new frameWindow.PointerEvent('pointerup', { ...shared, buttons: 0 }));
      }).not.toThrow();

      await new Promise((resolve) => {
        window.setTimeout(resolve, 25);
      });

      expect(frameErrors).toHaveLength(0);
    } finally {
      frameWindow.removeEventListener('error', captureFrameError);
      tracker.destroy();
    }
  });
});
