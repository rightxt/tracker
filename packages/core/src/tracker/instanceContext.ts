import type { TrackerRenderReason, TrackerRenderTarget, TrackerSourceRoot } from '../types.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import type { TrackerLifecycleCallbacks } from './lifecycleCallbacks.js';
import {
  mergeTrackerLifecycleCallbacks,
  normalizeTrackerLifecycleCallbacks,
  resolveTrackerLifecycleCallbacks,
} from './lifecycleCallbacks.js';
import { getActiveTrackerRuntimeContext } from './mountContext.js';
import { coordinateTrackerOperation } from './operationCoordinator.js';
import { coordinateTrackerSelectionRequest } from './selection.js';

/**
 * Creates a scheduler proxy for observer-driven render requests.
 *
 * @param callbacks - Lifecycle callbacks.
 * @returns Scheduler proxy.
 */
function createSchedulerProxy(callbacks: Partial<TrackerLifecycleCallbacks> = {}): {
  request: (target: TrackerRenderTarget, reason?: TrackerRenderReason) => void;
} {
  const normalizedCallbacks = normalizeTrackerLifecycleCallbacks(callbacks);

  return {
    request: (target: TrackerRenderTarget, reason: TrackerRenderReason | undefined = undefined) => {
      normalizedCallbacks.requestRenderTarget(target, true, reason);
    },
  };
}

/**
 * Returns the actual Tracker output root for observation and interaction.
 *
 * @param renderer - Normalized renderer.
 * @returns Actual output root or null while unmounted.
 */
function getObservableTrackerRoot(renderer: TrackerInstance['renderer']): HTMLElement | null {
  return renderer.root;
}

/**
 * Resolves the authoritative source-query root without an ambient fallback.
 *
 * @param instance - Internal Tracker instance.
 * @returns Staged or committed source root.
 */
function getTrackerSourceRoot(instance: TrackerInstance): TrackerSourceRoot | null {
  return getActiveTrackerRuntimeContext(instance)?.sourceRoot ?? null;
}

/**
 * Synchronizes subsystem dependencies from staged or committed runtime context.
 *
 * @param instance - Internal instance context.
 * @param callbacks - Lifecycle callbacks.
 */
function syncTrackerInstanceContexts(
  instance: TrackerInstance,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  if (instance.destroyed) {
    return;
  }

  const normalizedCallbacks = resolveTrackerLifecycleCallbacks(instance, callbacks);
  const runtimeContext = getActiveTrackerRuntimeContext(instance);

  instance.ruleStore?.updateContext?.({
    diagnostics: instance.diagnostics,
    selectorRoot: runtimeContext?.sourceRoot ?? null,
  });

  instance.queryEngine?.updateContext?.({
    diagnostics: instance.diagnostics,
  });

  instance.markerStore?.updateContext?.({
    diagnostics: instance.diagnostics,
    sourceRoot: runtimeContext?.sourceRoot ?? null,
  });

  instance.layoutEngine?.updateContext?.({
    scrollContext: runtimeContext?.scrollContext ?? null,
  });

  instance.clusterEngine?.updateContext?.({
    diagnostics: instance.diagnostics,
  });

  instance.renderer.updateContext({
    diagnostics: instance.diagnostics,
    document: runtimeContext?.document ?? null,
    window: runtimeContext?.window ?? null,
    scrollMode: runtimeContext?.scrollMode ?? null,
  });

  instance.scheduler?.updateContext?.({
    diagnostics: instance.diagnostics,
    render: normalizedCallbacks.render,
    window: runtimeContext?.window ?? null,
  });

  instance.observerController?.updateContext?.({
    scheduler: createSchedulerProxy(normalizedCallbacks),
    diagnostics: instance.diagnostics,
    getRoot: () => getObservableTrackerRoot(instance.renderer),
    getRuntimeContext: () => getActiveTrackerRuntimeContext(instance),
  });

  instance.interactionController?.updateContext?.({
    events: instance.events,
    diagnostics: instance.diagnostics,
    scrollContext: runtimeContext?.scrollContext ?? null,
    getRenderRecordByKey: normalizedCallbacks.getRenderRecordByKey,
    getRenderRecords: normalizedCallbacks.getRenderRecords,
    getFallbackRoot: () => instance.renderer.root,
    getGeometryAvailable: () => instance.mounted && !instance.geometrySuspended,
    canHandleKeyboardEvent: () => instance.lifecycleState === 'mounted',
    onSelectionRequest: (request) => coordinateTrackerSelectionRequest(instance, request),
    coordinateActivation: (run, deferredResult) =>
      coordinateTrackerOperation(instance, 'interaction', run, { deferredResult }),
  });
}

/**
 * Applies a lifecycle callback merge and, on failure, rolls it back.
 *
 * @param instance - Internal Tracker instance.
 * @param callbacks - Lifecycle callbacks.
 */
function performUpdateTrackerInstanceLifecycleCallbacks(
  instance: TrackerInstance,
  callbacks: Partial<TrackerLifecycleCallbacks>,
): void {
  const previousCallbacks = instance.lifecycleCallbacks;

  try {
    instance.lifecycleCallbacks = mergeTrackerLifecycleCallbacks(instance.lifecycleCallbacks, callbacks);
    syncTrackerInstanceContexts(instance);
  } catch (error) {
    const errors: unknown[] = [error];

    instance.lifecycleCallbacks = previousCallbacks;

    try {
      syncTrackerInstanceContexts(instance);
    } catch (rollbackError) {
      errors.push(rollbackError);
    }

    if (errors.length === 1) {
      throw error;
    }

    throw new AggregateError(errors, 'Tracker lifecycle callback update and context rollback both failed.');
  }
}

/**
 * Patches lifecycle callbacks stored in an internal Tracker instance.
 *
 * Deferred instead of applied immediately when called reentrantly during
 * another core operation or a lifecycle transition, so it cannot mutate
 * callbacks mid-mount/unmount/destroy.
 *
 * @param instance - Internal Tracker instance.
 * @param callbacks - Lifecycle callbacks.
 */
function updateTrackerInstanceLifecycleCallbacks(
  instance: TrackerInstance,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  if (instance.destroyed) {
    return;
  }

  coordinateTrackerOperation(
    instance,
    'updateLifecycleCallbacks',
    () => performUpdateTrackerInstanceLifecycleCallbacks(instance, callbacks),
    { deferredResult: undefined },
  );
}

export {
  createSchedulerProxy,
  getActiveTrackerRuntimeContext,
  getObservableTrackerRoot,
  getTrackerSourceRoot,
  syncTrackerInstanceContexts,
  updateTrackerInstanceLifecycleCallbacks,
};
