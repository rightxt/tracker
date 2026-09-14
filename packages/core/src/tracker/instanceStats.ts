import type { TrackerStats } from '../types.js';
import { createRetainedDiagnosticStats } from '../utils/diagnostic.js';
import { cloneValue } from '../utils/object.js';
import type { TrackerInstance } from './createTrackerInstance.js';

/**
 * Returns a diagnostics stats snapshot, including retained terminal stats.
 *
 * @param instance - Internal instance context.
 * @returns Stats snapshot.
 */
function getTrackerInstanceStats(instance: TrackerInstance): TrackerStats {
  if (instance.destroyed && instance.finalStats !== null) {
    return cloneValue(instance.finalStats);
  }

  return instance.diagnostics.getStats();
}

/**
 * Recaptures the retained terminal stats snapshot from live diagnostics.
 *
 * Diagnostics recorded after the instance was destroyed (for example, a
 * handler's rejection surfacing on a later microtask) still accumulate in
 * `instance.diagnostics`, but {@link getTrackerInstanceStats} only exposes
 * the frozen `finalStats` snapshot once destroyed. Callers reporting such
 * late diagnostics must call this afterward so the public stats stay current.
 * A no-op before the instance is destroyed.
 *
 * @param instance - Internal instance context.
 */
function refreshTrackerInstanceFinalStats(instance: TrackerInstance): void {
  if (!instance.destroyed) {
    return;
  }

  instance.finalStats = createRetainedDiagnosticStats(instance.diagnostics.getStats());
}

export { getTrackerInstanceStats, refreshTrackerInstanceFinalStats };
