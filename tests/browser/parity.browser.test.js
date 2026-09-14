import '@angular/compiler';

import { createComponent } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, h as createVueElement } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { TrackerElement, defineTrackerElement } from '../../packages/element/src/index.ts';
import { TrackerComponent as AngularTracker } from '../../packages/angular/src/public-api.ts';
import { Tracker as ReactTracker } from '../../packages/react/src/index.ts';
import { Tracker } from '../../packages/vanilla/src/index.ts';
import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER } from './support/angular-error-handler.js';
import { settleFrames } from './support/settle-frames.js';
import { waitFor } from './support/wait-for.js';

defineTrackerElement();

/** Creates a registered Custom Element instance through the browser registry. */
function createTrackerElement() {
  const element = document.createElement('rxt-tracker');

  if (!(element instanceof TrackerElement)) {
    throw new Error('Expected the registered rxt-tracker Custom Element.');
  }

  return element;
}

/**
 * Waits for a framework-mounted parity root whose first real render pass has
 * committed, including its marker layer.
 *
 * React/Vue/Angular mount the runtime from a post-render lifecycle hook
 * (`useLayoutEffect`, `onMounted`, `ngOnInit`-equivalent), so the `.rxtt`
 * root element already exists — with `data-rxtt-geometry="unavailable"` —
 * one commit before that hook runs. Waiting only for the element's presence
 * races the second, marker-populating commit.
 *
 * The `data-rxtt-geometry` attribute alone is not a sufficient proxy for
 * that second commit either: core writes it straight onto the real root
 * node with an imperative `setAttribute` call during `mount()`
 * (`packages/core/src/tracker/lifecycle.ts`), before it computes the marker
 * list, and independently of the framework's own reactive re-render that
 * turns `snapshot.items` into `.rxtt__marker` DOM nodes (e.g.
 * `packages/react/src/Tracker.tsx`'s `useSyncExternalStore`-driven render).
 * That reactive re-render's flush timing is not guaranteed outside `act()`,
 * so under load (observed intermittently under WebKit in a full-suite run)
 * the geometry attribute can read `"available"` for several ticks before the
 * marker layer actually gains children. Waiting for both the attribute and
 * actual marker content closes that race.
 *
 * @param {HTMLElement} host - Host element the integration rendered into.
 * @param {string} description - Failure description for the timeout error.
 * @returns {Promise<void>}
 */
async function waitForMountedParityRoot(host, description) {
  await waitFor(() => {
    const root = host.querySelector('.rxtt[data-rxtt-geometry="available"]');

    return root !== null && root.querySelector('.rxtt__marker') !== null;
  }, description);
}

/** Monotonic pointer-id source keeping every synthetic session distinct. */
let nextPointerId = 100;

/**
 * Dispatches one primary-pointer event and returns it.
 *
 * @param {Element} target - Pointer event target.
 * @param {string} type - Pointer event type.
 * @param {PointerEventInit} init - Additional pointer coordinates and state.
 * @returns {PointerEvent} Dispatched event.
 */
function dispatchPointer(target, type, init = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    cancelable: true,
    isPrimary: true,
    ...init,
  });

  target.dispatchEvent(event);

  return event;
}

/**
 * Dispatches a complete primary-pointer activation sequence.
 *
 * @param {Element} target - Pointer event target.
 * @param {PointerEventInit} init - Additional pointer coordinates.
 * @returns {MouseEvent} The dispatched semantic click event.
 */
function dispatchPrimaryPointerSequence(target, init = {}) {
  const pointerId = nextPointerId;

  nextPointerId += 1;
  dispatchPointer(target, 'pointerdown', { ...init, pointerId });

  dispatchPointer(target, 'pointerup', { ...init, pointerId });

  const click = new MouseEvent('click', { ...init, bubbles: true, button: 0, cancelable: true });

  target.dispatchEvent(click);

  return click;
}

/**
 * Dispatches a complete primary-pointer drag session along the y axis.
 *
 * @param {Element} target - Delegated tracker root.
 * @param {{ startY: number, endY: number, x: number }} coordinates - Session coordinates.
 */
function dispatchPrimaryPointerDrag(target, { startY, endY, x }) {
  const pointerId = nextPointerId;

  nextPointerId += 1;
  dispatchPointer(target, 'pointerdown', { clientX: x, clientY: startY, pointerId });
  dispatchPointer(target, 'pointermove', { clientX: x, clientY: endY, pointerId });
  dispatchPointer(target, 'pointerup', { clientX: x, clientY: endY, pointerId });
}

