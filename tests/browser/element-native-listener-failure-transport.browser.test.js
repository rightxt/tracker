import { afterEach, describe, expect, it } from 'vitest';

import { TrackerElement, defineTrackerElement } from '../../packages/element/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { waitFor } from './support/wait-for.js';
import { dispatchPointerActivation } from './support/pointer.js';

defineTrackerElement();

/** Creates a registered `rxt-tracker` Custom Element instance. */
function createTrackerElement() {
  const element = document.createElement('rxt-tracker');

  if (!(element instanceof TrackerElement)) {
    throw new Error('Expected the registered rxt-tracker Custom Element.');
  }

  return element;
}

/**
 * Dispatches a complete primary-pointer activation sequence.
 *
 * @param {Element} target - Pointer event target.
 * @returns {void}
 */
function activate(target) {
  dispatchPointerActivation(target, 71);
}

/**
 * Captures global uncaught errors and unhandled rejections, since a native
 * `EventTarget` listener failure is reported through the browser's own
 * error-reporting algorithm rather than through any handler this test
 * installs directly.
 *
 * @returns {{ errors: unknown[], rejections: unknown[], stop: () => void }} Capture handle.
 */
function captureGlobalFailures() {
  const errors = [];
  const rejections = [];
  const onError = (event) => {
    errors.push(event.error ?? event.message);
    event.preventDefault();
  };
  const onRejection = (event) => {
    rejections.push(event.reason);
    event.preventDefault();
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return {
    errors,
    rejections,
    stop: () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    },
  };
}

const disabledUpdateOptions = {
  clustering: { enabled: false },
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('Element native listener failure transport', () => {
  it('runs a second native marker:activate listener after the first throws synchronously, without attributing the failure to Core', async () => {
    const target = document.createElement('div');

    target.className = 'element-native-throw-target';
    document.body.appendChild(target);

    const element = createTrackerElement();

    element.replaceOptions(disabledUpdateOptions);
    element.replaceRules([{ selector: '.element-native-throw-target' }]);
    document.body.appendChild(element);

    await waitFor(
      () => element.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the mounted native-listener marker',
    );

    const marker = element.querySelector('.rxtt__marker');

    if (marker === null) {
      throw new Error('Expected a mounted native-listener marker.');
    }

    const order = [];

    element.addEventListener('marker:activate', () => {
      order.push('A-throws');
      throw new Error('Native listener A failure.');
    });
    element.addEventListener('marker:activate', () => {
      order.push('B');
    });

    const capture = captureGlobalFailures();

    try {
      activate(marker);

      // Per the EventTarget dispatch algorithm, an exception from one listener
      // is reported (never propagated to the caller of dispatchEvent()) and
      // does not prevent later listeners on the same target from running.
      expect(order).toEqual(['A-throws', 'B']);
      expect(capture.errors).toHaveLength(1);
      expect(capture.errors[0]?.message).toBe('Native listener A failure.');
      expect(capture.rejections).toHaveLength(0);

      // Core's own forwarder subscriber (registered through runtime.on()) only
      // calls dispatchEvent() and never throws itself, so a downstream native
      // listener's exception must not be misattributed as a Core event-handler
      // failure.
      expect(element.getStats().errors.byCode['integration-event-handler-error']).toBeUndefined();
    } finally {
      capture.stop();
      element.remove();
    }
  });

  it('surfaces a rejected Promise returned from a native marker:activate listener as an unhandled rejection, without attributing it to Core', async () => {
    const target = document.createElement('div');

    target.className = 'element-native-rejection-target';
    document.body.appendChild(target);

    const element = createTrackerElement();

    element.replaceOptions(disabledUpdateOptions);
    element.replaceRules([{ selector: '.element-native-rejection-target' }]);
    document.body.appendChild(element);

    await waitFor(
      () => element.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the mounted native-listener marker',
    );

    const marker = element.querySelector('.rxtt__marker');

    if (marker === null) {
      throw new Error('Expected a mounted native-listener marker.');
    }

    const order = [];

    element.addEventListener('marker:activate', () => {
      order.push('A-rejects');
      return Promise.reject(new Error('Native listener A rejection.'));
    });
    element.addEventListener('marker:activate', () => {
      order.push('B');
    });

    const capture = captureGlobalFailures();

    try {
      activate(marker);
      // A rejected Promise returned from a native listener is unrelated to
      // dispatchEvent(), so the browser reports it via its own unhandledrejection
      // scheduling; this is a genuinely async boundary, but the condition it
      // eventually satisfies is positively observable, so poll for it instead
      // of a fixed sleep.
      await waitFor(() => capture.rejections.length === 1, 'the native listener unhandled rejection');

      // dispatchEvent() never inspects a listener's return value, so a
      // rejected Promise returned from one listener is entirely unrelated to
      // event dispatch: it surfaces only through the ordinary Promise
      // rejection channel, and every listener still runs.
      expect(order).toEqual(['A-rejects', 'B']);
      expect(capture.errors).toHaveLength(0);
      expect(capture.rejections).toHaveLength(1);
      expect(capture.rejections[0]?.message).toBe('Native listener A rejection.');
      expect(element.getStats().errors.byCode['integration-event-handler-error']).toBeUndefined();
    } finally {
      capture.stop();
      element.remove();
    }
  });

  it('does not duplicate the forwarded marker:activate CustomEvent after a disconnect and reconnect', async () => {
    const target = document.createElement('div');

    target.className = 'element-native-reconnect-target';
    document.body.appendChild(target);

    const element = createTrackerElement();

    element.replaceOptions(disabledUpdateOptions);
    element.replaceRules([{ selector: '.element-native-reconnect-target' }]);

    let activationCount = 0;

    element.addEventListener('marker:activate', () => {
      activationCount += 1;
    });

    document.body.appendChild(element);
    await waitFor(
      () => element.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the initial mounted marker',
    );

    activate(element.querySelector('.rxtt__marker'));
    expect(activationCount).toBe(1);

    // A same-document move runs disconnectedCallback and connectedCallback
    // synchronously, tearing down the first runtime generation's forwarders
    // and attaching a fresh set on the new generation.
    const otherContainer = document.createElement('div');

    document.body.appendChild(otherContainer);
    otherContainer.appendChild(element);

    await waitFor(
      () => element.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the marker after reconnect',
    );

    activate(element.querySelector('.rxtt__marker'));

    // If a stale forwarder from the first generation leaked, this single
    // activation after reconnect would have incremented the counter twice.
    expect(activationCount).toBe(2);

    element.remove();
  });
});
