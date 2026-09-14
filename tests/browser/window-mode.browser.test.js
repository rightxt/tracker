import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tracker } from '../../packages/vanilla/src/index.ts';
import '../../packages/core/src/styles/rxt-tracker.css';
import { waitFor } from './support/wait-for.js';

/** Deterministic document extent used by the neutral Window fixture. */
const FIXTURE_EXTENT = 3200;

/** Original root style restored after each test. */
let originalRootStyle = '';

/** Original body style restored after each test. */
let originalBodyStyle = '';

/**
 * Returns the active main-axis scroll offset.
 *
 * @param {'vertical' | 'horizontal'} orientation - Tracker orientation.
 * @returns {number} Physical Window scroll offset.
 */
function getScrollOffset(orientation) {
  return orientation === 'horizontal' ? window.scrollX : window.scrollY;
}

/**
 * Returns the main-axis viewport extent.
 *
 * @param {'vertical' | 'horizontal'} orientation - Tracker orientation.
 * @returns {number} Viewport extent in CSS pixels.
 */
function getViewportExtent(orientation) {
  return orientation === 'horizontal' ? window.innerWidth : window.innerHeight;
}

/**
 * Returns the normalized document extent used by current Window geometry.
 *
 * @param {'vertical' | 'horizontal'} orientation - Tracker orientation.
 * @returns {number} Document extent in CSS pixels.
 */
function getDocumentExtent(orientation) {
  const scrollingElement = document.scrollingElement;

  if (!scrollingElement) {
    throw new Error('Expected a standards-mode scrolling element.');
  }

  return orientation === 'horizontal' ? scrollingElement.scrollWidth : scrollingElement.scrollHeight;
}

/**
 * Reads source geometry along the selected physical axis.
 *
 * @param {Element} element - Source element.
 * @param {'vertical' | 'horizontal'} orientation - Tracker orientation.
 * @returns {{ start: number, size: number }} Source geometry in CSS pixels.
 */
function readSourceGeometry(element, orientation) {
  const rect = element.getBoundingClientRect();

  if (orientation === 'horizontal') {
    return { start: rect.left + window.scrollX, size: rect.width };
  }

  return { start: rect.top + window.scrollY, size: rect.height };
}

/**
 * Creates the neutral deterministic source document.
 *
 * @returns {{ clusterTargets: HTMLElement[], singleTarget: HTMLElement }} Fixture targets.
 */
function createNeutralFixture() {
  document.documentElement.style.direction = 'ltr';
  document.documentElement.style.scrollBehavior = 'auto';
  document.documentElement.style.scrollSnapType = 'none';
  document.documentElement.style.writingMode = 'horizontal-tb';

  document.body.style.contain = 'none';
  document.body.style.direction = 'ltr';
  document.body.style.height = `${FIXTURE_EXTENT}px`;
  document.body.style.margin = '0';
  document.body.style.position = 'relative';
  document.body.style.scrollBehavior = 'auto';
  document.body.style.scrollSnapType = 'none';
  document.body.style.transform = 'none';
  document.body.style.width = `${FIXTURE_EXTENT}px`;
  document.body.style.writingMode = 'horizontal-tb';
  document.body.style.zoom = '1';

  const singleTarget = document.createElement('button');
  const firstClusterTarget = document.createElement('button');
  const secondClusterTarget = document.createElement('button');

  singleTarget.id = 'window-single';
  singleTarget.className = 'window-single';
  singleTarget.textContent = 'Single target';
  singleTarget.style.cssText =
    'position: absolute; left: 640px; top: 640px; width: 120px; height: 120px; scroll-snap-align: none;';

  firstClusterTarget.id = 'window-cluster-a';
  firstClusterTarget.className = 'window-cluster';
  firstClusterTarget.textContent = 'Cluster target A';
  firstClusterTarget.style.cssText =
    'position: absolute; left: 2100px; top: 2100px; width: 120px; height: 120px; scroll-snap-align: none;';

  secondClusterTarget.id = 'window-cluster-b';
  secondClusterTarget.className = 'window-cluster';
  secondClusterTarget.textContent = 'Cluster target B';
  secondClusterTarget.style.cssText =
    'position: absolute; left: 2110px; top: 2110px; width: 120px; height: 120px; scroll-snap-align: none;';

  document.body.append(singleTarget, firstClusterTarget, secondClusterTarget);

  return {
    clusterTargets: [firstClusterTarget, secondClusterTarget],
    singleTarget,
  };
}

