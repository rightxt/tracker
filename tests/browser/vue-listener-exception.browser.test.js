import { createApp, h as createVueElement } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';
import { dispatchPointerActivation } from './support/pointer.js';

/** Tracker options that remove asynchronous observer noise from event tests. */
const disabledUpdateOptions = {
  clustering: { enabled: false },
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
};

/** Removes browser fixtures after each Vue error-transport scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Dispatches a complete primary-pointer activation sequence.
 *
 * @param {Element} target - Marker receiving the activation.
 * @returns {void}
 */
function activate(target) {
  dispatchPointerActivation(target, 71);
}

/**
 * Waits until a browser condition becomes true.
 *
 * @param {() => boolean} condition - Observable success condition.
 * @returns {Promise<void>} Resolves when the condition is true.
 */
async function waitFor(condition) {
  const deadline = performance.now() + 5000;

  while (!condition()) {
    if (performance.now() >= deadline) {
      throw new Error('Timed out waiting for the Vue Tracker fixture.');
    }

    await new Promise((resolve) => {
      window.requestAnimationFrame(resolve);
    });
  }
}

/**
 * Mounts a Vue Tracker with array-valued marker listeners.
 *
 * @param {Array<(payload: unknown) => void>} listeners - Vue event listeners.
 * @param {((error: unknown) => void) | undefined} errorHandler - Optional Vue application error handler.
 * @returns {Promise<{ app: import('vue').App, getHandle: () => unknown, marker: Element }>} Mounted fixture.
 */
async function mountTracker(listeners, errorHandler) {
  const container = document.createElement('div');
  const target = document.createElement('div');
  let handle = null;

  target.className = 'vue-listener-exception-target';
  document.body.append(target, container);

  const app = createApp({
    render: () =>
      createVueElement(VueTracker, {
        onMarkerActivate: listeners,
        options: disabledUpdateOptions,
        ref: (instance) => {
          handle = instance;
        },
        rules: [{ selector: '.vue-listener-exception-target' }],
      }),
  });

  if (errorHandler) {
    app.config.errorHandler = errorHandler;
  }

  app.mount(container);

  await waitFor(() => container.querySelector('.rxtt__marker') !== null && handle !== null);

  const marker = container.querySelector('.rxtt__marker');

  if (marker === null || handle === null) {
    app.unmount();
    throw new Error('Expected a mounted Vue Tracker marker and exposed handle.');
  }

  return { app, getHandle: () => handle, marker };
}

describe('Vue listener exception transport', () => {
  // The unconfigured synchronous host-error transport case is retired here: its
  // stronger owner is the Vue row of exception-transport-parity.browser.test.js,
  // which additionally proves framework sibling semantics and actual host error
  // transport. This file's unique value is Vue's configured error-handler
  // channel below.
  it('keeps a synchronous listener failure in Vue when app.config.errorHandler is configured', async () => {
    const order = [];
    const errors = [];
    const fixture = await mountTracker(
      [
        () => {
          order.push('first');
          throw new Error('handled Vue listener failure');
        },
        () => order.push('second'),
      ],
      (error) => errors.push(error),
    );

    try {
      activate(fixture.marker);

      expect(order).toEqual(['first', 'second']);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe('handled Vue listener failure');
      expect(fixture.getHandle().getStats().errors.byCode['integration-event-handler-error']).toBeUndefined();
    } finally {
      fixture.app.unmount();
    }
  });
});
