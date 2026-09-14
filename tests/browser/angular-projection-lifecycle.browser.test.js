import '@angular/compiler';

import { provideZoneChangeDetection, provideZonelessChangeDetection } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TrackerComponent } from '../../packages/angular/src/TrackerComponent.ts';
import { RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER } from './support/angular-error-handler.js';
import { waitFor } from './support/wait-for.js';
import { dispatchPointerActivation as activate } from './support/pointer.js';

/** Tracker options that remove asynchronous observer noise from lifecycle tests. */
const DISABLED_UPDATE_OPTIONS = {
  clustering: { enabled: false },
  updates: {
    interval: { enabled: false },
    mutation: { enabled: false },
    resize: { enabled: false },
    scroll: { enabled: false },
  },
};

/**
 * Bootstraps one Tracker fixture with the given root providers.
 *
 * @param {import('@angular/core').Provider[]} providers - Root application providers.
 * @param {import('@angular/core').Type<TrackerComponent>} componentType - Tracker component type.
 * @param {string} hostName - Tracker host element name.
 * @returns {Promise<{application: import('@angular/core').ApplicationRef, component: import('@angular/core').ComponentRef<TrackerComponent>, detectChanges: () => void, host: HTMLElement}>}
 */
async function mountTracker(providers, componentType, hostName) {
  const application = await createApplication({
    providers: [...providers, RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
  });
  const host = document.createElement(hostName);

  document.body.appendChild(host);

  const component = application.bootstrap(componentType, host);
  const detectChanges = () => component.changeDetectorRef.detectChanges();

  detectChanges();
  await Promise.resolve();
  detectChanges();

  return { application, component, detectChanges, host };
}

/**
 * Destroys a mounted fixture and removes its host element.
 *
 * @param {{application: import('@angular/core').ApplicationRef, host: HTMLElement}} mounted - Fixture to tear down.
 * @returns {void}
 */
function destroyTracker(mounted) {
  mounted.application.destroy();
  mounted.host.remove();
}

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Runs the production-browser lifecycle scenario set against one Angular
 * change-detection mode, so real DOM behavior driven by a synthetic pointer
 * sequence is proven under both zoneless and zone.js-patched event dispatch.
 *
 * @param {string} trackerLabel - Human-readable Tracker name used in test titles.
 * @param {string} modeLabel - Human-readable mode name used in test titles.
 * @param {() => Promise<{application: import('@angular/core').ApplicationRef, component: import('@angular/core').ComponentRef<TrackerComponent>, detectChanges: () => void, host: HTMLElement}>} mountInMode - Bootstraps one fixture in the current mode.
 * @param {boolean} includeCrossRealmRemount - Whether to register the cross-realm
 *   remount rejection scenario for this mode. The realm-validation/remount
 *   algorithm has no change-detection-mode-conditioned branch, so it is
 *   registered for zoneless only; the zoneful NgZone harness separately owns the
 *   actual zone boundary.
 * @returns {void}
 */
function defineBrowserLifecycleTests(trackerLabel, modeLabel, mountInMode, includeCrossRealmRemount) {
  describe(`Angular projection ${trackerLabel} browser lifecycle (${modeLabel})`, () => {
    it('activates markers through a synthetic pointer sequence', async () => {
      const sourceRoot = document.createElement('main');
      const target = document.createElement('div');
      const markerEvents = [];

      target.className = 'angular-projection-browser-activation-target';
      sourceRoot.append(target);
      document.body.append(sourceRoot);

      const mounted = await mountInMode();

      mounted.component.instance.markerActivate.subscribe((payload) => markerEvents.push(payload));
      mounted.component.setInput('options', DISABLED_UPDATE_OPTIONS);
      mounted.component.setInput('rules', [{ selector: '.angular-projection-browser-activation-target' }]);
      mounted.component.setInput('sourceRoot', sourceRoot);
      mounted.detectChanges();
      await waitFor(() => mounted.host.querySelector('.rxtt__marker') !== null, 'initial projection marker');

      activate(mounted.host.querySelector('.rxtt__marker'), 301);
      await waitFor(() => markerEvents.length === 1, 'marker activation payload');

      expect(markerEvents).toHaveLength(1);
      destroyTracker(mounted);
      sourceRoot.remove();
    });

    // Cluster activation's dedicated dual-mode rows are retired here: its final
    // outward owner is the cross-adapter parity window-mode activation contract
    // (real cluster DOM, primary-pointer activation, Angular `clusterActivate`
    // output, `count === 2`), and the zone-conditioned part is already
    // represented by marker activation in both modes plus the package NgZone
    // boundary.

    if (includeCrossRealmRemount) {
      it('rejects a cross-realm remount without corrupting the mounted generation', async () => {
        const iframe = document.createElement('iframe');
        const sourceRoot = document.createElement('main');

        document.body.append(iframe, sourceRoot);

        const mounted = await mountInMode();
        const foreignSource = iframe.contentDocument?.body;

        if (foreignSource === undefined || foreignSource === null) {
          throw new Error('Expected an iframe source document.');
        }

        mounted.component.setInput('options', DISABLED_UPDATE_OPTIONS);
        mounted.component.setInput('sourceRoot', sourceRoot);
        mounted.detectChanges();
        await waitFor(() => mounted.component.instance.getState() === 'mounted', 'initial mounted generation');

        mounted.component.setInput('sourceRoot', foreignSource);

        expect(() => mounted.detectChanges()).toThrow(
          expect.objectContaining({ code: 'ERR_TRACKER_REALM_MISMATCH', name: 'TrackerLifecycleError' }),
        );
        expect(mounted.host.querySelector('.rxtt__marker')).toBeNull();
        expect(mounted.component.instance.getStats().errors.byCode['invalid-mount-context']).toBe(1);

        destroyTracker(mounted);
        iframe.remove();
        sourceRoot.remove();
      });
    }

    it('remounts once when source and rules change simultaneously', async () => {
      const firstSource = document.createElement('main');
      const secondSource = document.createElement('main');
      const firstTarget = document.createElement('div');
      const secondTarget = document.createElement('div');
      const markerEvents = [];

      firstTarget.className = 'angular-projection-browser-first-target';
      secondTarget.className = 'angular-projection-browser-second-target';
      firstSource.append(firstTarget);
      secondSource.append(secondTarget);
      document.body.append(firstSource, secondSource);

      const mounted = await mountInMode();

      mounted.component.instance.markerActivate.subscribe((payload) => markerEvents.push(payload));
      mounted.component.setInput('options', DISABLED_UPDATE_OPTIONS);
      mounted.component.setInput('rules', [{ selector: '.angular-projection-browser-first-target' }]);
      mounted.component.setInput('sourceRoot', firstSource);
      mounted.detectChanges();
      await waitFor(() => mounted.host.querySelector('.rxtt__marker') !== null, 'initial projection marker');
      const trackerRoot = mounted.host.querySelector('.rxtt');

      mounted.component.setInput('rules', [{ selector: '.angular-projection-browser-second-target' }]);
      mounted.component.setInput('sourceRoot', secondSource);
      mounted.detectChanges();
      await waitFor(() => mounted.host.querySelectorAll('.rxtt__marker').length === 1, 'remounted projection marker');

      activate(mounted.host.querySelector('.rxtt__marker'), 303);
      await waitFor(() => markerEvents.length === 1, 'marker activation after remount');

      expect(mounted.host.querySelector('.rxtt')).toBe(trackerRoot);
      expect(mounted.host.querySelectorAll('.rxtt__marker')).toHaveLength(1);
      destroyTracker(mounted);
      firstSource.remove();
      secondSource.remove();
    });

    it('leaves no marker DOM or listeners after unmount', async () => {
      const sourceRoot = document.createElement('main');
      const target = document.createElement('div');
      const markerEvents = [];

      target.className = 'angular-projection-browser-teardown-target';
      sourceRoot.append(target);
      document.body.append(sourceRoot);

      const mounted = await mountInMode();

      mounted.component.instance.markerActivate.subscribe((payload) => markerEvents.push(payload));
      mounted.component.setInput('options', DISABLED_UPDATE_OPTIONS);
      mounted.component.setInput('rules', [{ selector: '.angular-projection-browser-teardown-target' }]);
      mounted.component.setInput('sourceRoot', sourceRoot);
      mounted.detectChanges();
      await waitFor(() => mounted.host.querySelector('.rxtt__marker') !== null, 'initial projection marker');
      const marker = mounted.host.querySelector('.rxtt__marker');
      const trackerRoot = mounted.host.querySelector('.rxtt');

      destroyTracker(mounted);

      // Angular's application.destroy() detaches the whole bootstrap host from its
      // own parent rather than clearing its rendered content in place, so the
      // absence check must target document containment, not a query scoped to the
      // (still internally intact) detached host - see teardown-reactive-write
      // .browser.test.js for the same behavior in another teardown scenario.
      expect(document.body.contains(mounted.host)).toBe(false);
      expect(document.contains(trackerRoot)).toBe(false);

      // ngOnDestroy synchronously disconnects Core's native pointer/click
      // listeners (InteractionController.disconnect()) before
      // application.destroy() returns, and Core's event publication is itself
      // synchronous, so a post-destroy activate() reaches no handler at all -
      // no async boundary to cross here.
      activate(marker, 304);

      expect(markerEvents).toHaveLength(0);
      sourceRoot.remove();
    });
  });
}

describe('zoneless', () => {
  defineBrowserLifecycleTests(
    'Tracker',
    'zoneless',
    () => mountTracker([provideZonelessChangeDetection()], TrackerComponent, 'rxt-tracker-angular'),
    true,
  );
});

describe('zoneful (zone.js)', () => {
  beforeAll(async () => {
    // zone.js patches globals process-wide once loaded, so it must stay confined to this
    // describe block and run strictly after the zoneless scenarios above have finished.
    await import('zone.js');
  });

  defineBrowserLifecycleTests(
    'Tracker',
    'zoneful',
    () => mountTracker([provideZoneChangeDetection()], TrackerComponent, 'rxt-tracker-angular'),
    false,
  );
});
