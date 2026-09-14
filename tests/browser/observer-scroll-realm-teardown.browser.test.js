import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';

/**
 * Loads a same-origin iframe used as the complete Tracker runtime realm.
 *
 * @returns {Promise<HTMLIFrameElement>} Loaded iframe.
 */
function loadRuntimeFrame() {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');

    iframe.addEventListener('load', () => resolve(iframe), { once: true });
    iframe.addEventListener('error', () => reject(new Error('Failed to load the scroll teardown frame.')), {
      once: true,
    });
    iframe.srcdoc = '<!doctype html><html><body><div class="target">target</div></body></html>';
    document.body.appendChild(iframe);
  });
}

/** Removes browser fixtures after every observer teardown scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('observer scroll-frame safety after runtime realm teardown', () => {
  it('does not deliver a pending scroll frame after the iframe is discarded and Tracker is destroyed', async () => {
    const iframe = await loadRuntimeFrame();
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;

    if (frameWindow === null || frameDocument?.body == null) {
      throw new Error('Expected a complete scroll teardown frame.');
    }

    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: true },
        },
      },
      rules: [{ selector: '.target' }],
    });
    // The runtime realm here is the iframe: a scroll frame delivered after the
    // realm is discarded would surface as an error on the frame's own window.
    // That cross-realm channel is the contract under test, so it is observed
    // locally; unexpected parent-realm errors are left to native Vitest.
    const frameErrors = [];
    const captureFrameError = (event) => frameErrors.push(event.error ?? event.message);

    frameWindow.addEventListener('error', captureFrameError);

    try {
      tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

      const scrollEventsBefore = tracker.getStats().observers.scroll;

      frameWindow.dispatchEvent(new frameWindow.Event('scroll'));
      iframe.remove();
      tracker.destroy();

      await new Promise((resolve) => {
        window.setTimeout(resolve, 50);
      });

      expect(frameErrors).toHaveLength(0);
      expect(tracker.getStats().observers.scroll).toBe(scrollEventsBefore);
    } finally {
      frameWindow.removeEventListener('error', captureFrameError);
    }
  });
});
