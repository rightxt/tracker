// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES } from '../../events/eventNames.js';
import { createTrackerInstance } from '../createTrackerInstance.js';
import {
  performTrackerInstanceRender,
  renderTrackerInstance,
  renderTrackerInstanceNow,
  requestTrackerInstanceRender,
} from '../rendering.js';
import { createTrackerStateIntegration } from '../../__tests__/support/stateIntegration.js';

import type { TrackerOptions } from '../../types.js';

/**
 * Creates a renderer stub with a mounted root and render spies.
 *
 * @returns Renderer stub.
 */
function createRendererStub() {
  const root = document.createElement('div');

  document.body.appendChild(root);

  return {
    root,
    mount: vi.fn(() => root),
    unmount: vi.fn(),
    renderMarkers: vi.fn(),
    renderTrack: vi.fn(),
    renderViewport: vi.fn(),
    destroy: vi.fn(),
    updateContext: vi.fn(),
  };
}

/**
 * Creates a tracker instance marked as mounted with a stub renderer.
 *
 * @param options - Tracker options; defaults to an empty configuration.
 * @returns Instance and renderer stub.
 */
function createMountedInstance(options: Partial<TrackerOptions> = {}) {
  const renderer = createRendererStub();
  const instance = createTrackerInstance({ options, rules: [] }, { renderer });

  instance.renderer.mount(
    {
      target: { kind: 'root', root: renderer.root },
      document,
      window,
      scrollMode: 'window',
    },
    instance.options,
  );
  instance.mounted = true;
  instance.lifecycleState = 'mounted';

  return { instance, renderer };
}

/** Removes test-owned renderer roots after each render scenario. */
afterEach(() => {
  document.body.replaceChildren();
});

