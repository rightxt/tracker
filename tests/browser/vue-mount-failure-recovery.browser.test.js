import { createApp, h, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';
// This root is frame-hosted for the initial (failing) mount, so only the
// `?raw` string module is needed here to seed the iframe fixture's stylesheet.
import trackerCss from '../../packages/core/src/styles/rxt-tracker.css?raw';
import { waitFor } from './support/wait-for.js';

/**
 * Loads a same-origin iframe with the tracker stylesheet already in its head.
 *
 * @returns {Promise<HTMLIFrameElement>} Loaded frame.
 */
function loadFrameFixture() {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');

    iframe.addEventListener('load', () => resolve(iframe), { once: true });
    iframe.addEventListener('error', () => reject(new Error('Failed to load the Vue mount-failure-recovery iframe.')), {
      once: true,
    });
    iframe.srcdoc = `<!doctype html><html><head><style>${trackerCss}</style></head><body></body></html>`;
    document.body.appendChild(iframe);
  });
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('Vue mount-failure recovery', () => {
  // Vue's app.config.errorHandler retains the same component generation after
  // the thrown mount error, and the component retains its Core runtime so the
  // same exposed handle survives, a
  // later corrected sourceRoot re-triggers Tracker's own watch(), and the
  // same runtime generation successfully mounts and renders.
  it('recovers a marker render after an initial cross-realm sourceRoot mount failure, once sourceRoot is corrected', async () => {
    const iframe = await loadFrameFixture();
    const frameDocument = iframe.contentDocument;

    if (!frameDocument) {
      throw new Error('Expected a loaded Vue mount-failure-recovery iframe document.');
    }

    const container = document.createElement('div');

    document.body.appendChild(container);

    const sourceRoot = ref(frameDocument.body);
    const capturedErrors = [];
    let handle = null;

    const app = createApp({
      setup() {
        return () =>
          h(VueTracker, {
            ref: (instance) => {
              handle = instance ?? handle;
            },
            options: {
              updates: {
                interval: { enabled: false },
                mutation: { enabled: false },
                resize: { enabled: false },
                scroll: { enabled: false },
              },
            },
            rules: [{ selector: '.smoke-target' }],
            sourceRoot: sourceRoot.value,
          });
      },
    });

    app.config.errorHandler = (error) => capturedErrors.push(error);
    app.mount(container);
    await waitFor(() => capturedErrors.length > 0, 'the initial cross-realm Vue mount failure');

    expect(capturedErrors[0]).toEqual(expect.objectContaining({ code: 'ERR_TRACKER_REALM_MISMATCH' }));
    expect(handle).not.toBeNull();

    // Observation 1: Vue retained the same component generation -- the exposed
    // handle survives the thrown mount error and still answers getState().
    // Core itself already rolled the failed mount back to a live 'unmounted'
    // state, and the adapter no longer destroys that runtime on this path.
    const stateAfterFailure = handle.getState();

    expect(stateAfterFailure).toBe('unmounted');

    // Correct sourceRoot to a same-realm element and let Tracker's own
    // watch() react to the change.
    const validSourceRoot = document.createElement('main');
    const target = document.createElement('div');

    target.className = 'smoke-target';
    validSourceRoot.appendChild(target);
    document.body.appendChild(validSourceRoot);
    sourceRoot.value = validSourceRoot;
    await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'a marker render after recovery');

    // Observation 2: the same runtime generation recovers -- no second error,
    // and the corrected root successfully mounts and renders.
    expect(capturedErrors).toHaveLength(1);
    expect(handle.getState()).toBe('mounted');

    app.unmount();
  });
});
