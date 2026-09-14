import '@angular/compiler';

import { createComponent } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, h as createVueElement, nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { TrackerComponent as AngularTracker } from '../../packages/angular/src/public-api.ts';
import { Tracker as ReactTracker } from '../../packages/react/src/index.ts';
import { Tracker } from '../../packages/vanilla/src/index.ts';
import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';
import { RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER } from './support/angular-error-handler.js';

/** Removes browser fixtures after every rejected-promise scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

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
 * Waits long enough for a microtask-settled rejection to be observed by
 * either Core diagnostics, a framework error channel, or the browser's
 * native `unhandledrejection` detector, all of which resolve within a
 * handful of microtask/macrotask turns of the rejection being created.
 *
 * @returns {Promise<void>} Resolves after the wait.
 */
async function waitForRejectionSettlement() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
}

/**
 * Installs a window-level `unhandledrejection` capture. The intentional
 * rejections created by these scenarios are the tested contract, so the
 * listener records the reason and then calls `preventDefault()` to take
 * local ownership of the event away from the browser's default handling.
 *
 * @param {unknown[]} sink - Array collecting observed rejection reasons.
 * @returns {() => void} Restores the previous window listener.
 */
function captureUnhandledRejections(sink) {
  const onUnhandledRejection = (event) => {
    sink.push(event.reason);
    event.preventDefault();
  };

  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => window.removeEventListener('unhandledrejection', onUnhandledRejection);
}

describe('rejected-Promise ownership across public notification channels', () => {
  it('leaves a rejected Promise from a Vanilla event handler outside Core diagnostics', async () => {
    const target = document.createElement('div');

    target.className = 'direct-rejection-target';
    document.body.appendChild(target);

    const unhandledRejections = [];
    const restoreUnhandledRejections = captureUnhandledRejections(unhandledRejections);
    const tracker = new Tracker({
      options: disabledUpdateOptions,
      rules: [{ selector: '.direct-rejection-target' }],
    });

    try {
      tracker.on('sync:start', () => Promise.reject(new Error('direct-on-rejection')));
      tracker.mount();

      await waitForRejectionSettlement();

      const stats = tracker.getStats();

      expect(stats.errors.byCode['integration-event-handler-error']).toBeUndefined();
      expect(unhandledRejections).toHaveLength(1);
      expect(unhandledRejections[0]?.message).toBe('direct-on-rejection');
    } finally {
      tracker.destroy();
      restoreUnhandledRejections();
    }
  });

  it('leaves a rejected Promise from a React callback prop outside Core diagnostics', async () => {
    const container = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'react-rejection-target';
    document.body.append(target, container);

    const unhandledRejections = [];
    const restoreUnhandledRejections = captureUnhandledRejections(unhandledRejections);
    const trackerRef = createRef(null);
    const root = createRoot(container);

    try {
      root.render(
        createElement(ReactTracker, {
          onSyncStart: () => Promise.reject(new Error('react-sync-start-rejection')),
          options: disabledUpdateOptions,
          ref: trackerRef,
          rules: [{ selector: '.react-rejection-target' }],
        }),
      );

      await waitForRejectionSettlement();

      const stats = trackerRef.current.getStats();

      expect(stats.errors.byCode['integration-event-handler-error']).toBeUndefined();
      expect(unhandledRejections).toHaveLength(1);
      expect(unhandledRejections[0]?.message).toBe('react-sync-start-rejection');
    } finally {
      root.unmount();
      restoreUnhandledRejections();
    }
  });

  it('leaves a rejected Promise from a public snapshot subscriber outside Core diagnostics', async () => {
    const target = document.createElement('div');

    target.className = 'snapshot-rejection-target';
    document.body.appendChild(target);

    const unhandledRejections = [];
    const restoreUnhandledRejections = captureUnhandledRejections(unhandledRejections);
    const tracker = new Tracker({
      options: disabledUpdateOptions,
      rules: [{ selector: '.snapshot-rejection-target' }],
    });
    const unsubscribe = tracker.subscribeSnapshot(() => Promise.reject(new Error('snapshot-listener-rejection')));

    try {
      tracker.mount();

      await waitForRejectionSettlement();

      expect(tracker.getStats().errors.total).toBe(0);
      expect(unhandledRejections).toHaveLength(1);
      expect(unhandledRejections[0]?.message).toBe('snapshot-listener-rejection');
    } finally {
      unsubscribe();
      tracker.destroy();
      restoreUnhandledRejections();
    }
  });

  it('routes a rejected Promise from a Vue onSyncStart prop through Vue error handling', async () => {
    const container = document.createElement('div');
    const target = document.createElement('div');

    target.className = 'vue-rejection-target';
    document.body.append(target, container);

    const unhandledRejections = [];
    const restoreUnhandledRejections = captureUnhandledRejections(unhandledRejections);
    const vueErrors = [];
    let trackerExposed = null;

    const app = createApp({
      render: () =>
        createVueElement(VueTracker, {
          onSyncStart: () => Promise.reject(new Error('vue-sync-start-rejection')),
          options: disabledUpdateOptions,
          ref: (instance) => {
            trackerExposed = instance;
          },
          rules: [{ selector: '.vue-rejection-target' }],
        }),
    });

    app.config.errorHandler = (error) => vueErrors.push(error);

    try {
      app.mount(container);
      await nextTick();
      await waitForRejectionSettlement();

      const stats = trackerExposed.getStats();

      expect(stats.errors.byCode['integration-event-handler-error']).toBeUndefined();
      expect(unhandledRejections).toEqual([]);
      expect(vueErrors).toHaveLength(1);
      expect(vueErrors[0]?.message).toBe('vue-sync-start-rejection');
    } finally {
      app.unmount();
      restoreUnhandledRejections();
    }
  });

  it('leaves a rejected Promise from an Angular syncStart subscriber unobserved by the output channel', async () => {
    const host = document.createElement('rxt-tracker-angular');
    const target = document.createElement('div');

    target.className = 'angular-rejection-target';
    document.body.append(target, host);

    const unhandledRejections = [];
    const restoreUnhandledRejections = captureUnhandledRejections(unhandledRejections);
    const application = await createApplication({
      providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
    });
    const componentRef = createComponent(AngularTracker, {
      environmentInjector: application.injector,
      hostElement: host,
    });

    componentRef.setInput('options', disabledUpdateOptions);
    componentRef.setInput('rules', [{ selector: '.angular-rejection-target' }]);
    componentRef.instance.syncStart.subscribe(() => Promise.reject(new Error('angular-sync-start-rejection')));

    try {
      application.attachView(componentRef.hostView);
      application.tick();

      await waitForRejectionSettlement();

      const stats = componentRef.instance.getStats();

      expect(stats.errors.byCode['integration-event-handler-error']).toBeUndefined();
      expect(unhandledRejections).toHaveLength(1);
      expect(unhandledRejections[0]?.message).toBe('angular-sync-start-rejection');
    } finally {
      application.destroy();
      restoreUnhandledRejections();
    }
  });
});
