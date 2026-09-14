import type { TrackerInstance } from './createTrackerInstance.js';
import { emitTrackerInstanceSnapshot } from './snapshotStore.js';

/**
 * Activates a rendered marker or cluster by snapshot/render key.
 *
 * Framework renderers can call this from their own event bindings instead of
 * relying on delegated DOM listeners.
 *
 * @param instance - Internal instance context.
 * @param key - Marker or cluster render key.
 * @param sourceEvent - Source event.
 * @returns True when a render record was activated.
 */
function activateTrackerInstanceRenderRecord(
  instance: TrackerInstance,
  key: string,
  sourceEvent: Event | null = null,
): boolean {
  if (instance.destroyed) {
    return false;
  }

  const diagnosticsRevision = instance.diagnostics.revision;
  const activated = instance.interactionController.activateRenderRecordByKey(key, sourceEvent);

  if (!activated || instance.diagnostics.revision !== diagnosticsRevision) {
    emitTrackerInstanceSnapshot(instance);
  }

  return activated;
}

export { activateTrackerInstanceRenderRecord };