/**
 * Creates explicit neutral options shared by the Window fixtures.
 *
 * @param {'vertical' | 'horizontal'} orientation - Tracker orientation.
 * @returns {Record<string, unknown>} Tracker options.
 */
function createNeutralOptions(orientation) {
  return {
    options: {
      a11y: {
        enabled: true,
        keyboard: true,
        label: 'Tracker window fixture',
      },
      clustering: {
        enabled: true,
        threshold: 0,
      },
      diagnostics: {
        metrics: false,
        warnings: false,
      },
      interaction: {
        activation: true,
        drag: true,
      },
      orientation,
      placement: orientation === 'horizontal' ? 'top' : 'left',
      updates: {
        interval: { enabled: false },
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
      },
    },
    rules: [
      {
        selector: '.window-single',
        label: 'Single marker',
        marker: {
          className: 'window-single-marker',
          cssVariables: { '--rxtt-marker-bg': '#dc3545' },
        },
        focus: { enabled: true, target: 'self' },
        scroll: { align: 'start', behavior: 'auto', enabled: true, target: 'self' },
      },
      {
        selector: '.window-cluster',
        label: 'Cluster marker',
        marker: {
          className: 'window-cluster-marker',
          cssVariables: { '--rxtt-marker-bg': '#0d6efd' },
        },
        focus: { enabled: true, target: 'self' },
        scroll: { align: 'start', behavior: 'auto', enabled: true, target: 'self' },
      },
    ],
  };
}

/**
 * Dispatches a complete primary-pointer activation sequence.
 *
 * @param {Element} target - Pointer event target.
 * @param {{ clientX?: number, clientY?: number, pointerId?: number }} init - Pointer coordinates and identity.
 * @returns {MouseEvent} Dispatched semantic click event.
 */
function dispatchPrimaryPointerSequence(target, init = {}) {
  const sharedInit = {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    isPrimary: true,
    pointerId: init.pointerId ?? 1,
  };
  const pointerUp = new PointerEvent('pointerup', { ...sharedInit, buttons: 0 });
  const click = new MouseEvent('click', sharedInit);

  target.dispatchEvent(new PointerEvent('pointerdown', { ...sharedInit, buttons: 1 }));
  target.dispatchEvent(pointerUp);
  target.dispatchEvent(click);

  return click;
}

/**
 * Dispatches one accepted drag session across a tracker root.
 *
 * @param {Element} target - Tracker root.
 * @param {{ startX: number, startY: number, endX: number, endY: number }} points - Drag coordinates.
 * @returns {{ move: PointerEvent, up: PointerEvent }} Dispatched movement and release events.
 */
function dispatchPrimaryDrag(target, points) {
  const sharedInit = {
    bubbles: true,
    button: 0,
    cancelable: true,
    isPrimary: true,
    pointerId: 2,
  };
  const move = new PointerEvent('pointermove', {
    ...sharedInit,
    buttons: 1,
    clientX: points.endX,
    clientY: points.endY,
  });
  const up = new PointerEvent('pointerup', {
    ...sharedInit,
    buttons: 0,
    clientX: points.endX,
    clientY: points.endY,
  });

  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      ...sharedInit,
      buttons: 1,
      clientX: points.startX,
      clientY: points.startY,
    }),
  );
  target.dispatchEvent(move);
  target.dispatchEvent(up);

  return { move, up };
}

/**
 * Returns one rendered marker element by snapshot key.
 *
 * @param {Tracker} tracker - Mounted Tracker.
 * @param {string} key - Snapshot render key.
 * @returns {HTMLElement} Rendered marker element.
 */
