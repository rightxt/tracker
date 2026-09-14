import '@angular/compiler';

import { createComponent } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TrackerComponent as AngularTracker } from '../../packages/angular/src/public-api.ts';
// This root is frame-hosted for the initial (failing) mount, so only the
// `?raw` string module is needed here to seed the iframe fixture's stylesheet.
import trackerCss from '../../packages/core/src/styles/rxt-tracker.css?raw';
import { RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER } from './support/angular-error-handler.js';

/**
 * Loads a same-origin iframe with the tracker stylesheet already in its head.
 *
 * @returns {Promise<HTMLIFrameElement>} Loaded frame.
 */
function loadFrameFixture() {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');

    iframe.addEventListener('load', () => resolve(iframe), { once: true });
    iframe.addEventListener(
      'error',
      () => reject(new Error('Failed to load the Angular mount-failure-recovery iframe.')),
      { once: true },
    );
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

describe('Angular mount-failure recovery', () => {
  // The component retains its runtime after an initial mount failure so reconciliation
  // can remount the same ComponentRef generation once sourceRoot becomes valid.
  it('recovers a marker render after an initial cross-realm sourceRoot mount failure, once sourceRoot is corrected', async () => {
    const iframe = await loadFrameFixture();
    const frameDocument = iframe.contentDocument;

    if (!frameDocument) {
      throw new Error('Expected a loaded Angular mount-failure-recovery iframe document.');
    }

    const container = document.createElement('rxt-tracker-angular');

    document.body.appendChild(container);

    const application = await createApplication({
      providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
    });
    const componentRef = createComponent(AngularTracker, {
      environmentInjector: application.injector,
      hostElement: container,
    });

    componentRef.setInput('options', {
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });
    componentRef.setInput('rules', [{ selector: '.smoke-target' }]);
    componentRef.setInput('sourceRoot', frameDocument.body);
    application.attachView(componentRef.hostView);

    let firstError = null;

    try {
      application.tick();
    } catch (error) {
      firstError = error;
    }

    expect(firstError).toEqual(expect.objectContaining({ code: 'ERR_TRACKER_REALM_MISMATCH' }));

    // Observation 1: the ComponentRef itself survives the thrown mount error
    // well enough to keep answering getState() -- Angular did not tear down
    // the component, and #runtime is no longer destroyed on this path either.
    // Core itself already rolled the failed mount back to a live 'unmounted'
    // state.
    expect(componentRef.instance.getState()).toBe('unmounted');

    // Correct sourceRoot to a same-realm element and tick again.
    const validSourceRoot = document.createElement('main');
    const target = document.createElement('div');

    target.className = 'smoke-target';
    validSourceRoot.appendChild(target);
    document.body.appendChild(validSourceRoot);
    componentRef.setInput('sourceRoot', validSourceRoot);

    let secondError = null;

    try {
      application.tick();
    } catch (error) {
      secondError = error;
    }

    // Observation 2: #viewReady stayed true, so the reconciliation effect()
    // reached #remount() again and the same runtime generation recovers.
    expect(secondError).toBeNull();
    expect(componentRef.instance.getState()).toBe('mounted');
    expect(container.querySelector('.rxtt__marker')).not.toBeNull();

    expect(() => {
      application.destroy();
      container.remove();
    }).not.toThrow();
  });
});
