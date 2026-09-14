// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnectedElement } from '../../__tests__/support/connectedElement.js';
import { EVENT_NAMES, createTrackerStateIntegration } from '../../__tests__/testIntegration.js';
import { RENDER_TARGETS } from '../../schedule/renderTargets.js';
import { renderTrackerInstance } from '../rendering.js';

/**
 * Stubs layout-dependent element metrics that jsdom does not compute.
 *
 * @param element - Target element.
 * @param extents - Client extents to define.
 */
function stubLayout(element: HTMLElement, extents: Record<string, number> = { clientHeight: 100, clientWidth: 100 }) {
  element.getClientRects = () => [{}] as unknown as DOMRectList;
  Object.entries(extents).forEach(([name, value]) => {
    Object.defineProperty(element, name, { configurable: true, value });
  });
}

/**
 * Creates a connected element-mode mount fixture with a valid vertical profile.
 *
 * The scroll root passes the guaranteed y-axis profile while its x axis keeps
 * the initial `visible` overflow, so a horizontal profile check fails.
 *
 * @returns Element-mode mount roots with one `.element-mode-target` source.
 */
function createElementMountFixture(): { scrollRoot: HTMLElement; sourceRoot: HTMLElement; renderRoot: HTMLElement } {
  const scrollRoot = createConnectedElement();

  scrollRoot.style.display = 'block';
  scrollRoot.style.overflowY = 'auto';
  stubLayout(scrollRoot);

  const sourceRoot = document.createElement('div');
  const target = document.createElement('p');

  target.className = 'element-mode-target';
  sourceRoot.appendChild(target);
  scrollRoot.appendChild(sourceRoot);

  const renderRoot = createConnectedElement();

  return { scrollRoot, sourceRoot, renderRoot };
}

/**
 * Creates a manual-updates runtime matching the single fixture target.
 *
 * @returns State integration runtime.
 */
function createElementRuntime(): ReturnType<typeof createTrackerStateIntegration> {
  return createTrackerStateIntegration({
    options: {
      clustering: { enabled: false },
      updates: {
        mutation: { enabled: false },
        resize: { enabled: false },
        scroll: { enabled: false },
        interval: { enabled: false },
      },
    },
    rules: [{ selector: '.element-mode-target' }],
  });
}

