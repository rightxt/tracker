// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInternalDomRegistry } from '../../dom/internalDomRegistry.js';
import { EVENT_NAMES } from '../../events/eventNames.js';
import {
  createTrackerIntegrationInstance,
  createTrackerIntegrationInstance as createDiagnosticTrackerIntegrationInstance,
  createTrackerStateIntegration,
  destroyTrackerInstance,
  getTrackerInstanceSnapshot,
  mountTrackerInstance,
  renderTrackerInstanceNow,
  subscribeTrackerInstanceSnapshot,
  unmountTrackerInstance,
} from '../../__tests__/testIntegration.js';
import { runTrackerPublicDispatch } from '../operationCoordinator.js';

import type {
  TrackerIntegrationMountRequest,
  TrackerRendererContext,
  TrackerRendererLike,
  TrackerSnapshot,
  TrackerViewportLayoutRecord,
} from '../../types.js';

/** Removes test-owned DOM after every renderer publication lifecycle scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('renderer publication and transaction lifecycle', () => {
  it('delivers provisional and reset renderer contexts around a reversible mount', () => {
    const host = document.createElement('div');
    const contexts: Array<TrackerRendererContext & Record<string, unknown>> = [];
    let root: HTMLElement | null = null;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;
    const renderer: TrackerRendererLike = {
      destroy() {
        root = null;
      },
      mount(context) {
        const target = context.target.kind === 'host' ? context.target.host : context.target.root;

        root = context.document.createElement('div');
        target.appendChild(root);

        return root;
      },
      get root() {
        return root;
      },
      updateContext(context) {
        contexts.push(context as TrackerRendererContext & Record<string, unknown>);
      },
    };

    document.body.appendChild(host);
    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      { getInstance: () => instance, renderer },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'host', host } });
    unmountTrackerInstance(instance);

    expect(contexts).toContainEqual(
      expect.objectContaining({ document, window, scrollMode: 'window', diagnostics: instance.diagnostics }),
    );
    expect(contexts.at(-1)).toEqual(
      expect.objectContaining({ document: null, window: null, scrollMode: null, diagnostics: instance.diagnostics }),
    );

    destroyTrackerInstance(instance);
  });

  it('publishes no provisional render events and one stable snapshot after failed mount', () => {
    const host = document.createElement('div');
    const renderError = new Error('provisional render failed');
    const snapshots: TrackerSnapshot[] = [];
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
    const onSyncStart = vi.fn();
    const onSyncEnd = vi.fn();

    document.body.appendChild(host);
    runtime.on('sync:start', onSyncStart);
    runtime.on('sync:end', onSyncEnd);
    runtime.subscribe((snapshot) => snapshots.push(snapshot));
    vi.spyOn(runtime.instance.renderer, 'renderTrack').mockImplementationOnce(() => {
      throw renderError;
    });

    expect(() => runtime.mount({ renderRoot: host })).toThrow(renderError);
    expect(onSyncStart).not.toHaveBeenCalled();
    expect(onSyncEnd).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      lifecycle: { mounted: false, hasRenderRoot: false },
    });
    expect(runtime.getRoot()).toBeNull();
    expect(getInternalDomRegistry(document).activeCount).toBe(0);

    runtime.destroy();
  });

  it('rolls back before initial-render success events when prepared snapshot construction fails', () => {
    const root = document.createElement('div');
    const prepareError = new Error('prepared snapshot construction failed');
    const sequence: string[] = [];
    const snapshots: TrackerSnapshot[] = [];
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(root);
    instance = createTrackerIntegrationInstance(
      { rules: [] },
      {
        getInstance: () => instance,
        renderer: {
          destroy() {},
          mount: () => root,
          root,
          unmount() {},
        },
      },
    );
    instance.events.on(EVENT_NAMES.SYNC_START, () => sequence.push('sync:start'));
    instance.events.on(EVENT_NAMES.SYNC_END, () => sequence.push('sync:end'));
    instance.events.on(EVENT_NAMES.SELECTION_CHANGE, () => sequence.push('selection:change'));
    subscribeTrackerInstanceSnapshot(instance, (snapshot) => {
      sequence.push('snapshot');
      snapshots.push(snapshot);
    });
    const prepareSnapshot = vi.spyOn(instance.snapshotStore!, 'prepare').mockImplementationOnce(() => {
      throw prepareError;
    });

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'root', root } })).toThrow(prepareError);
    expect(instance.lifecycleState).toBe('unmounted');
    expect(sequence).toEqual(['snapshot']);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ geometryAvailable: false, mounted: false });
    expect(getInternalDomRegistry(document).activeCount).toBe(0);

    sequence.length = 0;
    snapshots.length = 0;

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });

    expect(sequence).toEqual(['sync:start', 'sync:end', 'snapshot']);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ geometryAvailable: true, mounted: true });
    expect(snapshots[0]).toBe(prepareSnapshot.mock.results[1]?.value);
    expect(prepareSnapshot).toHaveBeenCalledTimes(2);

    destroyTrackerInstance(instance);
  });

  it('prepares the initial snapshot from the Core-owned viewport result rather than renderer-mutated input', () => {
    const root = document.createElement('div');
    const listener = vi.fn();
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(root);
    instance = createTrackerIntegrationInstance(
      { rules: [] },
      {
        getInstance: () => instance,
        renderer: {
          destroy() {},
          mount: () => root,
          renderViewport(viewportLayout) {
            viewportLayout.start = 90;
            viewportLayout.size = 1;
            viewportLayout.visible = false;
          },
          root,
          unmount() {},
        },
      },
    );
    vi.spyOn(instance.layoutEngine, 'measureViewport').mockReturnValue({
      end: 30,
      orientation: 'vertical',
      size: 20,
      source: { contentSize: 100, scrollOffset: 10, viewportSize: 20 },
      start: 10,
      visible: true,
    });
    subscribeTrackerInstanceSnapshot(instance, listener);

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { size: 20, start: 10, visible: true } }),
    );

    destroyTrackerInstance(instance);
  });

  it('publishes the prepared initial snapshot only to the listener set current after mount success events', () => {
    const root = document.createElement('div');
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;
    let unsubscribeA = (): void => undefined;

    document.body.appendChild(root);
    instance = createTrackerIntegrationInstance(
      { rules: [] },
      {
        getInstance: () => instance,
        renderer: { destroy() {}, mount: () => root, root, unmount() {} },
      },
    );
    // No snapshot subscribers exist when the mount publication begins. Listener A
    // joins during sync:start and is replaced by listener B during sync:end, so
    // only B is a current listener once both success events have completed and
    // the prepared mounted snapshot is delivered.
    instance.events.on(EVENT_NAMES.SYNC_START, () => {
      unsubscribeA = subscribeTrackerInstanceSnapshot(instance!, listenerA);
    });
    instance.events.on(EVENT_NAMES.SYNC_END, () => {
      unsubscribeA();
      subscribeTrackerInstanceSnapshot(instance!, listenerB);
    });
    const prepareSnapshot = vi.spyOn(instance.snapshotStore!, 'prepare');

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });

    expect(prepareSnapshot).toHaveBeenCalledTimes(1);
    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledOnce();
    expect(listenerB).toHaveBeenCalledWith(prepareSnapshot.mock.results[0]?.value);
    expect(listenerB.mock.calls[0]?.[0]).toMatchObject({ geometryAvailable: true, mounted: true });

    destroyTrackerInstance(instance);
  });

  it('uses Core committed viewport authority for an unobserved mount and later render without reading renderer.viewportLayout', () => {
    const root = document.createElement('div');
    const snapshots: TrackerSnapshot[] = [];
    let viewportReads = 0;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(root);
    instance = createTrackerIntegrationInstance(
      { rules: [] },
      {
        getInstance: () => instance,
        renderer: {
          destroy() {},
          mount: () => root,
          root,
          unmount() {},
          get viewportLayout(): TrackerViewportLayoutRecord | null {
            viewportReads += 1;
            throw new Error('optional viewport state must not be snapshot authority');
          },
        },
      },
    );
    vi.spyOn(instance.layoutEngine, 'measureViewport')
      .mockReturnValueOnce({
        end: 30,
        orientation: 'vertical',
        size: 20,
        source: { contentSize: 100, scrollOffset: 10, viewportSize: 20 },
        start: 10,
        visible: true,
      })
      .mockReturnValueOnce({
        end: 52,
        orientation: 'vertical',
        size: 30,
        source: { contentSize: 120, scrollOffset: 22, viewportSize: 30 },
        start: 22,
        visible: true,
      });

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });

    expect(getTrackerInstanceSnapshot(instance).viewport).toEqual({ size: 20, start: 10, visible: true });
    expect(viewportReads).toBe(0);

    subscribeTrackerInstanceSnapshot(instance, (snapshot) => snapshots.push(snapshot));
    renderTrackerInstanceNow(instance);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.viewport).toEqual({ size: 30, start: 22, visible: true });
    expect(viewportReads).toBe(0);

    destroyTrackerInstance(instance);
  });

  it('retains the last committed viewport after a failed render and clears it after unmount', () => {
    const root = document.createElement('div');
    const renderError = new Error('replacement viewport render failed');
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(root);
    instance = createTrackerIntegrationInstance(
      { rules: [] },
      {
        getInstance: () => instance,
        renderer: {
          destroy() {},
          mount: () => root,
          renderViewport: vi
            .fn()
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
              throw renderError;
            }),
          root,
          unmount() {},
        },
      },
    );
    vi.spyOn(instance.layoutEngine, 'measureViewport')
      .mockReturnValueOnce({
        end: 30,
        orientation: 'vertical',
        size: 20,
        source: { contentSize: 100, scrollOffset: 10, viewportSize: 20 },
        start: 10,
        visible: true,
      })
      .mockReturnValueOnce({
        end: 52,
        orientation: 'vertical',
        size: 30,
        source: { contentSize: 120, scrollOffset: 22, viewportSize: 30 },
        start: 22,
        visible: true,
      });

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });
    expect(getTrackerInstanceSnapshot(instance).viewport).toEqual({ size: 20, start: 10, visible: true });

    renderTrackerInstanceNow(instance);

    expect(getTrackerInstanceSnapshot(instance).viewport).toEqual({ size: 20, start: 10, visible: true });

    unmountTrackerInstance(instance);

    expect(getTrackerInstanceSnapshot(instance)).toMatchObject({
      geometryAvailable: false,
      mounted: false,
      viewport: { size: 0, start: 0, visible: false },
    });

    destroyTrackerInstance(instance);
  });

  it('restores a pre-existing tracked attribute value on unmount when the renderer does not own mount attributes', () => {
    const root = document.createElement('div');

    root.setAttribute('aria-disabled', 'true');
    document.body.appendChild(root);

    const runtime = createTrackerStateIntegration({ rules: [] });

    runtime.mount({ renderRoot: root });

    expect(root.getAttribute('data-rxtt-scroll-mode')).toBe('window');
    expect(root.getAttribute('aria-disabled')).toBe('true');

    runtime.unmount();

    expect(root.hasAttribute('data-rxtt-scroll-mode')).toBe(false);
    expect(root.hasAttribute('data-rxtt-geometry')).toBe(false);
    expect(root.getAttribute('aria-disabled')).toBe('true');

    runtime.destroy();
  });

  it('continues root-attribute restoration after an earlier failure and captures a fresh baseline on remount', () => {
    const root = document.createElement('div');
    const restorationError = new Error('data-rxtt-scroll-mode restoration failed');
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    root.setAttribute('data-rxtt-scroll-mode', 'legacy-scroll');
    root.setAttribute('data-rxtt-geometry', 'legacy-geometry');
    root.setAttribute('aria-disabled', 'legacy-disabled');
    document.body.appendChild(root);

    instance = createTrackerIntegrationInstance(
      { rules: [] },
      {
        getInstance: () => instance,
        renderer: {
          destroy() {},
          mount: () => root,
          root,
          unmount() {},
        },
      },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });
    const nativeSetAttribute = root.setAttribute.bind(root);
    const setAttribute = vi.spyOn(root, 'setAttribute').mockImplementation((name, value) => {
      if (name === 'data-rxtt-scroll-mode') {
        throw restorationError;
      }

      nativeSetAttribute(name, value);
    });

    expect(() => unmountTrackerInstance(instance!)).toThrow(restorationError);
    expect(root.getAttribute('data-rxtt-geometry')).toBe('legacy-geometry');
    expect(root.getAttribute('aria-disabled')).toBe('legacy-disabled');
    expect(instance.rootAttributeSnapshot).toBeNull();

    setAttribute.mockRestore();
    root.setAttribute('data-rxtt-scroll-mode', 'fresh-scroll');
    root.setAttribute('data-rxtt-geometry', 'fresh-geometry');
    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root } });
    unmountTrackerInstance(instance);

    expect(root.getAttribute('data-rxtt-scroll-mode')).toBe('fresh-scroll');
    expect(root.getAttribute('data-rxtt-geometry')).toBe('fresh-geometry');

    destroyTrackerInstance(instance);
  });

  it('aggregates the original mount failure with a renderer cleanup failure during rollback', () => {
    const target = document.createElement('div');
    const cleanupError = new Error('renderer cleanup failed during rollback');
    const unmount = vi.fn(() => {
      throw cleanupError;
    });
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(target);
    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      { getInstance: () => instance, renderer: { mount: () => null, unmount } },
    );

    let thrown: unknown;

    try {
      mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root: target } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);

    const aggregate = thrown as AggregateError;

    expect(aggregate.errors).toHaveLength(2);
    expect((aggregate.errors[0] as { code?: string }).code).toBe('ERR_TRACKER_RENDERER_CONTRACT');
    expect((aggregate.errors[0] as Error).message).toBe('Tracker renderer did not provide a mount root.');
    expect(aggregate.errors[1]).toBe(cleanupError);
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(instance.lifecycleState).toBe('unmounted');

    destroyTrackerInstance(instance);
  });

  it('drops a mount queued behind a reentrant destroy from the same public dispatch without ever invoking the renderer', () => {
    const root = document.createElement('div');
    const mount = vi.fn(() => null);
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(root);
    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      { getInstance: () => instance, renderer: { mount } },
    );

    // Both calls run from inside the same public dispatch, so neither runs
    // immediately: destroy is queued first and mount second. destroy's queued
    // body still observes the pre-destroy lifecycle state (mount's call-time
    // guard cannot have fired), so this exercises mount's own re-validated
    // in-queue guard, not the call-time one already covered above.
    //
    // `getTrackerInstanceSnapshot`/`getTrackerInstanceStats` freeze diagnostics
    // to `finalStats` captured during destroy (see `instanceStats.ts`), and
    // `destroy()` also nulls the configured output sink, so this later
    // deferred failure is only observable on the live `Diagnostics#getStats()`
    // counters, not through the snapshot or a configured output sink.
    runTrackerPublicDispatch(instance, () => {
      destroyTrackerInstance(instance!);
      mountTrackerInstance(instance!, { rendererTarget: { kind: 'root', root } });
    });

    expect(instance.lifecycleState).toBe('destroyed');
    expect(instance.destroyed).toBe(true);
    expect(mount).not.toHaveBeenCalled();
    expect(instance.diagnostics.getStats().errors.byCode['deferred-operation-error']).toBe(1);
  });

  it('reports and rethrows when a mount request fails normalization before any coordinated operation runs', () => {
    const mount = vi.fn(() => null);
    const diagnosticError = vi.fn();
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    instance = createDiagnosticTrackerIntegrationInstance(
      {
        options: {
          diagnostics: { output: { error: diagnosticError } },
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      { getInstance: () => instance, renderer: { mount } },
    );

    // No rendererTarget: fails inside normalizeTrackerMountRequest before the
    // request ever reaches coordinateTrackerOperation, so this exercises
    // assertTrackerMountRequestIsValid's own diagnostics-and-rethrow catch
    // block rather than any renderer- or coordinator-level failure path.
    expect(() => mountTrackerInstance(instance!, {} as TrackerIntegrationMountRequest)).toThrow(
      'Tracker rendererTarget must be a host or root target.',
    );
    expect(instance.mounted).toBe(false);
    expect(mount).not.toHaveBeenCalled();
    expect(diagnosticError).toHaveBeenCalledWith(
      'invalid-mount-context',
      'Tracker mount request is invalid.',
      expect.objectContaining({ error: 'Tracker rendererTarget must be a host or root target.' }),
    );
    expect(instance.diagnostics.getStats().errors.byCode['invalid-mount-context']).toBe(1);

    destroyTrackerInstance(instance);
  });
});