/**
 * Returns marker and cluster elements of one tracker root in record order.
 *
 * @param {HTMLElement} root - Actual tracker render root.
 * @returns {{ markers: HTMLElement[], clusters: HTMLElement[] }} Rendered items.
 */
function getRenderedItems(root) {
  return {
    markers: Array.from(root.querySelectorAll('.rxtt__marker[data-rxtt-kind="marker"]')),
    clusters: Array.from(root.querySelectorAll('.rxtt__marker[data-rxtt-kind="cluster"]')),
  };
}

/**
 * Creates the shared window-mode fixture: one single marker, one focusable
 * marker, and one adjacent pair that clusters under the default threshold.
 *
 * @returns {{ focusTarget: HTMLElement }} Fixture handles.
 */
function createWindowParityFixture() {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = `
    <div class="parity-single" style="height: 40px; margin-top: 200px;"></div>
    <div class="parity-focus" tabindex="-1" style="height: 40px; margin-top: 600px;"></div>
    <div class="parity-pair" style="height: 10px; margin-top: 600px;"></div>
    <div class="parity-pair" style="height: 10px;"></div>
    <div style="height: 2000px;"></div>
  `;
  document.body.appendChild(wrapper);

  const focusTarget = wrapper.querySelector('.parity-focus');

  if (!(focusTarget instanceof HTMLElement)) {
    throw new Error('Expected the parity window fixture focus target.');
  }

  return { focusTarget };
}

/**
 * Creates the shared element-mode fixture with the same rule population.
 *
 * @param {string} scrollerStyle - Extra inline styles for the scroller.
 * @returns {{ host: HTMLElement, scroller: HTMLElement, focusTarget: HTMLElement }} Fixture handles.
 */