/** Restores the DOM and spies after each element-mode scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('element-mode runtime', () => {
  it('publishes the element-mode mounted schema after a positive container mount', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createElementRuntime();

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });

    expect(runtime.getSnapshot()).toMatchObject({
      mounted: true,
      scrollMode: 'element',
      geometryAvailable: true,
    });
    expect(runtime.getSnapshotProps().root).toMatchObject({
      scrollMode: 'element',
      geometryAvailable: true,
    });
    expect(runtime.getSnapshotProps().items).toHaveLength(1);
    expect(renderRoot.getAttribute('data-rxtt-scroll-mode')).toBe('element');
    expect(renderRoot.getAttribute('data-rxtt-geometry')).toBe('available');

    runtime.destroy();
  });

  it('suspends geometry once on a live profile violation and resumes through a narrow render', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createElementRuntime();

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });
    expect(runtime.getSnapshotProps().items).toHaveLength(1);

    scrollRoot.style.overflowY = 'visible';
    runtime.render();

    expect(runtime.getSnapshot()).toMatchObject({
      mounted: true,
      scrollMode: 'element',
      geometryAvailable: false,
    });
    expect(renderRoot.getAttribute('data-rxtt-geometry')).toBe('suspended');
    expect(renderRoot.getAttribute('aria-disabled')).toBe('true');
    expect(runtime.getSnapshotProps().items).toHaveLength(0);
    expect(runtime.getSnapshotProps().markersLayer.hidden).toBe(true);
    expect(runtime.getStats().warnings.byCode.WARN_TRACKER_GEOMETRY_SUSPENDED).toBe(1);

    runtime.render();

    expect(runtime.getStats().warnings.byCode.WARN_TRACKER_GEOMETRY_SUSPENDED).toBe(1);

    // Unrelated visual configuration must keep committing while suspended.
    expect(() => runtime.patchOptions({ marker: { className: 'suspended-visual' } })).not.toThrow();
    expect(runtime.instance.options.marker?.className).toBe('suspended-visual');

    scrollRoot.style.overflowY = 'auto';
    renderTrackerInstance(runtime.instance, 'viewport', { source: 'element-mode-test' }, { throwErrors: true });

    expect(runtime.getSnapshot()).toMatchObject({
      mounted: true,
      scrollMode: 'element',
      geometryAvailable: true,
    });
    expect(renderRoot.getAttribute('data-rxtt-geometry')).toBe('available');
    expect(renderRoot.hasAttribute('aria-disabled')).toBe(false);
    // Repopulated items after a viewport-only request prove the resumed upgrade to a full render.
    expect(runtime.getSnapshotProps().items).toHaveLength(1);
    expect(runtime.getStats().warnings.byCode.WARN_TRACKER_GEOMETRY_SUSPENDED).toBe(1);

    runtime.destroy();
  });

  it('emits selection:change when geometry suspension clears the current keyboard selection', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createTrackerStateIntegration({
      options: {
        a11y: { enabled: true, keyboard: true },
        clustering: { enabled: false },
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.element-mode-target' }],
    });
    const selectionHandler = vi.fn();

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });

    const [item] = runtime.getSnapshotProps().items;

    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    scrollRoot.style.overflowY = 'visible';
    runtime.render();

    expect(runtime.getSnapshotProps().items).toHaveLength(0);
    expect(selectionHandler).toHaveBeenCalledTimes(1);
    expect(selectionHandler).toHaveBeenCalledWith({ previousKey: item!.activationKey, selectedKey: null });

    runtime.destroy();
  });

  it('reports running as settled when a live profile violation suspends geometry', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createElementRuntime();
    const runningInSnapshots: boolean[] = [];

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });
    runtime.subscribe((snapshot) => {
      runningInSnapshots.push(snapshot.render.running);
    });

    scrollRoot.style.overflowY = 'visible';
    runtime.render();

    expect(runtime.getStats().warnings.byCode.WARN_TRACKER_GEOMETRY_SUSPENDED).toBe(1);
    expect(runningInSnapshots.length).toBeGreaterThan(0);
    expect(runningInSnapshots.every((running) => running === false)).toBe(true);

    runtime.destroy();
  });

  it('reports running as settled when geometry revalidation throws while entering suspension', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createElementRuntime();
    const runningInSnapshots: boolean[] = [];

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });
    runtime.subscribe((snapshot) => {
      runningInSnapshots.push(snapshot.render.running);
    });

    vi.spyOn(runtime.instance.renderer, 'renderMarkers').mockImplementationOnce(() => {
      throw new Error('marker layer failure');
    });

    scrollRoot.style.overflowY = 'visible';
    runtime.render();

    expect(runtime.getStats().warnings.byCode['render-error']).toBe(1);
    expect(runningInSnapshots.length).toBeGreaterThan(0);
    expect(runningInSnapshots.every((running) => running === false)).toBe(true);

    runtime.destroy();
  });

  it('rolls back all committed geometry state when suspended marker rendering fails, then retries cleanly', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createTrackerStateIntegration({
      options: {
        a11y: { enabled: true, keyboard: true },
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.element-mode-target' }],
    });

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });
    const selectedKey = runtime.getSnapshotProps().items[0]!.activationKey;

    runtime.activateRenderRecord(selectedKey);

    const previousItems = runtime.getSnapshot().items;
    const previousMarkerRecords = runtime.instance.markerStore.getAll();
    const previousRenderRecords = runtime.instance.renderRecords;
    const previousRenderRecordByKey = runtime.instance.renderRecordByKey;
    const previousStats = runtime.getStats();
    const previousGeometry = renderRoot.getAttribute('data-rxtt-geometry');
    const previousAriaDisabled = renderRoot.getAttribute('aria-disabled');
    const selectionHandler = vi.fn();

    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);
    vi.spyOn(runtime.instance.renderer, 'renderMarkers').mockImplementationOnce(() => {
      throw new Error('suspended marker render failed');
    });
    scrollRoot.style.overflowY = 'visible';
    runtime.render();

    expect(runtime.getSnapshot()).toMatchObject({ geometryAvailable: true, mounted: true });
    expect(runtime.getSnapshot().items.map(({ key }) => key)).toEqual(previousItems.map(({ key }) => key));
    expect(runtime.getSnapshot().selection.key).toBe(selectedKey);
    expect(runtime.instance.geometrySuspended).toBe(false);
    expect(runtime.instance.markerStore.getAll()).toEqual(previousMarkerRecords);
    expect(runtime.instance.renderRecords).toBe(previousRenderRecords);
    expect(runtime.instance.renderRecordByKey).toBe(previousRenderRecordByKey);
    expect(renderRoot.getAttribute('data-rxtt-geometry')).toBe(previousGeometry);
    expect(renderRoot.getAttribute('aria-disabled')).toBe(previousAriaDisabled);
    expect(runtime.getStats().markers).toEqual(previousStats.markers);
    expect(runtime.getStats().clusters).toEqual(previousStats.clusters);
    expect(runtime.instance.dirtyRenderTarget).toBe(RENDER_TARGETS.ALL);
    expect(runtime.getSnapshot().render.running).toBe(false);
    expect(selectionHandler).not.toHaveBeenCalled();

    runtime.render();

    expect(runtime.getSnapshot()).toMatchObject({ geometryAvailable: false, mounted: true });
    expect(runtime.getSnapshot().items).toHaveLength(0);
    expect(runtime.getSnapshot().selection.key).toBeNull();
    expect(selectionHandler).toHaveBeenCalledOnce();

    runtime.destroy();
  });

  it('rolls back suspension when the suspended viewport hook fails, then retries cleanly', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createElementRuntime();

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });
    const previousRecords = runtime.instance.renderRecords;
    const previousRecordByKey = runtime.instance.renderRecordByKey;
    const previousItems = runtime.getSnapshot().items;

    vi.spyOn(runtime.instance.renderer, 'renderViewport').mockImplementationOnce(() => {
      throw new Error('suspended viewport render failed');
    });
    scrollRoot.style.overflowY = 'visible';
    runtime.render();

    expect(runtime.instance.geometrySuspended).toBe(false);
    expect(runtime.instance.renderRecords).toBe(previousRecords);
    expect(runtime.instance.renderRecordByKey).toBe(previousRecordByKey);
    expect(runtime.getSnapshot().items.map(({ key }) => key)).toEqual(previousItems.map(({ key }) => key));
    expect(renderRoot.getAttribute('data-rxtt-geometry')).toBe('available');
    expect(renderRoot.hasAttribute('aria-disabled')).toBe(false);
    expect(runtime.instance.dirtyRenderTarget).toBe(RENDER_TARGETS.ALL);

    runtime.render();

    expect(runtime.instance.geometrySuspended).toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({ geometryAvailable: false });
    expect(runtime.getSnapshot().items).toHaveLength(0);

    runtime.destroy();
  });

  it('keeps committed suspension state when recovery rendering fails, then retries a full render', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createElementRuntime();
    const selectionHandler = vi.fn();

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });
    scrollRoot.style.overflowY = 'visible';
    runtime.render();
    runtime.on(EVENT_NAMES.SELECTION_CHANGE, selectionHandler);

    const suspendedRecords = runtime.instance.renderRecords;
    const suspendedRecordByKey = runtime.instance.renderRecordByKey;

    scrollRoot.style.overflowY = 'auto';
    vi.spyOn(runtime.instance.renderer, 'renderTrack').mockImplementationOnce(() => {
      throw new Error('recovery track render failed');
    });
    runtime.render();

    expect(runtime.instance.geometrySuspended).toBe(true);
    expect(runtime.instance.renderRecords).toBe(suspendedRecords);
    expect(runtime.instance.renderRecordByKey).toBe(suspendedRecordByKey);
    expect(runtime.getSnapshot()).toMatchObject({ geometryAvailable: false, mounted: true });
    expect(runtime.getSnapshot().items).toHaveLength(0);
    expect(renderRoot.getAttribute('data-rxtt-geometry')).toBe('suspended');
    expect(renderRoot.getAttribute('aria-disabled')).toBe('true');
    expect(runtime.instance.dirtyRenderTarget).toBe(RENDER_TARGETS.ALL);
    expect(selectionHandler).not.toHaveBeenCalled();

    renderTrackerInstance(runtime.instance, RENDER_TARGETS.VIEWPORT, undefined, { throwErrors: true });

    expect(runtime.instance.geometrySuspended).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({ geometryAvailable: true, mounted: true });
    expect(runtime.getSnapshot().items).toHaveLength(1);
    expect(renderRoot.getAttribute('data-rxtt-geometry')).toBe('available');
    expect(renderRoot.hasAttribute('aria-disabled')).toBe(false);

    runtime.destroy();
  });

  it('keeps the render failure primary when direct geometry metadata rollback also fails', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createElementRuntime();
    const renderError = new Error('suspended marker render failed');
    const rollbackError = new Error('geometry metadata rollback failed');

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });

    const previousRecords = runtime.instance.renderRecords;
    const nativeSetAttribute = renderRoot.setAttribute.bind(renderRoot);
    const setAttribute = vi.spyOn(renderRoot, 'setAttribute').mockImplementation((name, value) => {
      if (name === 'data-rxtt-geometry' && value === 'available') {
        throw rollbackError;
      }

      nativeSetAttribute(name, value);
    });

    vi.spyOn(runtime.instance.renderer, 'renderMarkers').mockImplementationOnce(() => {
      throw renderError;
    });
    scrollRoot.style.overflowY = 'visible';

    let failure: unknown;

    try {
      renderTrackerInstance(runtime.instance, RENDER_TARGETS.ALL, undefined, { throwErrors: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([renderError, rollbackError]);
    expect(runtime.instance.geometrySuspended).toBe(false);
    expect(runtime.instance.renderRecords).toBe(previousRecords);
    expect(runtime.instance.dirtyRenderTarget).toBe(RENDER_TARGETS.ALL);

    setAttribute.mockRestore();
    runtime.destroy();
  });

  it('rejects an unsupported orientation update transactionally', () => {
    const { scrollRoot, sourceRoot, renderRoot } = createElementMountFixture();
    const runtime = createElementRuntime();

    runtime.mount({ renderRoot, scrollRoot, sourceRoot });

    const rulesBefore = runtime.getRules();

    expect(() => runtime.patchOptions({ orientation: 'horizontal' })).toThrow(
      expect.objectContaining({
        code: 'ERR_TRACKER_UNSUPPORTED_SCROLL_ROOT',
        name: 'TrackerConfigurationError',
      }),
    );
    expect(runtime.instance.options.orientation).toBe('vertical');
    expect(runtime.getRules()).toEqual(rulesBefore);
    expect(runtime.isMounted()).toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      mounted: true,
      scrollMode: 'element',
      geometryAvailable: true,
    });

    runtime.destroy();
  });
});