describe('core tracker render pipeline', () => {
  it('runs the full pipeline and emits render lifecycle events for the all target', () => {
    const { instance, renderer } = createMountedInstance();
    const onSyncStart = vi.fn();
    const onSyncEnd = vi.fn();

    instance.events.on(EVENT_NAMES.SYNC_START, onSyncStart);
    instance.events.on(EVENT_NAMES.SYNC_END, onSyncEnd);

    renderTrackerInstance(instance, 'all');

    expect(renderer.renderTrack).toHaveBeenCalledTimes(1);
    expect(renderer.renderMarkers).toHaveBeenCalledTimes(1);
    expect(renderer.renderViewport).toHaveBeenCalledTimes(1);
    expect(onSyncStart).toHaveBeenCalledTimes(1);
    expect(onSyncEnd).toHaveBeenCalledTimes(1);

    const stats = instance.diagnostics.getStats();

    expect(stats.renders.started).toBe(1);
    expect(stats.renders.completed).toBe(1);
  });

  it('renders only the subsystems selected by partial targets', () => {
    const { instance, renderer } = createMountedInstance();

    renderTrackerInstance(instance, 'markers');

    expect(renderer.renderTrack).not.toHaveBeenCalled();
    expect(renderer.renderMarkers).toHaveBeenCalledTimes(1);
    expect(renderer.renderViewport).toHaveBeenCalledTimes(1);

    renderTrackerInstance(instance, 'track');

    expect(renderer.renderTrack).toHaveBeenCalledTimes(1);
    expect(renderer.renderMarkers).toHaveBeenCalledTimes(1);
    expect(renderer.renderViewport).toHaveBeenCalledTimes(2);

    renderTrackerInstance(instance, 'viewport');

    expect(renderer.renderTrack).toHaveBeenCalledTimes(1);
    expect(renderer.renderMarkers).toHaveBeenCalledTimes(1);
    expect(renderer.renderViewport).toHaveBeenCalledTimes(3);
  });

  it('reports pipeline errors as render-error warnings, emits a snapshot and skips sync:end', () => {
    const { instance, renderer } = createMountedInstance();
    const onSyncEnd = vi.fn();
    const listener = vi.fn();

    renderer.renderTrack.mockImplementation(() => {
      throw new Error('render failure');
    });
    instance.events.on(EVENT_NAMES.SYNC_END, onSyncEnd);
    instance.snapshotStore!.subscribe(listener);

    renderTrackerInstance(instance, 'all');

    const stats = instance.diagnostics.getStats();

    expect(stats.warnings.byCode['render-error']).toBe(1);
    expect(stats.renders.started).toBe(1);
    expect(stats.renders.completed).toBe(0);
    expect(onSyncEnd).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('restores committed marker state when marker rendering fails', () => {
    const { instance, renderer } = createMountedInstance();
    const previousRecord = { key: 'previous', kind: 'marker' } as never;
    const candidateRecord = { key: 'candidate', kind: 'marker' } as never;

    instance.renderRecords = [previousRecord];
    instance.renderRecordByKey = new Map([['previous', previousRecord]]);
    instance.diagnostics.setCurrentRenderCounts({ markers: 1, clusters: 0 });
    vi.spyOn(instance.queryEngine, 'query').mockReturnValue([]);
    vi.spyOn(instance.markerStore, 'rebuild').mockImplementation(() => {
      instance.diagnostics.setCurrentRenderCounts({ markers: 2, clusters: 0 });

      return { changed: true, created: 1, records: [candidateRecord], removed: 0, skipped: 0 };
    });
    vi.spyOn(instance.layoutEngine, 'measureMarkers').mockReturnValue([candidateRecord]);
    vi.spyOn(instance.clusterEngine, 'cluster').mockReturnValue([candidateRecord]);
    renderer.renderMarkers.mockImplementation(() => {
      throw new Error('marker render failed');
    });

    renderTrackerInstance(instance, 'markers');

    expect(instance.renderRecords).toEqual([previousRecord]);
    expect(instance.renderRecordByKey.get('previous')).toBe(previousRecord);
    expect(instance.renderRecordByKey.has('candidate')).toBe(false);
    expect(instance.diagnostics.getStats().markers.current).toBe(1);
  });

  it('reports running as settled for a pipeline error snapshot', () => {
    const { instance, renderer } = createMountedInstance();
    const runningInSnapshots: boolean[] = [];

    instance.scheduler.updateContext({
      render: (target, reason) => {
        performTrackerInstanceRender(instance, target, reason);
      },
    });

    renderer.renderTrack.mockImplementation(() => {
      throw new Error('render failure');
    });
    instance.snapshotStore!.subscribe((snapshot) => {
      runningInSnapshots.push(snapshot.render.running);
    });

    renderTrackerInstanceNow(instance);

    expect(instance.diagnostics.getStats().warnings.byCode['render-error']).toBe(1);
    expect(runningInSnapshots.length).toBeGreaterThan(0);
    expect(runningInSnapshots.every((running) => running === false)).toBe(true);
  });

  it.each(['renderTrack', 'renderMarkers', 'renderViewport'] as const)(
    'forces a full recovery pass after %s fails',
    (methodName) => {
      const { instance, renderer } = createMountedInstance();

      renderer[methodName].mockImplementationOnce(() => {
        throw new Error(`${methodName} failure`);
      });

      renderTrackerInstance(instance, 'all');

      expect(instance.dirtyRenderTarget).toBe('all');

      renderer.renderTrack.mockClear();
      renderer.renderMarkers.mockClear();
      renderer.renderViewport.mockClear();
      const request = vi.spyOn(instance.scheduler, 'request');

      requestTrackerInstanceRender(instance, 'viewport', true);

      expect(request).toHaveBeenCalledWith('all', undefined);

      renderTrackerInstance(instance, 'all');

      expect(renderer.renderTrack).toHaveBeenCalledTimes(1);
      expect(renderer.renderMarkers).toHaveBeenCalledTimes(1);
      expect(renderer.renderViewport).toHaveBeenCalledTimes(1);
      expect(instance.dirtyRenderTarget).toBeNull();
    },
  );

  it('skips rendering when the instance is not mounted', () => {
    const renderer = createRendererStub();
    const instance = createTrackerInstance({ options: {}, rules: [] }, { renderer });

    renderTrackerInstance(instance, 'all');

    expect(renderer.renderTrack).not.toHaveBeenCalled();
    expect(instance.diagnostics.getStats().renders.skipped).toBe(1);
  });

  it('warns for invalid render targets', () => {
    const { instance, renderer } = createMountedInstance();

    renderTrackerInstance(instance, 'bogus' as never);

    expect(renderer.renderTrack).not.toHaveBeenCalled();
    expect(instance.diagnostics.getStats().warnings.byCode['invalid-render-target']).toBe(1);
  });

  it('does nothing for destroyed instances', () => {
    const { instance, renderer } = createMountedInstance();
    const listener = vi.fn();

    instance.snapshotStore!.subscribe(listener);
    instance.destroyed = true;

    renderTrackerInstance(instance, 'all');

    expect(renderer.renderTrack).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('passes a frozen renderer-facing options snapshot that cannot corrupt internal state, reused across renders until options change', () => {
    // Assertions must run outside the mock implementation: the render pipeline
    // wraps renderer calls in its own try/catch and reports failures as
    // `render-error` diagnostics, which would silently swallow a thrown
    // expectation and produce a false pass.
    const { instance, renderer } = createMountedInstance();
    const capturedOptionsPerCall: Record<string, unknown>[] = [];

    renderer.renderTrack.mockImplementation((options: Record<string, unknown>) => {
      capturedOptionsPerCall.push(options);

      try {
        options.marker = 'tampered';
      } catch {
        // Expected once the renderer-facing snapshot is frozen; ignored here
        // so it cannot be misreported as a pipeline render error.
      }
    });

    renderTrackerInstance(instance, 'all');
    renderTrackerInstance(instance, 'track');

    expect(capturedOptionsPerCall).toHaveLength(2);
    expect(Object.isFrozen(capturedOptionsPerCall[0])).toBe(true);
    expect(capturedOptionsPerCall[0]).toBe(capturedOptionsPerCall[1]);
    expect(instance.options.marker).not.toBe('tampered');
  });

  it('deeply freezes nested branches of the renderer-facing options snapshot so mutating a nested field cannot corrupt live instance state', () => {
    const { instance, renderer } = createMountedInstance();
    let capturedOptions: Record<string, unknown> | null = null;

    renderer.renderTrack.mockImplementation((options: Record<string, unknown>) => {
      capturedOptions = options;

      try {
        (options.marker as Record<string, unknown>).className = 'tampered';
      } catch {
        // Expected once the nested branch is frozen; ignored so it cannot be
        // misreported as a pipeline render error.
      }
    });

    renderTrackerInstance(instance, 'all');

    expect(capturedOptions).not.toBeNull();
    expect(Object.isFrozen(capturedOptions!.marker)).toBe(true);
    expect(instance.options.marker.className).not.toBe('tampered');
    expect(instance.options.marker).not.toBe(capturedOptions!.marker);
  });
});

describe('core tracker render requests', () => {
  it('refreshes snapshots without scheduling for null targets and ignores destroyed instances', () => {
    const { instance } = createMountedInstance();
    const requestSpy = vi.spyOn(instance.scheduler, 'request');
    const listener = vi.fn();

    instance.snapshotStore!.subscribe(listener);

    requestTrackerInstanceRender(instance, null, true);

    expect(requestSpy).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);

    instance.destroyed = true;
    requestTrackerInstanceRender(instance, 'all', true);
    requestTrackerInstanceRender(instance, null, true);

    expect(requestSpy).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('warns for invalid targets', () => {
    const { instance } = createMountedInstance();

    requestTrackerInstanceRender(instance, 'bogus' as never, true);

    expect(instance.diagnostics.getStats().warnings.byCode['invalid-render-target']).toBe(1);
  });

  it('stores merged deferred targets until an immediate render is requested', () => {
    const { instance } = createMountedInstance();
    const requestSpy = vi.spyOn(instance.scheduler, 'request');

    requestTrackerInstanceRender(instance, 'markers', false);

    expect(instance.dirtyRenderTarget).toBe('markers');
    expect(requestSpy).not.toHaveBeenCalled();

    requestTrackerInstanceRender(instance, 'track', true);

    expect(instance.dirtyRenderTarget).toBeNull();
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith('all', undefined);
  });

  it('defers rendering while the instance is unmounted', () => {
    const renderer = createRendererStub();
    const instance = createTrackerInstance({ options: {}, rules: [] }, { renderer });
    const requestSpy = vi.spyOn(instance.scheduler, 'request');

    requestTrackerInstanceRender(instance, 'viewport', true);

    expect(instance.dirtyRenderTarget).toBe('viewport');
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('publishes a pending snapshot for a scheduled render request', () => {
    const { instance } = createMountedInstance();
    const listener = vi.fn();

    instance.snapshotStore!.subscribe(listener);
    requestTrackerInstanceRender(instance, 'viewport', true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].render.pending).toBe(true);
  });

  it('reports running as settled by the time sync:end fires and the final snapshot publishes', () => {
    const { instance } = createMountedInstance();
    const runningDuringSyncEnd: boolean[] = [];
    const runningInSnapshots: boolean[] = [];

    // Wires the scheduler's internal render callback to the real pipeline,
    // mirroring how production lifecycle callbacks dispatch a scheduled
    // render (see lifecycleCallbacks.ts) so #runPending() actually runs it.
    instance.scheduler.updateContext({
      render: (target, reason) => {
        performTrackerInstanceRender(instance, target, reason);
      },
    });

    instance.events.on(EVENT_NAMES.SYNC_END, () => {
      runningDuringSyncEnd.push(instance.scheduler.running);
    });
    instance.snapshotStore!.subscribe((snapshot) => {
      runningInSnapshots.push(snapshot.render.running);
    });

    // Goes through the scheduler (request + flush), the only path that sets
    // the running flag before the render pipeline runs.
    renderTrackerInstanceNow(instance);

    expect(runningDuringSyncEnd).toEqual([false]);
    expect(runningInSnapshots.length).toBeGreaterThan(0);
    expect(runningInSnapshots.every((running) => running === false)).toBe(true);
  });
});

describe('core tracker public render', () => {
  it('requests and flushes a full render when mounted', () => {
    const { instance } = createMountedInstance();
    const requestSpy = vi.spyOn(instance.scheduler, 'request');
    const flushSpy = vi.spyOn(instance.scheduler, 'flush');

    renderTrackerInstanceNow(instance);

    expect(requestSpy).toHaveBeenCalledWith('all', { source: 'public-render' });
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('publishes only the final snapshot for a synchronous public render', () => {
    const renderRoot = document.createElement('div');
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [],
    });
    const listener = vi.fn();

    document.body.appendChild(renderRoot);
    runtime.mount({ renderRoot });
    runtime.subscribe(listener);

    runtime.render();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].render.pending).toBe(false);

    runtime.destroy();
  });

  it('does not commit stale marker ownership when a label() callback invalidates its own rule mid-render', () => {
    const renderRoot = document.createElement('div');
    const source = document.createElement('div');

    source.classList.add('first', 'second');

    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [
        {
          selector: '.first',
          label: (element: Element) => {
            element.classList.remove('first');

            return 'First';
          },
        },
        {
          selector: '.second',
          label: 'Second',
        },
      ],
    });

    document.body.append(source, renderRoot);
    runtime.mount({ renderRoot });

    runtime.render();

    const records = runtime.instance.markerStore.getAll();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      element: source,
      ruleIndex: 1,
      label: 'Second',
    });

    runtime.destroy();
    source.remove();
  });

  it('rejects arguments', () => {
    const { instance } = createMountedInstance();
    const flushSpy = vi.spyOn(instance.scheduler, 'flush');

    expect(() => renderTrackerInstanceNow(instance, ['extra'])).toThrow(TypeError);

    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('rejects renders while unmounted or destroyed', () => {
    const renderer = createRendererStub();
    const instance = createTrackerInstance({ options: {}, rules: [] }, { renderer });
    const flushSpy = vi.spyOn(instance.scheduler, 'flush');

    expect(() => renderTrackerInstanceNow(instance)).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONTEXT' }),
    );

    expect(flushSpy).not.toHaveBeenCalled();
    instance.destroyed = true;
    expect(() => renderTrackerInstanceNow(instance)).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }),
    );

    expect(flushSpy).not.toHaveBeenCalled();
  });
});
