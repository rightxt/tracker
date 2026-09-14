import { DebugDiagnostics } from '../diagnostics/DebugDiagnostics.js';
import { EVENT_NAMES } from '../events/eventNames.js';
import type { TrackerSelectionTransition } from '../interaction/InteractionController.js';
import { RENDER_TARGETS, isRenderTarget, mergeRenderTargets } from '../schedule/renderTargets.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import type {
  TrackerMarkerDefaultsSnapshot,
  TrackerRenderReason,
  TrackerRenderRecord,
  TrackerRenderTarget,
  TrackerSelectionChangeEventPayload,
  TrackerSyncEndEventPayload,
  TrackerSyncStartEventPayload,
  TrackerViewportLayoutRecord,
} from '../types.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { assertTrackerInstanceMounted } from './lifecycleGuards.js';
import {
  createTrackerGeometryMetadataRollbackState,
  restoreTrackerGeometryRootMetadata,
  revalidateTrackerGeometry,
} from './geometrySuspension.js';
import type { TrackerGeometryMetadataRollbackState } from './geometrySuspension.js';
import { coordinateTrackerOperation } from './operationCoordinator.js';
import { flushTrackerInstanceRenderNow } from './scheduling.js';
import { emitTrackerInstanceSnapshot } from './snapshotStore.js';
import { createTrackerMarkerDefaultsSnapshot } from './markerDefaultsSnapshot.js';
import {
  buildTrackerSelectionChangeEventPayload,
  emitTrackerSelectionChangeEvent,
  synchronizeTrackerRenderedSelection,
} from './selection.js';
import {
  beginTrackerRendererTransaction,
  commitTrackerRendererTransaction,
  rollbackTrackerRendererTransaction,
} from './rendererTransaction.js';

/** Compile-time flag selecting debug diagnostics in core bundles. */
declare const __RXT_TRACKER_DEBUG__: boolean | undefined;

interface RenderTrackerInstanceOptions {
  /** Whether pipeline failures should be reported to the caller after diagnostics. */
  throwErrors?: boolean;
  /** Whether successful render publication is staged for an atomic mount commit. */
  stagePublication?: boolean;
}

/** Event payloads captured around one successfully staged render pass. */
interface TrackerRenderPublication {
  /** Render-start event payload. */
  start: TrackerSyncStartEventPayload;
  /** Render-end event payload. */
  end: TrackerSyncEndEventPayload;
  /** Marker defaults retained by the staged render operation. */
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined;
  /** Selection-change event payload retained by the staged render operation, if any. */
  selectionChange: TrackerSelectionChangeEventPayload | null;
  /** Core-owned viewport layout produced by the staged render, when measured. */
  viewportLayout: TrackerViewportLayoutRecord | undefined;
}

/** Marker pipeline result. */
interface TrackerMarkerRenderResult {
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined;
  selectionTransition: TrackerSelectionTransition | null;
}

/** Core-owned state restored when any phase of one render attempt fails. */
interface TrackerRenderRollbackState {
  /** Cluster diagnostic counters preceding the render. */
  clusterStats: ReturnType<TrackerInstance['diagnostics']['getStats']>['clusters'];
  /** Geometry availability preceding revalidation. */
  geometrySuspended: boolean;
  /** Direct-renderer metadata captured lazily by geometry revalidation. */
  geometryMetadata: TrackerGeometryMetadataRollbackState;
  /** Marker records preceding the render. */
  markerRecords: ReturnType<TrackerInstance['markerStore']['getAll']>;
  /** Marker and cluster diagnostic counters preceding the render. */
  markerStats: ReturnType<TrackerInstance['diagnostics']['getStats']>['markers'];
  /** Render-record lookup preceding the render. */
  renderRecordByKey: Map<string, TrackerRenderRecord>;
  /** Published render records preceding the render. */
  renderRecords: TrackerRenderRecord[];
  /** Logical selection preceding the render. */
  selectedKey: string | null;
}

/** Result of best-effort render rollback. */
interface TrackerRenderRollbackResult {
  /** Rollback failures in execution order. */
  errors: unknown[];
  /** Selection transition produced while restoring committed selection. */
  selectionTransition: TrackerSelectionTransition | null;
}

/**
 * Converts marker and cluster render records into a lookup map.
 *
 * @param renderRecords - Render records.
 * @returns Render record map.
 */
function createRenderRecordMap(renderRecords: TrackerRenderRecord[]): Map<string, TrackerRenderRecord> {
  return new Map(renderRecords.map((record) => [record.key, record]));
}