function getRenderedItem(tracker, key) {
  const marker = tracker.root?.querySelector(`[data-rxtt-key="${CSS.escape(key)}"]`);

  if (!(marker instanceof HTMLElement)) {
    throw new Error(`Expected a rendered item for key "${key}".`);
  }

  return marker;
}

/** Records fixture styles and installs a clean neutral document. */
beforeEach(() => {
  originalRootStyle = document.documentElement.style.cssText;
  originalBodyStyle = document.body.style.cssText;
  document.body.replaceChildren();
  window.scrollTo(0, 0);
  createNeutralFixture();
});

/** Restores document state after a fixture. */
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.cssText = originalRootStyle;
  document.body.style.cssText = originalBodyStyle;
  window.scrollTo(0, 0);
});

describe('neutral Window mode', () => {
  // One runtime case per orientation covering the full Window lifecycle on a
  // single live mount: lifecycle/geometry evidence first (before any
  // interaction mutates the scroll offset), then track scrolling, then drag
  // scrolling from a reset offset, then the unmount/destroy lifecycle
  // transitions. One Tracker instance only.
  it.each(['vertical', 'horizontal'])(
    'records lifecycle, geometry, track scrolling and drag scrolling for %s orientation',
    async (orientation) => {
      expect(document.compatMode).toBe('CSS1Compat');
      expect(getComputedStyle(document.documentElement).writingMode).toBe('horizontal-tb');
      expect(getComputedStyle(document.documentElement).direction).toBe('ltr');

      const singleTarget = document.getElementById('window-single');
      const clusterTargets = [document.getElementById('window-cluster-a'), document.getElementById('window-cluster-b')];

      if (!(singleTarget instanceof HTMLElement) || clusterTargets.some((target) => !(target instanceof HTMLElement))) {
        throw new Error('Expected all neutral source targets.');
      }

      const tracker = new Tracker(createNeutralOptions(orientation));

      tracker.mount();

      // Phase 1 - lifecycle and geometry evidence, captured before any
      // interaction mutates the Window scroll offset.
      const snapshot = tracker.getSnapshot();
      const stats = tracker.getStats();
      const documentExtent = getDocumentExtent(orientation);
      const viewportExtent = getViewportExtent(orientation);
      const singleGeometry = readSourceGeometry(singleTarget, orientation);
      const clusterGeometry = clusterTargets.map((target) => readSourceGeometry(target, orientation));
      const marker = snapshot.markers[0];
      const cluster = snapshot.clusters[0];
      const clusterStart = Math.min(...clusterGeometry.map(({ start }) => start));
      const clusterEnd = Math.max(...clusterGeometry.map(({ start, size }) => start + size));

      expect(documentExtent).toBe(FIXTURE_EXTENT);
      expect(snapshot).toMatchObject({
        mounted: true,
        scrollMode: 'window',
        geometryAvailable: true,
        lifecycle: {
          mounted: true,
          destroyed: false,
          hasRenderRoot: true,
        },
        options: {
          orientation,
          placement: orientation === 'horizontal' ? 'top' : 'left',
          viewport: {
            enabled: true,
          },
        },
        viewport: {
          visible: true,
        },
      });
      expect(tracker.root).toBeInstanceOf(HTMLElement);
      expect(tracker.root?.getAttribute('aria-label')).toBe('Tracker window fixture');
      expect(snapshot.viewport.start).toBeCloseTo(0, 5);
      expect(snapshot.viewport.size).toBeCloseTo((viewportExtent / documentExtent) * 100, 5);
      expect(snapshot.items).toHaveLength(2);
      expect(snapshot.markers).toHaveLength(1);
      expect(snapshot.clusters).toHaveLength(1);
      expect(marker).toMatchObject({
        kind: 'marker',
        selector: '.window-single',
        label: 'Single marker',
        className: 'window-single-marker',
        interactive: true,
      });
      expect(marker.start).toBeCloseTo((singleGeometry.start / documentExtent) * 100, 5);
      expect(marker.size).toBeCloseTo((singleGeometry.size / documentExtent) * 100, 5);
      expect(cluster).toMatchObject({
        kind: 'cluster',
        count: 2,
        label: 'Cluster marker',
        className: 'window-cluster-marker',
        interactive: true,
      });
      expect(cluster.markerKeys).toHaveLength(2);
      expect(cluster.start).toBeCloseTo((clusterStart / documentExtent) * 100, 5);
      expect(cluster.size).toBeCloseTo(((clusterEnd - clusterStart) / documentExtent) * 100, 5);
      expect(stats).toMatchObject({
        renders: { requested: 0, started: 1, completed: 1, cancelled: 0, skipped: 0 },
        markers: { current: 3, created: 3, removed: 0 },
        clusters: { current: 1 },
        warnings: { total: 0 },
        errors: { total: 0 },
        lastRender: { markersCount: 3, clustersCount: 1 },
      });

      // Phase 2 - track scrolling on the same live mount.
      const root = tracker.root;

      if (!root) {
        throw new Error('Expected a mounted tracker root.');
      }

      const rect = root.getBoundingClientRect();
      const maxScroll = getDocumentExtent(orientation) - getViewportExtent(orientation);
      const trackRatio = 0.25;
      const trackX = orientation === 'horizontal' ? rect.left + rect.width * trackRatio : rect.left + rect.width / 2;
      const trackY = orientation === 'vertical' ? rect.top + rect.height * trackRatio : rect.top + rect.height / 2;
      const trackPointerUp = dispatchPrimaryPointerSequence(root, { clientX: trackX, clientY: trackY });

      await waitFor(
        () => Math.abs(getScrollOffset(orientation) - maxScroll * trackRatio) <= 2,
        `${orientation} track scrolling`,
      );
      expect(trackPointerUp.defaultPrevented).toBe(true);
      expect(getScrollOffset(orientation)).toBeCloseTo(maxScroll * trackRatio, 0);

      // Phase 3 - drag scrolling from a reset offset on the same live mount.
      window.scrollTo(0, 0);

      const dragRatio = 0.75;
      const dragStartX = orientation === 'horizontal' ? rect.left + rect.width * 0.1 : rect.left + rect.width / 2;
      const dragStartY = orientation === 'vertical' ? rect.top + rect.height * 0.1 : rect.top + rect.height / 2;
      const dragEndX = orientation === 'horizontal' ? rect.left + rect.width * dragRatio : dragStartX;
      const dragEndY = orientation === 'vertical' ? rect.top + rect.height * dragRatio : dragStartY;
      const dragEvents = dispatchPrimaryDrag(root, {
        startX: dragStartX,
        startY: dragStartY,
        endX: dragEndX,
        endY: dragEndY,
      });

      await waitFor(
        () => Math.abs(getScrollOffset(orientation) - maxScroll * dragRatio) <= 2,
        `${orientation} drag scrolling`,
      );
      expect(dragEvents.move.defaultPrevented).toBe(true);
      expect(dragEvents.up.defaultPrevented).toBe(true);
      expect(getScrollOffset(orientation)).toBeCloseTo(maxScroll * dragRatio, 0);

      // Phase 4 - lifecycle teardown transitions.
      tracker.unmount();
      expect(tracker.getSnapshot().lifecycle).toEqual({
        mounted: false,
        destroyed: false,
        hasRenderRoot: false,
      });

      tracker.destroy();
      expect(tracker.getSnapshot().lifecycle).toEqual({
        mounted: false,
        destroyed: true,
        hasRenderRoot: false,
      });
    },
  );

  it('records activation payloads, focus, event order, diagnostics, and destroyed state', async () => {
    const tracker = new Tracker(createNeutralOptions('vertical'));
    const eventOrder = [];
    const activationState = {};

    tracker.on('sync:start', () => eventOrder.push('sync:start'));
    tracker.on('sync:end', () => eventOrder.push('sync:end'));
    tracker.on('warning', () => eventOrder.push('warning'));
    tracker.on('marker:activate', (payload) => {
      eventOrder.push('marker:activate');
      activationState.marker = {
        activeElementId: document.activeElement?.id,
        elementId: payload.element.id,
        label: payload.label,
        ruleIndex: payload.ruleIndex,
        selector: payload.selector,
        sourceEvent: payload.sourceEvent,
      };
    });
    tracker.on('cluster:activate', (payload) => {
      eventOrder.push('cluster:activate');
      activationState.cluster = {
        activeElementId: document.activeElement?.id,
        count: payload.count,
        markerIds: payload.markers.map(({ element }) => element.id),
        primaryMarkerId: payload.primaryMarker?.element.id,
        sourceEvent: payload.sourceEvent,
      };
    });
    tracker.on('destroy', () => eventOrder.push('destroy'));

    tracker.mount();

    const snapshot = tracker.getSnapshot();
    const markerPointerUp = dispatchPrimaryPointerSequence(getRenderedItem(tracker, snapshot.markers[0].key));

    await waitFor(() => document.activeElement?.id === 'window-single', 'single marker focus');

    const clusterPointerUp = dispatchPrimaryPointerSequence(getRenderedItem(tracker, snapshot.clusters[0].key), {
      pointerId: 3,
    });

    await waitFor(() => document.activeElement?.id === 'window-cluster-a', 'cluster primary focus');

    expect(activationState.marker).toEqual({
      activeElementId: 'window-single',
      elementId: 'window-single',
      label: 'Single marker',
      ruleIndex: 0,
      selector: '.window-single',
      sourceEvent: markerPointerUp,
    });
    expect(activationState.cluster).toEqual({
      activeElementId: 'window-cluster-a',
      count: 2,
      markerIds: ['window-cluster-a', 'window-cluster-b'],
      primaryMarkerId: 'window-cluster-a',
      sourceEvent: clusterPointerUp,
    });
    expect(tracker.getStats()).toMatchObject({
      warnings: { total: 0 },
      errors: { total: 0 },
      renders: { requested: 0, started: 1, completed: 1, cancelled: 0, skipped: 0 },
      markers: { current: 3, created: 3, removed: 0 },
      clusters: { current: 1 },
      lastRender: { markersCount: 3, clustersCount: 1 },
    });

    tracker.destroy();

    expect(eventOrder).toEqual(['sync:start', 'sync:end', 'marker:activate', 'cluster:activate', 'destroy']);
    expect(tracker.getSnapshot()).toMatchObject({
      mounted: false,
      lifecycle: {
        mounted: false,
        destroyed: true,
        hasRenderRoot: false,
      },
    });
  });

  it('preserves native marker scrolling through a nested scrollable ancestor', async () => {
    const container = document.createElement('div');
    const spacer = document.createElement('div');
    const nestedTarget = document.createElement('button');

    container.style.cssText = 'position: absolute; left: 20px; top: 20px; width: 300px; height: 180px; overflow: auto;';
    spacer.style.height = '900px';
    nestedTarget.className = 'nested-window-target';
    nestedTarget.textContent = 'Nested native target';
    container.append(spacer, nestedTarget);
    document.body.appendChild(container);

    const tracker = new Tracker({
      options: {
        a11y: { enabled: true, keyboard: true, label: 'Tracker window fixture' },
        clustering: { enabled: false },
        diagnostics: { warnings: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [
        {
          selector: '.nested-window-target',
          scroll: { align: 'start', behavior: 'auto', enabled: true, target: 'self' },
        },
      ],
    });

    tracker.mount();

    const marker = tracker.root?.querySelector('.rxtt__marker');

    if (!(marker instanceof HTMLElement)) {
      throw new Error('Expected a nested-target marker.');
    }

    dispatchPrimaryPointerSequence(marker);
    await waitFor(() => container.scrollTop > 0, 'native nested-ancestor scrolling');

    expect(container.scrollTop).toBeGreaterThan(0);
    expect(tracker.getStats().warnings.total).toBe(0);
    expect(tracker.getStats().errors.total).toBe(0);

    tracker.destroy();
  });
});
