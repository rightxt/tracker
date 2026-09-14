import { TrackerLifecycleError } from '../errors.js';

import type { TrackerInstance } from './createTrackerInstance.js';

/** Throws when a terminal Tracker is used by a mutating public operation. */
function assertTrackerInstanceAlive(instance: TrackerInstance, operation: string): void {
  if (instance.destroyed) {
    throw new TrackerLifecycleError(`Cannot ${operation} after Tracker.destroy().`, {
      code: 'ERR_TRACKER_DESTROYED',
    });
  }
}

/** Throws unless a public render operation has an active mount. */
function assertTrackerInstanceMounted(instance: TrackerInstance, operation: string): void {
  assertTrackerInstanceAlive(instance, operation);

  if (!instance.mounted) {
    throw new TrackerLifecycleError(`Cannot ${operation} before Tracker.mount().`, {
      code: 'ERR_TRACKER_INVALID_CONTEXT',
    });
  }
}

export { assertTrackerInstanceAlive, assertTrackerInstanceMounted };