/**
 * Captures the complete committed Core state preceding geometry revalidation.
 *
 * @param instance - Internal Tracker instance.
 * @returns Render-attempt rollback state.
 */
function captureTrackerRenderRollbackState(instance: TrackerInstance): TrackerRenderRollbackState {
  const stats = instance.diagnostics.getStats();

  return {
    clusterStats: stats.clusters,
    geometrySuspended: instance.geometrySuspended,
    geometryMetadata: createTrackerGeometryMetadataRollbackState(),
    markerRecords: instance.markerStore.getAll(),
    markerStats: stats.markers,
    renderRecordByKey: instance.renderRecordByKey,
    renderRecords: instance.renderRecords,
    selectedKey: instance.interactionController.getSelectedKey(),
  };
}

/**
 * Attempts one rollback substep without replacing the original render error.
 *
 * @param operation - Rollback substep.
 * @param errors - Mutable rollback error collection.
 */
function attemptTrackerRenderRollback(operation: () => void, errors: unknown[]): void {
  try {
    operation();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * Restores all Core and renderer state owned by one failed render attempt.
 *
 * @param instance - Internal Tracker instance.
 * @param rollbackState - State captured before geometry revalidation.
 * @returns Rollback failures and the logical selection restoration transition.
 */
function rollbackTrackerRenderAttempt(
  instance: TrackerInstance,
  rollbackState: TrackerRenderRollbackState,
): TrackerRenderRollbackResult {
  const errors: unknown[] = [];
  let selectionTransition: TrackerSelectionTransition | null = null;

  attemptTrackerRenderRollback(() => rollbackTrackerRendererTransaction(instance.renderer), errors);
  instance.geometrySuspended = rollbackState.geometrySuspended;
  attemptTrackerRenderRollback(() => instance.markerStore.restore(rollbackState.markerRecords), errors);
  instance.renderRecords = rollbackState.renderRecords;
  instance.renderRecordByKey = rollbackState.renderRecordByKey;
  attemptTrackerRenderRollback(() => {
    selectionTransition = instance.interactionController.synchronizeSelection(rollbackState.selectedKey);
  }, errors);
  attemptTrackerRenderRollback(
    () => instance.diagnostics.restoreMarkerCounters(rollbackState.markerStats, rollbackState.clusterStats),
    errors,
  );
  errors.push(...restoreTrackerGeometryRootMetadata(rollbackState.geometryMetadata));

  return { errors, selectionTransition };
}

/**
 * Retains the render failure as primary when rollback also fails.
 *
 * @param error - Original render failure.
 * @param rollbackErrors - Secondary rollback failures.
 * @returns Original error or ordered aggregate.
 */
function createTrackerRenderFailure(error: unknown, rollbackErrors: readonly unknown[]): unknown {
  return rollbackErrors.length === 0
    ? error
    : new AggregateError([error, ...rollbackErrors], 'Tracker render failed and rollback did not complete cleanly.');
}

/**
 * Returns current timestamp only when metrics are enabled.
 *
 * @param enabled - Whether metrics are enabled.
 * @param activeWindow - Window whose performance clock is used.
 * @returns Timestamp or null.
 */
function getMetricTimestamp(enabled: boolean, activeWindow: Window | null): number | null {
  if (!enabled || activeWindow === null || typeof activeWindow.performance?.now !== 'function') {
    return null;
  }

  return activeWindow.performance.now();
}

/**
 * Runs marker query, record rebuild, layout, clustering and marker DOM render.
 *
 * @param instance - Internal instance context.
 */
function renderTrackerInstanceMarkers(instance: TrackerInstance): TrackerMarkerRenderResult {
  const previousSelectedKey = instance.interactionController.getSelectedKey();
  const rules = instance.stagedRules ?? instance.ruleStore.getAll();
  const matches = instance.queryEngine.query(rules);
  const markerResult = instance.markerStore.rebuild(matches);
  const markerRecords = markerResult.records;
  const layoutRecords = instance.layoutEngine.measureMarkers(markerRecords, instance.options);

  instance.renderRecords = instance.clusterEngine.cluster(layoutRecords, instance.options);
  instance.renderRecordByKey = createRenderRecordMap(instance.renderRecords);
  const selectionTransition = instance.interactionController.synchronizeSelection(previousSelectedKey);
  const markerOptions = createTrackerMarkerDefaultsSnapshot(instance.options.marker);

  instance.renderer.renderMarkers(instance.renderRecords, instance.rendererOptions, markerOptions);
  synchronizeTrackerRenderedSelection(instance);

  return { markerOptions, selectionTransition };
}

/**
 * Reapplies global marker presentation without running the marker pipeline.
 *
 * @param instance - Internal instance context.
 * @returns Marker defaults retained for snapshot materialization.
 */
function renderTrackerInstanceMarkerPresentation(instance: TrackerInstance): TrackerMarkerDefaultsSnapshot | undefined {
  const markerOptions = createTrackerMarkerDefaultsSnapshot(instance.options.marker);

  instance.renderer.renderMarkerPresentation(instance.renderRecords, markerOptions);

  return markerOptions;
}

/**
 * Measures and renders the viewport indicator.
 *
 * @param instance - Internal instance context.
 * @returns Core-owned publication copy of the measured layout.
 */
function renderTrackerInstanceViewport(instance: TrackerInstance): TrackerViewportLayoutRecord {
  const viewportLayout = instance.layoutEngine.measureViewport(instance.options);
  const committedViewportLayout = {
    ...viewportLayout,
    source: { ...viewportLayout.source },
  };

  instance.renderer.renderViewport(viewportLayout, instance.rendererOptions);

  return committedViewportLayout;
}

/**
 * Runs the internal render pipeline for a target.
 *
 * Pipeline errors are caught and reported as a `render-error` warning so
 * direct callers (mount) get the same protection as scheduled renders. A
 * failed render emits a snapshot but no `sync:end` event: `sync:end`
 * means a completed render.
 *
 * @param instance - Internal instance context.
 * @param target - Internal render target.
 * @param reason - Render reason.
 * @param options - Internal error propagation options.
 */
function performTrackerInstanceRender(
  instance: TrackerInstance,
  target: TrackerRenderTarget,
  reason: TrackerRenderReason | undefined = undefined,
  options: RenderTrackerInstanceOptions = {},
): TrackerRenderPublication | null {
  if (instance.destroyed) {
    return null;
  }

  if (!instance.mounted || instance.renderer.root === null) {
    instance.diagnostics.recordRenderSkipped?.();
    emitTrackerInstanceSnapshot(instance);

    if (options.throwErrors === true) {
      throw new Error('Tracker render requires a mounted instance with an active renderer root.');
    }

    return null;
  }

  if (!isRenderTarget(target)) {
    instance.diagnostics.warn('invalid-render-target', `Invalid internal render target "${String(target)}".`, {
      target,
    });

    emitTrackerInstanceSnapshot(instance);
    return null;
  }

  let geometryResult: ReturnType<typeof revalidateTrackerGeometry>;
  let markerOptions: TrackerMarkerDefaultsSnapshot | undefined;
  let selectionTransition: TrackerSelectionTransition | null = null;
  let viewportLayout: TrackerViewportLayoutRecord | undefined;
  const rollbackState = captureTrackerRenderRollbackState(instance);

  beginTrackerRendererTransaction(instance.renderer);

  try {
    geometryResult = revalidateTrackerGeometry(instance, rollbackState.geometryMetadata);
    markerOptions = geometryResult.markerOptions;
  } catch (error) {
    const rollbackResult = rollbackTrackerRenderAttempt(instance, rollbackState);

    instance.dirtyRenderTarget = RENDER_TARGETS.ALL;
    instance.diagnostics.warn('render-error', 'Internal render failed.', {
      error: getErrorMessage(error),
      ...(rollbackResult.errors.length > 0 ? { rollbackErrors: rollbackResult.errors.map(getErrorMessage) } : {}),
    });

    if (options.stagePublication !== true) {
      instance.scheduler.notifyRenderSettled();
      emitTrackerInstanceSnapshot(instance, markerOptions);
    }

    if (options.throwErrors === true) {
      throw createTrackerRenderFailure(error, rollbackResult.errors);
    }

    return null;
  }

  if (geometryResult.state === 'suspended') {
    commitTrackerRendererTransaction(instance.renderer);
    instance.diagnostics.recordRenderSkipped?.();

    if (options.stagePublication !== true) {
      instance.scheduler.notifyRenderSettled();
      emitTrackerSelectionChangeEvent(instance, geometryResult.selectionTransition ?? null);
      emitTrackerInstanceSnapshot(instance, markerOptions);
    }

    return null;
  }

  // Detectable profile recovery resumes with one full query/layout/render pass.
  const renderTarget = geometryResult.state === 'resumed' ? RENDER_TARGETS.ALL : target;
  const activeWindow = instance.runtimeContext?.window ?? instance.stagedRuntimeContext?.window ?? null;
  const startedAt = getMetricTimestamp(instance.diagnostics.metricsEnabled, activeWindow);
  const startPayload: TrackerSyncStartEventPayload = {
    reason,
    scheduled: Boolean(reason?.scheduled),
    timestamp: startedAt,
  };

  instance.diagnostics.recordRenderStarted?.();

  if (options.stagePublication !== true) {
    instance.events.emit(EVENT_NAMES.SYNC_START, startPayload);
  }

  if (
    typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
    __RXT_TRACKER_DEBUG__ === true &&
    instance.diagnostics instanceof DebugDiagnostics
  ) {
    instance.diagnostics.trace('sync:start', {
      target: renderTarget,
      reason,
    });
  }

  try {
    if (renderTarget === RENDER_TARGETS.ALL) {
      instance.renderer.renderTrack(instance.rendererOptions);
      ({ markerOptions, selectionTransition } = renderTrackerInstanceMarkers(instance));
      viewportLayout = renderTrackerInstanceViewport(instance);
    } else if (renderTarget === RENDER_TARGETS.MARKERS) {
      ({ markerOptions, selectionTransition } = renderTrackerInstanceMarkers(instance));
      viewportLayout = renderTrackerInstanceViewport(instance);
    } else if (renderTarget === RENDER_TARGETS.MARKER_PRESENTATION) {
      markerOptions = renderTrackerInstanceMarkerPresentation(instance);
    } else if (renderTarget === RENDER_TARGETS.TRACK) {
      instance.renderer.renderTrack(instance.rendererOptions);
      viewportLayout = renderTrackerInstanceViewport(instance);
    } else if (renderTarget === RENDER_TARGETS.VIEWPORT) {
      viewportLayout = renderTrackerInstanceViewport(instance);
    }

    commitTrackerRendererTransaction(instance.renderer);
  } catch (error) {
    const rollbackResult = rollbackTrackerRenderAttempt(instance, rollbackState);

    instance.dirtyRenderTarget = RENDER_TARGETS.ALL;
    instance.diagnostics.warn('render-error', 'Internal render failed.', {
      error: getErrorMessage(error),
      ...(rollbackResult.errors.length > 0 ? { rollbackErrors: rollbackResult.errors.map(getErrorMessage) } : {}),
    });

    if (options.stagePublication !== true) {
      instance.scheduler.notifyRenderSettled();

      if (geometryResult.state === 'available') {
        emitTrackerSelectionChangeEvent(instance, rollbackResult.selectionTransition);
      }

      emitTrackerInstanceSnapshot(instance, markerOptions);
    }

    if (options.throwErrors === true) {
      throw createTrackerRenderFailure(error, rollbackResult.errors);
    }

    return null;
  }

  const endedAt = getMetricTimestamp(instance.diagnostics.metricsEnabled, activeWindow);
  const duration = startedAt !== null && endedAt !== null ? endedAt - startedAt : null;
  const clustersCount = instance.renderRecords.filter((record) => record.kind === 'cluster').length;
  const summary = {
    target: renderTarget,
    markersCount: instance.markerStore.size,
    clustersCount,
    duration,
    timestamp: endedAt,
  };

  instance.diagnostics.recordRenderCompleted?.(summary);

  const endPayload: TrackerSyncEndEventPayload = {
    markersCount: summary.markersCount,
    clustersCount: summary.clustersCount,
    duration,
    timestamp: endedAt,
  };

  const selectionChange = buildTrackerSelectionChangeEventPayload(selectionTransition);

  if (options.stagePublication !== true) {
    instance.scheduler.notifyRenderSettled();
    instance.events.emit(EVENT_NAMES.SYNC_END, endPayload);

    if (selectionChange !== null) {
      instance.events.emit(EVENT_NAMES.SELECTION_CHANGE, selectionChange);
    }
  }

  if (
    typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
    __RXT_TRACKER_DEBUG__ === true &&
    instance.diagnostics instanceof DebugDiagnostics
  ) {
    instance.diagnostics.trace('sync:end', summary);
  }

  if (options.stagePublication !== true) {
    emitTrackerInstanceSnapshot(instance, markerOptions, viewportLayout);
  }

  return {
    start: startPayload,
    end: endPayload,
    markerOptions,
    selectionChange,
    viewportLayout,
  };
}

/**
 * Publishes one successful render captured during provisional mount.
 *
 * @param instance - Committed internal instance.
 * @param publication - Captured render event payloads.
 */
function publishTrackerRenderPublication(instance: TrackerInstance, publication: TrackerRenderPublication): void {
  commitTrackerRendererTransaction(instance.renderer);
  const preparedSnapshot = instance.snapshotStore?.prepare(
    instance,
    publication.markerOptions,
    publication.viewportLayout,
  );

  instance.events.emit(EVENT_NAMES.SYNC_START, publication.start);
  instance.events.emit(EVENT_NAMES.SYNC_END, publication.end);

  if (publication.selectionChange !== null) {
    instance.events.emit(EVENT_NAMES.SELECTION_CHANGE, publication.selectionChange);
  }

  if (preparedSnapshot !== undefined && instance.snapshotStore?.hasSubscribers() === true) {
    instance.snapshotStore?.emitPrepared(
      preparedSnapshot,
      instance,
      publication.markerOptions,
      publication.viewportLayout,
    );
  } else {
    instance.snapshotStore?.refresh(instance, publication.markerOptions, publication.viewportLayout);
  }
}

/**
 * Requests or stores a render target according to mounted state and render
 * parameter.
 *
 * A null target means no re-render is required, but the snapshot is still
 * refreshed so option-only changes (interaction, updates, diagnostics) stay
 * visible to getSnapshot() and subscribers.
 *
 * @param instance - Internal instance context.
 * @param target - Render target.
 * @param render - Whether to schedule render immediately.
 * @param reason - Render reason.
 * @param publishPendingSnapshot - Whether to publish the pending scheduler state.
 */
function performTrackerInstanceRenderRequest(
  instance: TrackerInstance,
  target: TrackerRenderTarget | null,
  render: boolean,
  reason: TrackerRenderReason | undefined = undefined,
  publishPendingSnapshot = true,
): void {
  if (instance.destroyed) {
    return;
  }

  if (target === null) {
    emitTrackerInstanceSnapshot(instance);
    return;
  }

  if (!isRenderTarget(target)) {
    instance.diagnostics.warn('invalid-render-target', `Invalid internal render target "${String(target)}".`, {
      target,
    });

    emitTrackerInstanceSnapshot(instance);
    return;
  }

  const mergedTarget = mergeRenderTargets(instance.dirtyRenderTarget, target);

  if (!render || !instance.mounted) {
    instance.dirtyRenderTarget = mergedTarget;
    emitTrackerInstanceSnapshot(instance);
    return;
  }

  instance.dirtyRenderTarget = null;
  instance.scheduler.request(mergedTarget, reason);

  if (publishPendingSnapshot) {
    emitTrackerInstanceSnapshot(instance);
  }
}

/**
 * Requests and immediately flushes a full public render.
 *
 * @param instance - Internal instance context.
 * @param args - Unsupported public render arguments.
 */
function renderTrackerInstanceNow(instance: TrackerInstance, args: unknown[] = []): void {
  assertTrackerInstanceMounted(instance, 'render');

  if (args.length > 0) {
    throw new TypeError('Tracker.render() does not accept arguments.');
  }

  coordinateTrackerOperation(
    instance,
    'render',
    () => {
      assertTrackerInstanceMounted(instance, 'render');

      performTrackerInstanceRenderRequest(
        instance,
        RENDER_TARGETS.ALL,
        true,
        {
          source: 'public-render',
        },
        false,
      );
      flushTrackerInstanceRenderNow(instance);
    },
    { deferredResult: undefined },
  );
}

/**
 * Coordinates a low-level render operation exposed through the advanced API.
 *
 * @param instance - Internal Tracker instance.
 * @param target - Internal render target.
 * @param reason - Render reason.
 * @param options - Internal render options.
 * @returns Staged publication or null.
 */
function renderTrackerInstance(
  instance: TrackerInstance,
  target: TrackerRenderTarget,
  reason: TrackerRenderReason | undefined = undefined,
  options: RenderTrackerInstanceOptions = {},
): TrackerRenderPublication | null {
  return coordinateTrackerOperation(
    instance,
    'render',
    () => performTrackerInstanceRender(instance, target, reason, options),
    { deferredResult: null },
  );
}

/**
 * Coordinates a low-level render request exposed through the advanced API.
 *
 * @param instance - Internal Tracker instance.
 * @param target - Requested render target.
 * @param render - Whether to schedule immediately.
 * @param reason - Render reason.
 */
function requestTrackerInstanceRender(
  instance: TrackerInstance,
  target: TrackerRenderTarget | null = RENDER_TARGETS.ALL,
  render = true,
  reason: TrackerRenderReason | undefined = undefined,
): void {
  coordinateTrackerOperation(
    instance,
    'requestRender',
    () => performTrackerInstanceRenderRequest(instance, target, render, reason),
    { deferredResult: undefined },
  );
}

export {
  performTrackerInstanceRender,
  performTrackerInstanceRenderRequest,
  publishTrackerRenderPublication,
  renderTrackerInstance,
  renderTrackerInstanceNow,
  requestTrackerInstanceRender,
};
export type { RenderTrackerInstanceOptions, TrackerRenderPublication };