function createElementParityFixture(scrollerStyle = '') {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = `
    <div class="parity-host" style="position: relative; height: 200px; width: 400px;">
      <div class="parity-scroller" style="height: 200px; overflow-y: auto; ${scrollerStyle}">
        <div class="parity-single" style="height: 40px;"></div>
        <div style="height: 400px;"></div>
        <div class="parity-focus" tabindex="-1" style="height: 40px;"></div>
        <div style="height: 300px;"></div>
        <div class="parity-pair" style="height: 10px;"></div>
        <div class="parity-pair" style="height: 10px;"></div>
        <div style="height: 440px;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  const host = wrapper.querySelector('.parity-host');
  const scroller = wrapper.querySelector('.parity-scroller');
  const focusTarget = wrapper.querySelector('.parity-focus');

  if (!(host instanceof HTMLElement) || !(scroller instanceof HTMLElement) || !(focusTarget instanceof HTMLElement)) {
    throw new Error('Expected a complete parity element fixture.');
  }

  return { host, scroller, focusTarget };
}

/**
 * Returns the shared parity rule list.
 *
 * @returns {object[]} Tracker rules.
 */
function createParityRules() {
  return [
    { selector: '.parity-single' },
    { selector: '.parity-focus', scroll: { behavior: 'smooth' }, focus: { enabled: true } },
    { selector: '.parity-pair' },
  ];
}

/**
 * Creates a fresh connected host for one integration instance.
 *
 * @returns {HTMLElement} Connected host element.
 */
function createIntegrationHost() {
  const host = document.createElement('div');

  host.className = 'parity-integration-host';
  document.body.appendChild(host);

  return host;
}

/**
 * @typedef {object} ParityHandle
 * @property {() => HTMLElement | null} getRoot - Actual `.rxtt` render root.
 * @property {object[]} markerEvents - Collected marker activation payloads.
 * @property {object[]} clusterEvents - Collected cluster activation payloads.
 * @property {object[]} trackEvents - Collected track activation payloads.
 * @property {object[]} selectionEvents - Collected selection change payloads.
 * @property {() => Promise<void>} detach - Ordinary integration unmount.
 * @property {() => Promise<void>} attach - Ordinary integration remount.
 * @property {() => Promise<void>} destroy - Final integration teardown.
 */

/**
 * Adapter descriptors implementing one shared creation contract per integration.
 *
 * `create` mounts the integration with the provided options into `host`;
 * `scrollRoot` selects element mode when provided.
 */
const ADAPTERS = [
  {
    name: 'vanilla',
    /**
     * @param {{ options: object, host: HTMLElement, scrollRoot?: HTMLElement }} context - Creation context.
     * @returns {Promise<ParityHandle>} Integration handle.
     */
    async create({ options, host, scrollRoot }) {
      const { rules, ...trackerOptions } = options;
      const tracker = new Tracker({ options: trackerOptions, rules: rules ?? [] });
      const markerEvents = [];
      const clusterEvents = [];
      const trackEvents = [];
      const selectionEvents = [];
      const request = scrollRoot === undefined ? { renderHost: host } : { renderHost: host, scrollRoot };

      tracker.on('marker:activate', (payload) => markerEvents.push(payload));
      tracker.on('cluster:activate', (payload) => clusterEvents.push(payload));
      tracker.on('track:activate', (payload) => trackEvents.push(payload));
      tracker.on('selection:change', (payload) => selectionEvents.push(payload));
      tracker.mount(request);

      return {
        markerEvents,
        clusterEvents,
        trackEvents,
        selectionEvents,
        getRoot: () => tracker.root,
        detach: async () => {
          tracker.unmount();
        },
        attach: async () => {
          tracker.mount(request);
        },
        destroy: async () => {
          tracker.destroy();
        },
      };
    },
  },
  {
    name: 'element',
    /**
     * @param {{ options: object, host: HTMLElement, scrollRoot?: HTMLElement }} context - Creation context.
     * @returns {Promise<ParityHandle>} Integration handle.
     */
    async create({ options, host, scrollRoot }) {
      const element = createTrackerElement();
      const markerEvents = [];
      const clusterEvents = [];
      const trackEvents = [];
      const selectionEvents = [];
      const wireEvents = () => {
        element.addEventListener('marker:activate', (event) => markerEvents.push(event.detail));
        element.addEventListener('cluster:activate', (event) => clusterEvents.push(event.detail));
        element.addEventListener('track:activate', (event) => trackEvents.push(event.detail));
        element.addEventListener('selection:change', (event) => selectionEvents.push(event.detail));
      };

      const { rules, ...elementOptions } = options;

      element.replaceOptions(elementOptions);
      element.replaceRules(rules ?? []);

      if (scrollRoot !== undefined) {
        element.scrollRoot = scrollRoot;
      }

      wireEvents();
      host.appendChild(element);
      await waitFor(() => element.querySelector('.rxtt') !== null, 'the Custom Element parity root');

      return {
        markerEvents,
        clusterEvents,
        trackEvents,
        selectionEvents,
        getRoot: () => element.querySelector('.rxtt'),
        detach: async () => {
          element.remove();
        },
        attach: async () => {
          host.appendChild(element);
          await waitFor(() => element.querySelector('.rxtt') !== null, 'the reconnected Custom Element');
        },
        destroy: async () => {
          element.remove();
        },
      };
    },
  },
  {
    name: 'react',
    /**
     * @param {{ options: object, host: HTMLElement, scrollRoot?: HTMLElement }} context - Creation context.
     * @returns {Promise<ParityHandle>} Integration handle.
     */
    async create({ options, host, scrollRoot }) {
      const reactRoot = createRoot(host);
      const markerEvents = [];
      const clusterEvents = [];
      const trackEvents = [];
      const selectionEvents = [];
      const { rules, ...reactOptions } = options;
      const renderTracker = () =>
        reactRoot.render(
          createElement(ReactTracker, {
            options: reactOptions,
            rules: rules ?? [],
            ...(scrollRoot === undefined ? {} : { scrollRoot }),
            onMarkerActivate: (payload) => markerEvents.push(payload),
            onClusterActivate: (payload) => clusterEvents.push(payload),
            onTrackActivate: (payload) => trackEvents.push(payload),
            onSelectionChange: (payload) => selectionEvents.push(payload),
          }),
        );

      renderTracker();
      await waitForMountedParityRoot(host, 'the React parity root');

      return {
        markerEvents,
        clusterEvents,
        trackEvents,
        selectionEvents,
        getRoot: () => host.querySelector('.rxtt'),
        detach: async () => {
          reactRoot.render(null);
          await waitFor(() => host.querySelector('.rxtt') === null, 'the React parity unmount');
          await settleFrames(window, 1);
        },
        attach: async () => {
          renderTracker();
          await waitForMountedParityRoot(host, 'the remounted React parity root');
        },
        destroy: async () => {
          reactRoot.unmount();
          await settleFrames(window, 1);
        },
      };
    },
  },
  {
    name: 'vue',
    /**
     * @param {{ options: object, host: HTMLElement, scrollRoot?: HTMLElement }} context - Creation context.
     * @returns {Promise<ParityHandle>} Integration handle.
     */
    async create({ options, host, scrollRoot }) {
      const markerEvents = [];
      const clusterEvents = [];
      const trackEvents = [];
      const selectionEvents = [];
      const { rules, ...vueOptions } = options;
      let app = null;
      const mountApp = () => {
        app = createApp({
          render: () =>
            createVueElement(VueTracker, {
              options: vueOptions,
              rules: rules ?? [],
              ...(scrollRoot === undefined ? {} : { scrollRoot }),
              onMarkerActivate: (payload) => markerEvents.push(payload),
              onClusterActivate: (payload) => clusterEvents.push(payload),
              onTrackActivate: (payload) => trackEvents.push(payload),
              onSelectionChange: (payload) => selectionEvents.push(payload),
            }),
        });
        app.mount(host);
      };

      mountApp();
      await waitForMountedParityRoot(host, 'the Vue parity root');

      return {
        markerEvents,
        clusterEvents,
        trackEvents,
        selectionEvents,
        getRoot: () => host.querySelector('.rxtt'),
        detach: async () => {
          app?.unmount();
          app = null;
          await settleFrames(window, 1);
        },
        attach: async () => {
          mountApp();
          await waitForMountedParityRoot(host, 'the remounted Vue parity root');
        },
        destroy: async () => {
          app?.unmount();
          app = null;
        },
      };
    },
  },
  {
    name: 'angular',
    /**
     * @param {{ options: object, host: HTMLElement, scrollRoot?: HTMLElement }} context - Creation context.
     * @returns {Promise<ParityHandle>} Integration handle.
     */
    async create({ options, host, scrollRoot }) {
      const markerEvents = [];
      const clusterEvents = [];
      const trackEvents = [];
      const selectionEvents = [];
      const { rules, ...angularOptions } = options;
      let application = null;
      let container = null;
      const bootstrap = async () => {
        container = document.createElement('rxt-tracker-angular');
        host.appendChild(container);
        application = await createApplication({
          providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
        });

        // Inputs must be applied before the first change detection pass, as a
        // template binding would, so the runtime mounts with the real options.
        const componentRef = createComponent(AngularTracker, {
          environmentInjector: application.injector,
          hostElement: container,
        });

        componentRef.setInput('options', angularOptions);
        componentRef.setInput('rules', rules ?? []);

        if (scrollRoot !== undefined) {
          componentRef.setInput('scrollRoot', scrollRoot);
        }

        componentRef.instance.markerActivate.subscribe((payload) => markerEvents.push(payload));
        componentRef.instance.clusterActivate.subscribe((payload) => clusterEvents.push(payload));
        componentRef.instance.trackActivate.subscribe((payload) => trackEvents.push(payload));
        componentRef.instance.selectionChange.subscribe((payload) => selectionEvents.push(payload));
        application.attachView(componentRef.hostView);
        application.tick();
      };

      await bootstrap();
      await waitForMountedParityRoot(host, 'the Angular parity root');

      return {
        markerEvents,
        clusterEvents,
        trackEvents,
        selectionEvents,
        getRoot: () => host.querySelector('.rxtt'),
        detach: async () => {
          application?.destroy();
          application = null;
          container?.remove();
          container = null;
          await settleFrames(window, 1);
        },
        attach: async () => {
          await bootstrap();
          await waitForMountedParityRoot(host, 'the remounted Angular parity root');
        },
        destroy: async () => {
          application?.destroy();
          application = null;
          container?.remove();
          container = null;
        },
      };
    },
  },
];

beforeEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

afterEach(() => {
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

describe('Tier-2 integration parity contract', () => {
  it('removes an unavailable tracker shell from layout and hit testing', () => {
    const root = document.createElement('div');

    root.className = 'rxtt';
    root.setAttribute('data-rxtt-geometry', 'unavailable');
    root.setAttribute('data-rxtt-orientation', 'vertical');
    document.body.appendChild(root);

    const rect = root.getBoundingClientRect();

    expect(getComputedStyle(root).display).toBe('none');
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
    expect(document.elementFromPoint(0, 0)).not.toBe(root);
  });

  for (const adapter of ADAPTERS) {
    describe(adapter.name, () => {
      it('renders the shared Light DOM styling props contract with a hidden viewport indicator', async () => {
        createWindowParityFixture();

        const handle = await adapter.create({
          options: {
            a11y: { enabled: true, keyboard: true },
            clustering: { enabled: false },
            cssVariables: {
              '--app-parity-token': 'shared',
              '--rxtt-track-bg': 'rgb(1 2 3)',
            },
            marker: {
              attributes: {
                'data-global': 'global',
                'data-overridden': 'global',
                'data-suppressed': 'global',
              },
              className: 'parity-global-marker',
              title: false,
            },
            markerLayer: { className: 'parity-marker-layer' },
            rules: [
              {
                marker: {
                  attributes: {
                    'data-overridden': 'rule',
                    'data-suppressed': null,
                  },
                  className: 'parity-rule-marker',
                  cssVariables: { '--rxtt-marker-bg': 'rgb(4 5 6)' },
                },
                selector: '.parity-single',
              },
            ],
            track: { className: 'parity-track' },
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
            viewport: { className: 'parity-viewport', enabled: false },
          },
          host: createIntegrationHost(),
        });
        const root = handle.getRoot();

        if (!(root instanceof HTMLElement)) {
          throw new Error(`Expected a mounted ${adapter.name} styling root.`);
        }

        const viewport = root.querySelector(':scope > .rxtt__viewport');
        const markerLayer = root.querySelector(':scope > .rxtt__markers');
        const marker = markerLayer?.querySelector(':scope > .rxtt__marker');

        if (
          !(viewport instanceof HTMLElement) ||
          !(markerLayer instanceof HTMLElement) ||
          !(marker instanceof HTMLElement)
        ) {
          throw new Error(`Expected a complete ${adapter.name} styling tree.`);
        }

        expect(root.className).toBe('rxtt parity-track');
        expect(viewport.className).toBe('rxtt__viewport parity-viewport');
        expect(markerLayer.className).toBe('rxtt__markers parity-marker-layer');
        expect(marker.className).toBe('rxtt__marker parity-global-marker parity-rule-marker');
        expect(root.style.getPropertyValue('--app-parity-token')).toBe('shared');
        expect(root.style.getPropertyValue('--rxtt-track-bg')).toBe('rgb(1 2 3)');
        expect(marker.style.getPropertyValue('--rxtt-marker-bg')).toBe('rgb(4 5 6)');
        expect(marker.getAttribute('data-global')).toBe('global');
        expect(marker.getAttribute('data-overridden')).toBe('rule');
        expect(marker.hasAttribute('data-suppressed')).toBe(false);
        expect(marker.hasAttribute('title')).toBe(false);
        expect(marker.getAttribute('data-rxtt-selected')).toBe('true');

        // A disabled viewport keeps its application class but is hidden and
        // exposes no runtime viewport geometry custom properties.
        expect(viewport.hidden).toBe(true);
        expect(viewport.style.getPropertyValue('--rxtt-viewport-start')).toBe('');
        expect(viewport.style.getPropertyValue('--rxtt-viewport-size')).toBe('');

        await handle.destroy();
      });

      it('runs the window-mode activation contract on the actual render root', async () => {
        const { focusTarget } = createWindowParityFixture();
        const handle = await adapter.create({
          options: {
            rules: createParityRules(),
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          host: createIntegrationHost(),
        });
        const root = handle.getRoot();

        if (!(root instanceof HTMLElement)) {
          throw new Error(`Expected a mounted ${adapter.name} parity root.`);
        }

        expect(root.getAttribute('data-rxtt-scroll-mode')).toBe('window');
        expect(root.getAttribute('data-rxtt-geometry')).toBe('available');

        const { markers, clusters } = getRenderedItems(root);

        expect(markers).toHaveLength(2);
        expect(clusters).toHaveLength(1);

        // Marker activation: scroll request, focus with preventScroll, then a
        // synchronous activation event carrying the original sourceEvent —
        // asserted before any smooth scrolling can complete.
        const markerActivation = dispatchPrimaryPointerSequence(markers[1]);

        expect(handle.markerEvents).toHaveLength(1);
        expect(handle.markerEvents[0].sourceEvent).toBe(markerActivation);
        expect(handle.markerEvents[0].selector).toBe('.parity-focus');
        expect(document.activeElement).toBe(focusTarget);

        // An isolated pointerup is not an accepted primary-pointer session.
        dispatchPointer(markers[1], 'pointerup', { pointerId: nextPointerId });
        nextPointerId += 1;

        expect(handle.markerEvents).toHaveLength(1);

        // Real cluster DOM from two clustered items: a complete sequence
        // activates the cluster exactly once and reports its member count.
        dispatchPrimaryPointerSequence(clusters[0]);

        expect(handle.clusterEvents).toHaveLength(1);
        expect(handle.clusterEvents[0].count).toBe(2);

        // Marker and cluster activation must never register as track activation.
        expect(handle.trackEvents).toHaveLength(0);

        window.scrollTo(0, 0);

        const rect = root.getBoundingClientRect();
        const trackClick = dispatchPrimaryPointerSequence(root, {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height * 0.6,
        });

        // Root/track activation: exactly one outward track event that retains
        // its sourceEvent and carries the expected position payload.
        expect(handle.trackEvents).toHaveLength(1);
        expect(handle.trackEvents[0].sourceEvent).toBe(trackClick);
        expect(typeof handle.trackEvents[0].position === 'number' || handle.trackEvents[0].position === null).toBe(
          true,
        );

        await waitFor(() => window.scrollY > 0, `${adapter.name} track-click scrolling`);

        expect(window.scrollY).toBeGreaterThan(0);

        // An isolated pointerup outside any accepted primary-pointer session
        // must not register a second track activation.
        dispatchPointer(root, 'pointerup', { pointerId: nextPointerId });
        nextPointerId += 1;

        expect(handle.trackEvents).toHaveLength(1);

        await handle.destroy();
      });

      it('emits selection-change with real data-rxtt-key values during keyboard navigation', async () => {
        createWindowParityFixture();

        const handle = await adapter.create({
          options: {
            a11y: { enabled: true, keyboard: true },
            rules: createParityRules(),
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          host: createIntegrationHost(),
        });
        const root = handle.getRoot();

        if (!(root instanceof HTMLElement)) {
          throw new Error(`Expected a mounted ${adapter.name} selection root.`);
        }

        const { markers, clusters } = getRenderedItems(root);
        const firstKey = markers[0]?.getAttribute('data-rxtt-key');
        const secondKey = markers[1]?.getAttribute('data-rxtt-key');
        const clusterKey = clusters[0]?.getAttribute('data-rxtt-key');

        // Mounting with keyboard accessibility enabled commits a default
        // selection at the first record, publishing one initial transition.
        expect(handle.selectionEvents).toHaveLength(1);
        expect(handle.selectionEvents[0]).toEqual({ previousKey: null, selectedKey: firstKey });

        root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));

        expect(handle.selectionEvents).toHaveLength(2);
        expect(handle.selectionEvents[1]).toEqual({ previousKey: firstKey, selectedKey: secondKey });

        root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));

        expect(handle.selectionEvents).toHaveLength(3);
        expect(handle.selectionEvents[2]).toEqual({ previousKey: secondKey, selectedKey: clusterKey });

        await handle.destroy();
      });

      it('runs the compact element-container contract against the authoritative root', async () => {
        const { host, scroller, focusTarget } = createElementParityFixture();
        const handle = await adapter.create({
          options: {
            a11y: { enabled: true, keyboard: true },
            interaction: { drag: true },
            rules: createParityRules(),
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          host: adapter.name === 'vanilla' ? host : createIntegrationHost(),
          scrollRoot: scroller,
        });
        const root = handle.getRoot();

        if (!(root instanceof HTMLElement)) {
          throw new Error(`Expected a mounted ${adapter.name} element-mode root.`);
        }

        expect(root.getAttribute('data-rxtt-scroll-mode')).toBe('element');

        const { markers, clusters } = getRenderedItems(root);

        expect(markers).toHaveLength(2);
        expect(clusters).toHaveLength(1);
        expect(scroller.scrollTop).toBe(0);
        expect(window.scrollY).toBe(0);

        // Marker activation scrolls only the authoritative container and
        // focuses inside it without moving the outer window.
        dispatchPrimaryPointerSequence(markers[1]);
        await waitFor(() => scroller.scrollTop > 0, `${adapter.name} element marker scrolling`);

        expect(handle.markerEvents).toHaveLength(1);
        expect(document.activeElement).toBe(focusTarget);
        expect(window.scrollY).toBe(0);

        dispatchPrimaryPointerSequence(clusters[0]);
        await waitFor(() => handle.clusterEvents.length === 1, `${adapter.name} element cluster activation`);

        const rect = root.getBoundingClientRect();

        scroller.scrollTop = 0;
        dispatchPrimaryPointerSequence(root, {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height * 0.7,
        });
        await waitFor(() => scroller.scrollTop > 0, `${adapter.name} element track-click scrolling`);

        const keyboardActivation = root.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
        );

        expect(keyboardActivation).toBe(false);
        expect(handle.markerEvents.length).toBeGreaterThanOrEqual(2);

        scroller.scrollTop = 0;
        dispatchPrimaryPointerDrag(root, {
          x: rect.left + rect.width / 2,
          startY: rect.top + 2,
          endY: rect.top + rect.height * 0.9,
        });

        expect(scroller.scrollTop).toBeGreaterThan(0);
        expect(window.scrollY).toBe(0);

        await handle.destroy();
      });

      it('cleans up listeners across unmount, remount, and destroy', async () => {
        createWindowParityFixture();

        const handle = await adapter.create({
          options: {
            rules: createParityRules(),
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          host: createIntegrationHost(),
        });
        const firstRoot = handle.getRoot();

        if (!(firstRoot instanceof HTMLElement)) {
          throw new Error(`Expected a mounted ${adapter.name} lifecycle root.`);
        }

        const firstMarkers = getRenderedItems(firstRoot).markers;

        dispatchPrimaryPointerSequence(firstMarkers[0]);
        expect(handle.markerEvents).toHaveLength(1);

        await handle.detach();

        // Listeners must not survive ordinary unmount: replaying a complete
        // session on the retained root produces no further activation.
        dispatchPrimaryPointerSequence(firstMarkers[0]);
        expect(handle.markerEvents).toHaveLength(1);

        await handle.attach();

        const secondRoot = handle.getRoot();

        if (!(secondRoot instanceof HTMLElement)) {
          throw new Error(`Expected a remounted ${adapter.name} lifecycle root.`);
        }

        const secondMarkers = getRenderedItems(secondRoot).markers;

        expect(secondMarkers.length).toBeGreaterThan(0);
        dispatchPrimaryPointerSequence(secondMarkers[0]);
        expect(handle.markerEvents).toHaveLength(2);

        await handle.destroy();

        dispatchPrimaryPointerSequence(secondMarkers[0]);
        expect(handle.markerEvents).toHaveLength(2);
      });
    });

    // Trusted-input acceptance, pointer-target/session classification, and
    // keyboard-axis policy are shared Core interaction behavior with no adapter
    // branch. One Vanilla representative owns each contract; the all-five
    // outward bridges for the same transitions are covered by the activation
    // and selection contracts above.
    if (adapter.name !== 'vanilla') {
      continue;
    }

    describe('shared Core interaction contracts (Vanilla representative)', () => {
      it('activates a marker once through trusted browser pointer input with drag enabled', async () => {
        createWindowParityFixture();
        const handle = await adapter.create({
          options: {
            interaction: { drag: true },
            rules: createParityRules(),
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          host: createIntegrationHost(),
        });
        const root = handle.getRoot();

        if (!(root instanceof HTMLElement)) {
          throw new Error(`Expected a mounted ${adapter.name} parity root.`);
        }

        const { markers } = getRenderedItems(root);

        await userEvent.click(markers[1]);

        expect(handle.markerEvents).toHaveLength(1);
        expect(handle.clusterEvents).toHaveLength(0);

        await handle.destroy();
      });

      it('does not turn marker pointer movement into a track drag session', async () => {
        const target = document.createElement('div');

        target.className = 'parity-marker-drag-target';
        target.style.marginTop = '200px';
        document.body.appendChild(target);

        const handle = await adapter.create({
          options: {
            clustering: { enabled: false },
            interaction: { drag: true },
            rules: [{ scroll: false, selector: '.parity-marker-drag-target' }],
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          host: createIntegrationHost(),
        });
        const root = handle.getRoot();

        if (!(root instanceof HTMLElement)) {
          throw new Error(`Expected a mounted ${adapter.name} marker-drag root.`);
        }

        const { markers } = getRenderedItems(root);
        const pointerId = nextPointerId;

        nextPointerId += 1;
        dispatchPointer(markers[0], 'pointerdown', { clientY: 10, pointerId });
        const pointermove = dispatchPointer(markers[0], 'pointermove', { clientY: 50, pointerId });
        dispatchPointer(markers[0], 'pointerup', { clientY: 50, pointerId });
        const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true, clientY: 50 });

        markers[0].dispatchEvent(click);

        expect(pointermove.defaultPrevented).toBe(false);
        expect(handle.markerEvents).toHaveLength(1);
        expect(handle.markerEvents[0].sourceEvent).toBe(click);
        expect(window.scrollY).toBe(0);

        await handle.destroy();
      });

      it('runs the keyboard contract with opposite-axis pass-through', async () => {
        createWindowParityFixture();

        const handle = await adapter.create({
          options: {
            a11y: { enabled: true, keyboard: true },
            rules: createParityRules(),
            updates: {
              interval: { enabled: false },
              mutation: { enabled: false },
              resize: { enabled: false },
              scroll: { enabled: false },
            },
          },
          host: createIntegrationHost(),
        });
        const root = handle.getRoot();

        if (!(root instanceof HTMLElement)) {
          throw new Error(`Expected a mounted ${adapter.name} keyboard root.`);
        }

        expect(root.getAttribute('tabindex')).toBe('0');

        // The opposite-axis Arrow key must keep its default behavior.
        const passThrough = root.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' }),
        );

        expect(passThrough).toBe(true);

        const navigation = root.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }),
        );

        expect(navigation).toBe(false);

        const activation = root.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
        );

        expect(activation).toBe(false);
        expect(handle.markerEvents).toHaveLength(1);
        expect(handle.markerEvents[0].selector).toBe('.parity-focus');

        await handle.destroy();
      });
    });
  }

  it('renders equivalent RTL element-mode geometry across all five integrations', async () => {
    /** Reference style variables captured from the Vanilla integration. */
    let reference = null;

    for (const adapter of ADAPTERS) {
      const wrapper = document.createElement('div');

      wrapper.innerHTML = `
        <div class="parity-host" style="position: relative; height: 160px; width: 300px;">
          <div
            class="parity-scroller"
            dir="rtl"
            style="height: 120px; width: 300px; overflow-x: auto; font-size: 0; white-space: nowrap;"
          >
            <div style="display: inline-block; width: 380px; height: 50px;"></div>
            <div class="parity-single" style="display: inline-block; width: 40px; height: 50px;"></div>
            <div style="display: inline-block; width: 580px; height: 50px;"></div>
          </div>
        </div>
      `;
      document.body.appendChild(wrapper);

      const host = wrapper.querySelector('.parity-host');
      const scroller = wrapper.querySelector('.parity-scroller');

      if (!(host instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
        throw new Error('Expected a complete RTL parity fixture.');
      }

      const handle = await adapter.create({
        options: {
          orientation: 'horizontal',
          clustering: { enabled: false },
          rules: [{ selector: '.parity-single' }],
          updates: {
            interval: { enabled: false },
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
          },
        },
        host: adapter.name === 'vanilla' ? host : createIntegrationHost(),
        scrollRoot: scroller,
      });
      const root = handle.getRoot();
      const marker = root?.querySelector('.rxtt__marker');

      if (!(root instanceof HTMLElement) || !(marker instanceof HTMLElement)) {
        throw new Error(`Expected the ${adapter.name} RTL parity marker.`);
      }

      const geometry = {
        markerStart: marker.style.getPropertyValue('--rxtt-marker-start'),
        markerSize: marker.style.getPropertyValue('--rxtt-marker-size'),
        scrollMode: root.getAttribute('data-rxtt-scroll-mode'),
      };

      expect(geometry.scrollMode).toBe('element');
      expect(geometry.markerStart).not.toBe('');

      if (reference === null) {
        reference = geometry;
      } else {
        expect(geometry).toEqual(reference);
      }

      await handle.destroy();
      document.body.replaceChildren();
    }
  });
});
