/* eslint-disable import/no-duplicates -- Vite raw and side-effect CSS imports exercise separate style-scope contracts. */

import '@angular/compiler';

import { createComponent } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, h as createVueElement, shallowRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackerElement, defineTrackerElement } from '../../packages/element/src/index.ts';
import { TrackerComponent as AngularTracker } from '../../packages/angular/src/public-api.ts';
import { Tracker as ReactTracker } from '../../packages/react/src/index.ts';
import { Tracker } from '../../packages/vanilla/src/index.ts';
import { Tracker as VueTracker } from '../../packages/vue/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import trackerCss from '../../packages/core/src/styles/rxt-tracker.css?raw';
import { RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER } from './support/angular-error-handler.js';
import { loadInlineFrame } from './support/inline-frame.js';
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
 * Waits for the next animation frame in the test runner window.
 *
 * @returns {Promise<void>}
 */
function waitForAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

/**
 * Dispatches a complete primary-pointer sequence in the target's DOM realm.
 *
 * @param {Element} target - Pointer event target.
 * @param {PointerEventInit} init - Additional pointer coordinates and modifiers.
 */
function dispatchPrimaryPointerSequence(target, init = {}) {
  const runtimeWindow = target.ownerDocument.defaultView;

  if (!runtimeWindow) {
    throw new Error('Expected a Window for the pointer target.');
  }

  const sharedInit = {
    bubbles: true,
    button: 0,
    cancelable: true,
    isPrimary: true,
    pointerId: 1,
    ...init,
  };

  target.dispatchEvent(new runtimeWindow.PointerEvent('pointerdown', { ...sharedInit, buttons: 1 }));
  target.dispatchEvent(new runtimeWindow.PointerEvent('pointerup', { ...sharedInit, buttons: 0 }));
  target.dispatchEvent(new runtimeWindow.MouseEvent('click', sharedInit));
}

/**
 * Dispatches a complete primary-pointer drag session.
 *
 * @param {Element} target - Delegated Tracker root.
 * @param {{ endX?: number, endY?: number, pointerId?: number, startX?: number, startY?: number }} overrides - Event overrides.
 */
function dispatchPrimaryPointerDrag(target, overrides = {}) {
  const runtimeWindow = target.ownerDocument.defaultView;

  if (!runtimeWindow) {
    throw new Error('Expected a Window for the pointer target.');
  }

  const { endX = 10, endY = 500, pointerId = 73, startX = 10, startY = 10 } = overrides;
  const sharedInit = {
    bubbles: true,
    button: 0,
    cancelable: true,
    isPrimary: true,
    pointerId,
  };

  target.dispatchEvent(
    new runtimeWindow.PointerEvent('pointerdown', {
      ...sharedInit,
      buttons: 1,
      clientX: startX,
      clientY: startY,
    }),
  );
  target.dispatchEvent(
    new runtimeWindow.PointerEvent('pointermove', {
      ...sharedInit,
      buttons: 1,
      clientX: endX,
      clientY: endY,
    }),
  );
  target.dispatchEvent(
    new runtimeWindow.PointerEvent('pointerup', {
      ...sharedInit,
      buttons: 0,
      clientX: endX,
      clientY: endY,
    }),
  );
}

/** Creates a target at a measurable document position. */
function createMeasuredTarget() {
  const spacer = document.createElement('div');
  const target = document.createElement('div');

  spacer.style.height = '1200px';
  spacer.style.width = '2400px';
  target.className = 'browser-target';
  target.style.height = '80px';
  target.style.marginLeft = '900px';
  target.style.width = '120px';
  target.textContent = 'Browser target';
  document.body.append(spacer, target);

  return target;
}

