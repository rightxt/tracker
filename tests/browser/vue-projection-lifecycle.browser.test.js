import { createApp, createSSRApp, defineComponent, h as createVueElement, nextTick, shallowRef } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vue/src/Tracker.ts';
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

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Defines the real-browser lifecycle contract for the Vue Tracker projection.
 *
 * @param {string} label - Tracker label.
 * @param {import('vue').Component} TrackerComponent - Tracker component under test.
 * @returns {void}
 */
function defineBrowserLifecycleTests(label, TrackerComponent) {
  describe(`Vue ${label} browser lifecycle`, () => {
    // The simple marker-activation row is retired here: its final outward owner
    // is the cross-adapter parity window-mode activation contract. The
    // `activate()` helper stays in use by the simultaneous-change and teardown
    // scenarios below.

    it('recovers its generation after a cross-realm remount failure', async () => {
      const iframe = document.createElement('iframe');
      const sourceRoot = document.createElement('main');
      const container = document.createElement('div');
      const errors = [];
      let handle = null;

      document.body.append(iframe, sourceRoot, container);
      const sourceRootRef = shallowRef(sourceRoot);
      const app = createApp(
        defineComponent({
          setup: () => () =>
            createVueElement(TrackerComponent, {
              options: DISABLED_UPDATE_OPTIONS,
              ref: (nextHandle) => {
                handle = nextHandle;
              },
              sourceRoot: sourceRootRef.value,
            }),
        }),
      );

      app.config.errorHandler = (error) => errors.push(error);
      app.mount(container);
      await waitFor(() => handle?.getState() === 'mounted', 'initial mounted generation');
      const activeHandle = handle;
      const foreignSource = iframe.contentDocument?.body;

      if (foreignSource === undefined || foreignSource === null) {
        throw new Error('Expected an iframe source document.');
      }

      sourceRootRef.value = foreignSource;
      await waitFor(() => errors.length === 1, 'cross-realm remount failure');
      await waitFor(() => activeHandle.getState() === 'unmounted', 'unmounted generation after remount failure');

      expect(errors[0]).toMatchObject({ code: 'ERR_TRACKER_REALM_MISMATCH', name: 'TrackerLifecycleError' });
      expect(container.querySelector('.rxtt__marker')).toBeNull();

      sourceRootRef.value = sourceRoot;
      await waitFor(() => activeHandle.getState() === 'mounted', 'recovered generation after restoring the root');

      expect(handle).toBe(activeHandle);
      expect(container.querySelector('.rxtt')?.getAttribute('data-rxtt-geometry')).toBe('available');
      app.unmount();
    });

    it('remounts once when source and rules change simultaneously', async () => {
      const firstSource = document.createElement('main');
      const secondSource = document.createElement('main');
      const firstTarget = document.createElement('div');
      const secondTarget = document.createElement('div');
      const container = document.createElement('div');
      const markerEvents = [];

      firstTarget.className = 'vue-projection-browser-first-target';
      secondTarget.className = 'vue-projection-browser-second-target';
      firstSource.append(firstTarget);
      secondSource.append(secondTarget);
      document.body.append(firstSource, secondSource, container);

      const sourceRootRef = shallowRef(firstSource);
      const selectorRef = shallowRef('.vue-projection-browser-first-target');
      const app = createApp(
        defineComponent({
          setup: () => () =>
            createVueElement(TrackerComponent, {
              onMarkerActivate: (payload) => markerEvents.push(payload),
              options: DISABLED_UPDATE_OPTIONS,
              rules: [{ selector: selectorRef.value }],
              sourceRoot: sourceRootRef.value,
            }),
        }),
      );

      app.mount(container);
      await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'initial projection marker');
      const trackerRoot = container.querySelector('.rxtt');

      sourceRootRef.value = secondSource;
      selectorRef.value = '.vue-projection-browser-second-target';
      await nextTick();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      await nextTick();
      await waitFor(() => container.querySelectorAll('.rxtt__marker').length === 1, 'remounted projection marker');
      activate(container.querySelector('.rxtt__marker'), 202);
      await waitFor(() => markerEvents.length === 1, 'marker activation after remount');

      expect(container.querySelector('.rxtt')).toBe(trackerRoot);
      expect(container.querySelectorAll('.rxtt__marker')).toHaveLength(1);
      app.unmount();
    });

    it('hydrates the configured deterministic shell attributes without mismatch warnings', async () => {
      const props = { options: { orientation: 'horizontal', placement: 'top' } };
      const html = await renderToString(createSSRApp(TrackerComponent, props));
      const container = document.createElement('div');

      expect(html).toContain('data-rxtt-orientation="horizontal"');
      expect(html).toContain('data-rxtt-placement="top"');
      expect(html).toContain('data-rxtt-geometry="unavailable"');

      container.innerHTML = html;
      document.body.append(container);
      const app = createSSRApp(TrackerComponent, props);
      const warnings = [];
      const errors = [];

      app.config.warnHandler = (warning) => warnings.push(warning);
      app.config.errorHandler = (error) => errors.push(error);
      app.mount(container);
      await waitFor(() => container.querySelector('.rxtt') !== null, 'hydrated shell root');

      expect(warnings).toEqual([]);
      expect(errors).toEqual([]);
      expect(container.querySelector('.rxtt')?.getAttribute('data-rxtt-placement')).toBe('top');
      app.unmount();
    });

    it('leaves no marker DOM or listeners after unmount', async () => {
      const sourceRoot = document.createElement('main');
      const target = document.createElement('div');
      const container = document.createElement('div');
      const markerEvents = [];

      target.className = 'vue-projection-browser-teardown-target';
      sourceRoot.append(target);
      document.body.append(sourceRoot, container);
      const app = createApp({
        render: () =>
          createVueElement(TrackerComponent, {
            onMarkerActivate: (payload) => markerEvents.push(payload),
            options: DISABLED_UPDATE_OPTIONS,
            rules: [{ selector: '.vue-projection-browser-teardown-target' }],
            sourceRoot,
          }),
      });

      app.mount(container);
      await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'initial projection marker');
      const marker = container.querySelector('.rxtt__marker');

      app.unmount();

      expect(container.querySelector('.rxtt')).toBeNull();
      expect(container.querySelector('.rxtt__marker')).toBeNull();

      // onBeforeUnmount synchronously disconnects Core's native pointer/click
      // listeners (InteractionController.disconnect()) before app.unmount()
      // returns, and Core's event publication is itself synchronous, so a
      // post-unmount activate() reaches no handler at all - no async boundary
      // to cross here.
      activate(marker, 203);

      expect(markerEvents).toHaveLength(0);
    });
  });
}

defineBrowserLifecycleTests('Tracker', Tracker);
