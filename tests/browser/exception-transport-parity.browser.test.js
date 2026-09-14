import '@angular/compiler';

import { ErrorHandler, createComponent } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, h as createVueElement } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { TrackerComponent as AngularTracker } from '../../packages/angular/src/public-api.ts';
import { Tracker as ReactTracker } from '../../packages/react/src/index.ts';
import { Tracker as VanillaTracker } from '../../packages/vanilla/src/index.ts';
import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { waitFor } from './support/wait-for.js';
import { dispatchPointerActivation } from './support/pointer.js';

/**
 * File-local Angular {@link ErrorHandler} that records every error Angular
 * routes to it, instead of logging to the console. The Angular scenario in
 * this suite deliberately makes an output subscriber throw; the tested
 * contract is that exactly that error reaches the application error handler
 * while no Core diagnostic is raised. A capturing handler (rather than the
 * shared rethrowing one) is required so the test can assert the captured
 * cardinality and message directly.
 */
class CapturingAngularErrorHandler extends ErrorHandler {
  constructor() {
    super();
    /** @type {unknown[]} */
    this.errors = [];
  }

  /**
   * @param {unknown} error - The error Angular caught and routed here.
   * @returns {void}
   */
  handleError(error) {
    this.errors.push(error);
  }
}

/**
 * Dispatches a complete primary-pointer activation sequence.
 *
 * @param {Element} target - Pointer event target.
 * @returns {void}
 */
function activate(target) {
  dispatchPointerActivation(target, 61);
}

