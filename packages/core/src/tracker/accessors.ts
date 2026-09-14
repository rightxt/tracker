import type {
  TrackerDebugTraceEntry,
  TrackerReadonlyOptions,
  TrackerReadonlyRule,
  TrackerRenderRecord,
} from '../types.js';
import { cloneValue, deepFreeze } from '../utils/object.js';
import { DebugDiagnostics } from '../diagnostics/DebugDiagnostics.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { assertTrackerInstanceAlive } from './lifecycleGuards.js';
import { getTrackerInstanceStats } from './instanceStats.js';
import { coordinateTrackerOperation } from './operationCoordinator.js';
import { emitTrackerInstanceSnapshot } from './snapshotStore.js';

declare const __RXT_TRACKER_DEBUG__: boolean | undefined;

/**
 * Returns a render record by DOM key.
 *
 * @param instance - Internal instance context.
 * @param key - Render record key.
 * @returns Render record or null.
 */
function getTrackerInstanceRenderRecordByKey(instance: TrackerInstance, key: string): TrackerRenderRecord | null {
  return instance.renderRecordByKey.get(key) || null;
}

/**
 * Returns the current render record list.
 *
 * @param instance - Internal instance context.
 * @returns Render records copy.
 */
function getTrackerInstanceRenderRecords(instance: TrackerInstance): readonly TrackerRenderRecord[] {
  return [...instance.renderRecords];
}

/**
 * Returns public rule copies in priority order.
 *
 * @param instance - Internal instance context.
 * @returns Public rules.
 * @throws TrackerLifecycleError with code `ERR_TRACKER_DESTROYED` after `destroy()`.
 */
function getTrackerInstanceRules(instance: TrackerInstance): readonly TrackerReadonlyRule[] {
  assertTrackerInstanceAlive(instance, 'read rules');

  return deepFreeze(cloneValue(instance.ruleStore.getPublicRules())) as readonly TrackerReadonlyRule[];
}

/**
 * Returns the complete committed normalized options view.
 *
 * @param instance - Internal instance context.
 * @returns Immutable committed options.
 * @throws TrackerLifecycleError with code `ERR_TRACKER_DESTROYED` after `destroy()`.
 */
function getTrackerInstanceOptions(instance: TrackerInstance): TrackerReadonlyOptions {
  assertTrackerInstanceAlive(instance, 'read options');

  return instance.rendererOptions;
}

/**
 * Returns the rendered root element.
 *
 * @param instance - Internal instance context.
 * @returns Root element.
 */
function getTrackerInstanceRoot(instance: TrackerInstance): HTMLElement | null {
  return instance.renderer.root;
}

/**
 * Indicates whether an instance has been destroyed.
 *
 * @param instance - Internal instance context.
 * @returns True when destroyed.
 */
function isTrackerInstanceDestroyed(instance: TrackerInstance): boolean {
  return instance.destroyed;
}

/**
 * Indicates whether an instance is mounted.
 *
 * Reads `lifecycleState` rather than the internal `mounted` renderability
 * gate. `mounted` is set before the initial render runs, because
 * `performTrackerInstanceRender` itself requires it to execute; a synchronous
 * caller callback invoked from within that render (for example a rule
 * `label` resolver) would otherwise observe a premature "mounted" status
 * before the mount transaction actually commits. `lifecycleState` only
 * becomes `'mounted'` after the initial render, rule revalidation, and
 * runtime context are fully committed.
 *
 * @param instance - Internal instance context.
 * @returns True when mounted.
 */
function isTrackerInstanceMounted(instance: TrackerInstance): boolean {
  return instance.lifecycleState === 'mounted';
}

/**
 * Returns a snapshot of recent debug-build execution trace entries.
 *
 * Debug traces only exist in debug builds; production builds statically fold this
 * to a no-op that always returns null, so calling it has no cost in production.
 *
 * @param instance - Internal instance context.
 * @returns Trace snapshot, or null outside a debug build.
 */
function getTrackerInstanceDebugTrace(instance: TrackerInstance): TrackerDebugTraceEntry[] | null {
  if (
    typeof __RXT_TRACKER_DEBUG__ !== 'undefined' &&
    __RXT_TRACKER_DEBUG__ === true &&
    instance.diagnostics instanceof DebugDiagnostics
  ) {
    return instance.diagnostics.getTrace();
  }

  return null;
}

/**
 * Resets diagnostics counters and metrics.
 *
 * @param instance - Internal instance context.
 */
function resetTrackerInstanceStats(instance: TrackerInstance): void {
  assertTrackerInstanceAlive(instance, 'reset diagnostics');
  coordinateTrackerOperation(
    instance,
    'resetStats',
    () => {
      assertTrackerInstanceAlive(instance, 'reset diagnostics');
      instance.diagnostics.resetStats();
      emitTrackerInstanceSnapshot(instance);
    },
    { deferredResult: undefined },
  );
}

export {
  getTrackerInstanceDebugTrace,
  getTrackerInstanceOptions,
  getTrackerInstanceRenderRecordByKey,
  getTrackerInstanceRenderRecords,
  getTrackerInstanceRoot,
  getTrackerInstanceRules,
  getTrackerInstanceStats,
  isTrackerInstanceDestroyed,
  isTrackerInstanceMounted,
  resetTrackerInstanceStats,
};
