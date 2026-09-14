import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tracker as ReactTracker } from '../../packages/react/src/index.ts';
// The retained tracker root in this file is frame-hosted, so only the `?raw`
// string module is needed here, to seed the iframe fixture's own stylesheet
// below.
import trackerCss from '../../packages/core/src/styles/rxt-tracker.css?raw';
import { waitFor } from './support/wait-for.js';

/** Monotonic pointer-id source keeping every synthetic session distinct. */
let nextPointerId = 1;

/**
 * Dispatches a complete primary-pointer activation sequence on a target.
 *
 * @param {Element} target - Pointer event target.
 * @returns {void}
 */
function activate(target) {
  const pointerId = nextPointerId;

  nextPointerId += 1;
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      cancelable: true,
      isPrimary: true,
      pointerId,
    }),
  );
  target.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      cancelable: true,
      isPrimary: true,
      pointerId,
    }),
  );
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true }));
}

/**
 * Loads a same-origin iframe with the tracker stylesheet and a window-mode
 * marker fixture already in its body.
 *
 * The `srcdoc` document is fully separate from the top-level test document,
 * so the stylesheet is inlined directly rather than relying on this file's
 * own CSS import, which would never reach the frame's `<head>`.
 *
 * @returns {Promise<HTMLIFrameElement>} Loaded frame.
 */
function loadFrameFixture() {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');

    iframe.addEventListener('load', () => resolve(iframe), { once: true });
    iframe.addEventListener('error', () => reject(new Error('Failed to load the Tier-3 adapter iframe smoke frame.')), {
      once: true,
    });
    iframe.srcdoc = `<!doctype html><html><head><style>${trackerCss}</style></head><body>
      <div class="smoke-target" style="height: 40px; margin-top: 400px;"></div>
      <div style="height: 1200px;"></div>
    </body></html>`;
    document.body.appendChild(iframe);
  });
}

/**
 * Returns the shared single-rule Tier-3 fixture rules.
 *
 * @returns {object[]} Tracker rules.
 */
function createSmokeRules() {
  return [{ selector: '.smoke-target' }];
}

beforeEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

afterEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

describe('Tier-3 adapter same-origin iframe smoke', () => {
  it('mounts, renders, activates, and unmounts the React integration inside a frame realm', async () => {
    const iframe = await loadFrameFixture();
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;

    if (!frameDocument || !frameWindow) {
      throw new Error('Expected a loaded Tier-3 iframe document.');
    }

    const container = frameDocument.createElement('div');

    frameDocument.body.appendChild(container);

    const markerEvents = [];
    const reactRoot = createRoot(container);

    reactRoot.render(
      createElement(ReactTracker, {
        options: {
          updates: {
            interval: { enabled: false },
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
          },
        },
        onMarkerActivate: (payload) => markerEvents.push(payload),
        rules: createSmokeRules(),
      }),
    );
    await waitFor(() => container.querySelector('.rxtt') !== null, 'the React frame-realm root');

    const root = container.querySelector('.rxtt');

    if (!(root instanceof frameWindow.HTMLElement)) {
      throw new Error('Expected a mounted React frame-realm root.');
    }

    expect(root.ownerDocument).toBe(frameDocument);

    await waitFor(() => root.querySelector('.rxtt__marker') !== null, 'the React frame-realm marker');

    const marker = root.querySelector('.rxtt__marker');

    if (!(marker instanceof frameWindow.HTMLElement)) {
      throw new Error('Expected a rendered React frame-realm marker.');
    }

    activate(marker);
    await waitFor(() => frameWindow.scrollY > 0, 'React frame-realm activation scrolling');

    expect(markerEvents).toHaveLength(1);
    expect(window.scrollY).toBe(0);

    reactRoot.render(null);
    await waitFor(() => container.querySelector('.rxtt') === null, 'the React frame-realm unmount');
    activate(marker);

    expect(markerEvents).toHaveLength(1);
  });
});