/**
 * Captures global uncaught errors and unhandled rejections raised outside
 * any handler this test installs directly, so framework-internal error
 * transports (which may report asynchronously, on a macrotask, instead of
 * synchronously through Core's own diagnostics channel) are not missed.
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

afterEach(() => {
  document.body.replaceChildren();
});

describe('exception transport through framework-native callbacks', () => {
  // React, Vue, and Angular deliberately do not expose Core's `.on()`/`.off()`
  // event bus, so the direct-handler contract is exercised through Vanilla.
  it('isolates a throwing Vanilla handler and reports the original failure through the host', async () => {
    const host = document.createElement('div');

    document.body.appendChild(host);

    const target = document.createElement('div');

    target.className = 'direct-target';
    host.appendChild(target);

    const tracker = new VanillaTracker({
      options: {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.direct-target' }],
    });
    const componentRoot = document.createElement('div');

    host.appendChild(componentRoot);
    tracker.mount({ renderHost: componentRoot });

    await waitFor(
      () => componentRoot.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the mounted direct-handler marker',
    );

    const marker = componentRoot.querySelector('.rxtt__marker');

    if (marker === null) {
      throw new Error('Expected a mounted direct-handler marker.');
    }

    const order = [];

    tracker.on('marker:activate', () => {
      order.push('first-direct-throws');
      throw new Error('First direct handler failure.');
    });
    tracker.on('marker:activate', () => {
      order.push('second-direct');
    });

    const capture = captureGlobalFailures();

    try {
      activate(marker);

      expect(order).toEqual(['first-direct-throws', 'second-direct']);
      await waitFor(() => capture.errors.length === 1, 'the host-reported Vanilla listener failure');
      expect(capture.errors[0]?.message).toBe('First direct handler failure.');
      expect(capture.rejections).toHaveLength(0);
      expect(tracker.getStats().errors.byCode['integration-event-handler-error']).toBeUndefined();
    } finally {
      capture.stop();
      tracker.destroy();
    }
  });

  it('keeps a throwing React callback outside Core diagnostics and preserves runtime cleanup', async () => {
    const host = document.createElement('div');
    const target = document.createElement('div');
    const componentRoot = document.createElement('div');

    target.className = 'react-throw-target';
    host.append(target, componentRoot);
    document.body.appendChild(host);

    const trackerRef = createRef(null);
    const root = createRoot(componentRoot);
    const callbackError = new Error('React callback failure.');

    root.render(
      createElement(ReactTracker, {
        onMarkerActivate: () => {
          throw callbackError;
        },
        options: {
          clustering: { enabled: false },
          updates: {
            interval: { enabled: false },
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
          },
        },
        ref: trackerRef,
        rules: [{ selector: '.react-throw-target' }],
      }),
    );

    await waitFor(
      () => componentRoot.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the mounted React callback marker',
    );

    const marker = componentRoot.querySelector('.rxtt__marker');

    if (marker === null || trackerRef.current === null) {
      throw new Error('Expected a mounted React marker and handle.');
    }

    const capture = captureGlobalFailures();
    const destroyed = trackerRef.current.whenRuntimeDestroyed();

    try {
      activate(marker);
      await waitFor(() => capture.errors.length === 1, 'the host-reported React callback failure');

      expect(capture.errors[0]).toBe(callbackError);
      expect(capture.rejections).toEqual([]);
      expect(trackerRef.current.getStats().errors.byCode['integration-event-handler-error']).toBeUndefined();
      expect(() => trackerRef.current.refresh()).not.toThrow();

      root.unmount();
      await expect(destroyed).resolves.toBeUndefined();
    } finally {
      capture.stop();
    }
  });

  it('does not run the second Vue array-bound emit listener after the first throws, unlike Core or Angular output subscribers', async () => {
    const host = document.createElement('div');

    document.body.appendChild(host);

    const order = [];
    let componentInstance = null;
    const app = createApp({
      render: () =>
        createVueElement(VueTracker, {
          options: {
            clustering: { enabled: false },
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          rules: [{ selector: '.vue-target' }],
          onMarkerActivate: [
            () => {
              order.push('first-vue-throws');
              throw new Error('First Vue emit listener failure.');
            },
            () => {
              order.push('second-vue');
            },
          ],
          ref: (instance) => {
            componentInstance = instance;
          },
        }),
    });
    const target = document.createElement('div');

    target.className = 'vue-target';
    host.appendChild(target);
    const componentRoot = document.createElement('div');

    host.appendChild(componentRoot);
    app.mount(componentRoot);

    await waitFor(
      () => host.querySelector('.rxtt[data-rxtt-geometry="available"] .rxtt__marker') !== null,
      'the mounted Vue array-listener marker',
    );

    const marker = host.querySelector('.rxtt__marker');

    if (marker === null || componentInstance === null) {
      throw new Error('Expected a mounted Vue marker and component instance.');
    }

    const capture = captureGlobalFailures();

    try {
      activate(marker);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(order).toEqual(['first-vue-throws']);
      await waitFor(() => capture.errors.length === 1, 'the host-reported Vue listener failure');
      expect(capture.errors[0]?.message).toBe('First Vue emit listener failure.');
      expect(capture.rejections).toHaveLength(0);
      expect(componentInstance.getStats().errors.byCode['integration-event-handler-error']).toBeUndefined();
    } finally {
      capture.stop();
      app.unmount();
    }
  });

  it('runs Angular output subscribers independently and keeps their failure outside Core diagnostics', async () => {
    const host = document.createElement('div');

    document.body.appendChild(host);
    const target = document.createElement('div');

    target.className = 'angular-target';
    host.appendChild(target);

    const container = document.createElement('rxt-tracker-angular');

    host.appendChild(container);

    const angularErrorHandler = new CapturingAngularErrorHandler();
    const application = await createApplication({
      providers: [{ provide: ErrorHandler, useValue: angularErrorHandler }],
    });
    const componentRef = createComponent(AngularTracker, {
      environmentInjector: application.injector,
      hostElement: container,
    });

    componentRef.setInput('options', {
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });
    componentRef.setInput('rules', [{ selector: '.angular-target' }]);

    const order = [];

    componentRef.instance.markerActivate.subscribe(() => {
      order.push('first-angular-throws');
      throw new Error('First Angular EventEmitter subscriber failure.');
    });
    componentRef.instance.markerActivate.subscribe(() => {
      order.push('second-angular');
    });

    application.attachView(componentRef.hostView);
    application.tick();

    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });

    const marker = container.querySelector('.rxtt__marker');

    if (marker === null) {
      throw new Error('Expected a mounted Angular marker.');
    }

    const capture = captureGlobalFailures();

    try {
      activate(marker);

      // Angular's modern output() channel isolates subscribers from each other.
      // The adapter's single Core forwarder completes normally, so the failure
      // does not become a Core event-handler diagnostic.
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(order).toEqual(['first-angular-throws', 'second-angular']);

      // The throwing subscriber's error is routed to the application-level
      // Angular ErrorHandler and nowhere else: no top-level uncaught error,
      // no unhandled rejection, and exactly one captured error whose identity
      // is the original thrown Error. Any extra Angular framework error would
      // push the captured count past one and fail here.
      expect(angularErrorHandler.errors).toHaveLength(1);
      expect(angularErrorHandler.errors[0]?.message).toBe('First Angular EventEmitter subscriber failure.');
      expect(capture.errors).toEqual([]);
      expect(capture.rejections).toEqual([]);
      expect(componentRef.instance.getStats().errors.byCode['integration-event-handler-error']).toBeUndefined();
    } finally {
      capture.stop();
      application.destroy();
    }
  });
});