/** Reads comparable geometry fields from one rendered tracker root. */
function readTrackerGeometry(root) {
  const marker = root.querySelector('.rxtt__marker');
  const viewport = root.querySelector('.rxtt__viewport');

  return {
    markerCount: root.querySelectorAll('.rxtt__marker').length,
    markerStart: marker?.style.getPropertyValue('--rxtt-marker-start'),
    markerSize: marker?.style.getPropertyValue('--rxtt-marker-size'),
    viewportStart: viewport?.style.getPropertyValue('--rxtt-viewport-start'),
    viewportSize: viewport?.style.getPropertyValue('--rxtt-viewport-size'),
  };
}

beforeEach(() => {
  document.body.className = '';
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

afterEach(() => {
  document.body.className = '';
  document.body.replaceChildren();
  window.scrollTo(0, 0);
});

describe('browser integration contracts', () => {
  it('does not style tracker-like internal classes outside a tracker root', () => {
    const host = document.createElement('div');

    host.innerHTML = `
      <div class="rxtt__viewport"></div>
      <div class="rxtt__markers">
        <div class="rxtt__marker" data-rxtt-kind="cluster"></div>
      </div>
    `;
    document.body.appendChild(host);

    expect(getComputedStyle(host.querySelector('.rxtt__viewport')).position).toBe('static');
    expect(getComputedStyle(host.querySelector('.rxtt__markers')).position).toBe('static');
    expect(getComputedStyle(host.querySelector('.rxtt__marker')).position).toBe('static');
  });

  it('renders equivalent vertical and horizontal geometry across all integrations', async () => {
    createMeasuredTarget();

    for (const orientation of ['vertical', 'horizontal']) {
      const options = {
        orientation,
        placement: orientation === 'vertical' ? 'left' : 'top',
        clustering: { enabled: false },
        rules: [{ selector: '.browser-target', label: 'Browser target' }],
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      };
      const { rules, ...vanillaOptions } = options;
      const vanilla = new Tracker({ options: vanillaOptions, rules });

      vanilla.mount();
      const vanillaGeometry = readTrackerGeometry(document);
      vanilla.destroy();

      const element = createTrackerElement();

      const elementOptions = vanillaOptions;

      element.replaceOptions(elementOptions);
      element.replaceRules(rules);
      document.body.appendChild(element);
      const elementGeometry = readTrackerGeometry(element);
      element.remove();

      const reactContainer = document.createElement('div');
      const reactRoot = createRoot(reactContainer);

      document.body.appendChild(reactContainer);
      reactRoot.render(createElement(ReactTracker, { options: elementOptions, rules }));
      await waitFor(() => reactContainer.querySelector('.rxtt__marker') !== null, `React ${orientation} marker`);
      const reactGeometry = readTrackerGeometry(reactContainer);

      const vueContainer = document.createElement('div');
      const vueApp = createApp({
        render: () => createVueElement(VueTracker, { options: elementOptions, rules }),
      });

      document.body.appendChild(vueContainer);
      vueApp.mount(vueContainer);
      await waitFor(() => vueContainer.querySelector('.rxtt__marker') !== null, `Vue ${orientation} marker`);
      const vueGeometry = readTrackerGeometry(vueContainer);

      const angularContainer = document.createElement('rxt-tracker-angular');
      const angularApplication = await createApplication({
        providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
      });

      document.body.appendChild(angularContainer);
      const angularTracker = angularApplication.bootstrap(AngularTracker, angularContainer);

      angularTracker.setInput('options', elementOptions);
      angularTracker.setInput('rules', rules);
      angularApplication.tick();
      await waitFor(() => angularContainer.querySelector('.rxtt__marker') !== null, `Angular ${orientation} marker`);
      const angularGeometry = readTrackerGeometry(angularContainer);

      expect(elementGeometry).toEqual(vanillaGeometry);
      expect(reactGeometry).toEqual(vanillaGeometry);
      expect(vueGeometry).toEqual(vanillaGeometry);
      expect(angularGeometry).toEqual(vanillaGeometry);

      reactRoot.unmount();
      reactContainer.remove();
      vueApp.unmount();
      vueContainer.remove();
      angularApplication.destroy();
      angularContainer.remove();
    }
  });

  it('uses the destination style scope after Element adoption while keeping Light DOM lifecycle functional before the stylesheet is installed', async () => {
    const iframe = await loadInlineFrame('<!doctype html><html><body></body></html>');
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;
    const element = createTrackerElement();

    if (!frameDocument || !frameWindow) {
      throw new Error('Expected a same-origin iframe document.');
    }

    element.replaceOptions({
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    });
    document.body.appendChild(element);

    try {
      frameDocument.adoptNode(element);
      frameDocument.body.appendChild(element);

      const root = element.querySelector('.rxtt');

      // The adopted Element owns Light DOM in the destination realm and never
      // injects a private stylesheet of its own.
      expect(element.shadowRoot).toBeNull();
      expect(root).toBeInstanceOf(frameWindow.HTMLElement);
      expect(root?.ownerDocument).toBe(frameDocument);
      expect(element.querySelectorAll('style')).toHaveLength(0);

      // With no canonical Tracker stylesheet in the destination the same tree
      // renders unstyled/static.
      expect(frameWindow.getComputedStyle(root).position).toBe('static');

      // Installing the canonical stylesheet in the destination document styles
      // the very same adopted tree, still without any Element-injected style.
      const style = frameDocument.createElement('style');

      style.textContent = trackerCss;
      frameDocument.head.appendChild(style);

      expect(frameWindow.getComputedStyle(root).position).toBe('fixed');
      expect(element.querySelectorAll('style')).toHaveLength(0);
    } finally {
      element.remove();
      iframe.remove();
    }
  });

  it('provides delegated drag parity across all five built-in integrations', async () => {
    const content = document.createElement('div');
    const reactContainer = document.createElement('div');
    const vueContainer = document.createElement('div');
    const angularContainer = document.createElement('rxt-tracker-angular');
    const options = {
      interaction: { drag: true },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    };
    const vanilla = new Tracker({ options });
    const element = createTrackerElement();
    const reactRoot = createRoot(reactContainer);
    const vueApp = createApp({ render: () => createVueElement(VueTracker, { options }) });
    const angularApplication = await createApplication({
      providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
    });

    content.style.height = '3200px';
    element.replaceOptions(options);
    document.body.append(content, reactContainer, vueContainer, angularContainer);

    try {
      vanilla.mount();
      document.body.appendChild(element);
      reactRoot.render(createElement(ReactTracker, { options }));
      vueApp.mount(vueContainer);
      const angularTracker = angularApplication.bootstrap(AngularTracker, angularContainer);

      angularTracker.setInput('options', options);
      angularApplication.tick();

      await waitFor(
        () =>
          reactContainer.querySelector('.rxtt') !== null &&
          vueContainer.querySelector('.rxtt') !== null &&
          angularContainer.querySelector('.rxtt') !== null,
        'all delegated drag roots',
      );

      const roots = [
        vanilla.root,
        element.querySelector('.rxtt'),
        reactContainer.querySelector('.rxtt'),
        vueContainer.querySelector('.rxtt'),
        angularContainer.querySelector('.rxtt'),
      ];

      await waitFor(
        () =>
          roots.every(
            (root) =>
              root instanceof HTMLElement &&
              root.getAttribute('data-rxtt-drag') === 'true' &&
              root.getAttribute('data-rxtt-scroll-mode') === 'window',
          ),
        'all mounted delegated drag states',
      );

      for (const [index, root] of roots.entries()) {
        if (!(root instanceof HTMLElement)) {
          throw new Error(`Expected delegated drag root ${index}.`);
        }

        expect(root.getAttribute('data-rxtt-scroll-mode')).toBe('window');
        expect(root.getAttribute('data-rxtt-drag'), `delegated drag state ${index}`).toBe('true');
        expect(getComputedStyle(root).touchAction, `delegated drag touch action ${index}`).toBe('pan-x pinch-zoom');

        window.scrollTo(0, 0);
        dispatchPrimaryPointerDrag(root, { pointerId: 80 + index });
        await waitFor(() => window.scrollY > 0, `delegated drag integration ${index}`);

        expect(window.scrollY).toBeGreaterThan(0);
      }
    } finally {
      vanilla.destroy();
      element.remove();
      reactRoot.unmount();
      vueApp.unmount();
      angularApplication.destroy();
    }
  });

  it('mounts a parent-created vanilla tracker into a same-origin iframe document', async () => {
    const iframe = await loadInlineFrame(`
      <!doctype html>
      <html>
        <body>
          <div class="iframe-target" style="height: 160px; margin-top: 1600px;">Iframe target</div>
        </body>
      </html>
    `);
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;

    if (!frameDocument || !frameWindow) {
      throw new Error('Expected same-origin iframe DOM context.');
    }

    const parentScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const frameScrollTo = vi.spyOn(frameWindow, 'scrollTo').mockImplementation(() => {});
    const addFrameListener = vi.spyOn(frameWindow, 'addEventListener');
    const removeFrameListener = vi.spyOn(frameWindow, 'removeEventListener');
    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
        },
      },
      rules: [{ selector: '.iframe-target' }],
    });

    try {
      tracker.mount({ scrollRoot: frameWindow, sourceRoot: frameDocument.body });

      const root = tracker.root;

      if (!root) {
        throw new Error('Expected mounted iframe tracker root.');
      }

      expect(root?.ownerDocument).toBe(frameDocument);
      expect(frameDocument.querySelector('.rxtt__marker')).not.toBeNull();
      expect(document.querySelector('.rxtt')).toBeNull();
      expect(addFrameListener.mock.calls.some(([type]) => type === 'scroll')).toBe(true);

      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
        bottom: 100,
        height: 100,
        left: 0,
        right: 20,
        toJSON: () => ({}),
        top: 0,
        width: 20,
        x: 0,
        y: 0,
      });
      dispatchPrimaryPointerSequence(root, { clientY: 50 });

      expect(frameScrollTo).toHaveBeenCalledTimes(1);
      expect(parentScrollTo).not.toHaveBeenCalled();

      tracker.unmount();

      expect(removeFrameListener.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
    } finally {
      tracker.destroy();
      parentScrollTo.mockRestore();
      frameScrollTo.mockRestore();
      addFrameListener.mockRestore();
      removeFrameListener.mockRestore();
      iframe.remove();
    }
  });

  it('discovers targets added through observed DOM mutations', async () => {
    const tracker = new Tracker({
      options: {
        clustering: { enabled: false },
      },
      rules: [{ selector: '.browser-target' }],
    });

    tracker.mount();
    expect(document.querySelector('.rxtt__marker')).toBeNull();

    const target = document.createElement('div');

    target.className = 'browser-target';
    target.style.height = '80px';
    document.body.appendChild(target);
    await waitFor(() => document.querySelector('.rxtt__marker') !== null, 'a marker created from an observed mutation');

    expect(document.querySelector('.rxtt__marker')).toBeInstanceOf(HTMLElement);

    tracker.destroy();
  });

  it('renders, activates, updates and tears down every framework wrapper in a real browser', async () => {
    createMeasuredTarget();

    const rules = [{ selector: '.browser-target' }];
    const baseOptions = {
      clustering: { enabled: false },
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    };
    const horizontalOptions = { ...baseOptions, orientation: 'horizontal', placement: 'top' };

    /** Real-browser wrapper scenarios, one per first-party framework adapter. */
    const wrappers = [
      {
        name: 'React',
        createContainer: () => document.createElement('div'),
        async mount(container, onMarkerActivate) {
          const reactRoot = createRoot(container);

          reactRoot.render(createElement(ReactTracker, { options: baseOptions, onMarkerActivate, rules }));
          await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the React wrapper marker');

          return {
            async update() {
              reactRoot.render(createElement(ReactTracker, { options: horizontalOptions, onMarkerActivate, rules }));
              await waitFor(
                () => container.querySelector('.rxtt')?.getAttribute('data-rxtt-orientation') === 'horizontal',
                'the React wrapper orientation update',
              );
            },
            async teardown() {
              reactRoot.unmount();
              await waitFor(() => container.querySelector('.rxtt') === null, 'the React wrapper teardown');
              container.remove();
            },
          };
        },
      },
      {
        name: 'Vue',
        createContainer: () => document.createElement('div'),
        async mount(container, onMarkerActivate) {
          const options = shallowRef(baseOptions);
          const app = createApp({
            render: () => createVueElement(VueTracker, { options: options.value, onMarkerActivate, rules }),
          });

          app.mount(container);
          await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the Vue wrapper marker');

          return {
            async update() {
              options.value = horizontalOptions;
              await waitFor(
                () => container.querySelector('.rxtt')?.getAttribute('data-rxtt-orientation') === 'horizontal',
                'the Vue wrapper orientation update',
              );
            },
            async teardown() {
              app.unmount();
              await waitFor(() => container.querySelector('.rxtt') === null, 'the Vue wrapper teardown');
              container.remove();
            },
          };
        },
      },
      {
        name: 'Angular',
        createContainer: () => document.createElement('rxt-tracker-angular'),
        async mount(container, onMarkerActivate) {
          const application = await createApplication({
            providers: [RETHROWING_ANGULAR_BROWSER_ERROR_HANDLER_PROVIDER],
          });
          // Inputs must be applied before the first change detection pass, as a
          // template binding would, so the runtime mounts with the real options.
          const componentRef = createComponent(AngularTracker, {
            environmentInjector: application.injector,
            hostElement: container,
          });

          componentRef.setInput('options', baseOptions);
          componentRef.setInput('rules', rules);
          componentRef.instance.markerActivate.subscribe(onMarkerActivate);
          application.attachView(componentRef.hostView);
          application.tick();
          await waitFor(() => container.querySelector('.rxtt__marker') !== null, 'the Angular wrapper marker');

          return {
            async update() {
              componentRef.setInput('options', horizontalOptions);
              application.tick();
              await waitFor(
                () => container.querySelector('.rxtt')?.getAttribute('data-rxtt-orientation') === 'horizontal',
                'the Angular wrapper orientation update',
              );
            },
            async teardown() {
              // Angular releases the component view and its runtime here; the
              // caller-owned host element is retired the way the parity adapter
              // tears the Angular integration down.
              application.destroy();
              container.remove();
              await waitForAnimationFrame();
            },
          };
        },
      },
    ];

    for (const wrapper of wrappers) {
      const container = wrapper.createContainer();
      const onMarkerActivate = vi.fn();

      document.body.appendChild(container);
      window.scrollTo(0, 0);

      const instance = await wrapper.mount(container, onMarkerActivate);
      const marker = container.querySelector('.rxtt__marker');

      expect(marker, `${wrapper.name} wrapper marker`).toBeInstanceOf(HTMLElement);

      marker.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      expect(onMarkerActivate, `${wrapper.name} isolated pointerup rejected`).not.toHaveBeenCalled();

      dispatchPrimaryPointerSequence(marker);
      expect(onMarkerActivate, `${wrapper.name} primary-pointer activation`).toHaveBeenCalledTimes(1);

      await instance.update();

      const renderedRoot = container.querySelector('.rxtt');
      const renderedMarker = container.querySelector('.rxtt__marker') ?? marker;

      expect(renderedRoot?.getAttribute('data-rxtt-orientation'), `${wrapper.name} orientation update`).toBe(
        'horizontal',
      );

      await instance.teardown();

      // Teardown must retire the rendered tree: the former root is detached
      // from the live document and further pointer input is inert.
      expect(renderedRoot.isConnected, `${wrapper.name} wrapper teardown`).toBe(false);
      dispatchPrimaryPointerSequence(renderedMarker);
      expect(onMarkerActivate, `${wrapper.name} post-teardown activation`).toHaveBeenCalledTimes(1);
    }
  });
});
