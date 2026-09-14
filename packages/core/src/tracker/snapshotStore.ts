import type {
  TrackerMarkerDefaultsSnapshot,
  TrackerSnapshot,
  TrackerSnapshotListener,
  TrackerSnapshotStore,
  TrackerSnapshotUnsubscribe,
  TrackerViewportLayoutRecord,
} from '../types.js';
import { TrackerLifecycleError } from '../errors.js';
import { noop } from '../utils/function.js';
import { reportHostError } from '../utils/reportHostError.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { assertTrackerInstanceAlive } from './lifecycleGuards.js';
import { runTrackerPublicDispatch } from './operationCoordinator.js';
import { createTrackerInstanceSnapshot } from './snapshot.js';

/** Maximum snapshot publications delivered in one synchronous batch. */
const MAX_SNAPSHOT_EMISSIONS_PER_BATCH = 1000;

interface PendingSnapshotEmission {
  /** Immutable snapshot captured when emit() was called. */
  snapshot: TrackerSnapshot;
}

/** Snapshot materializer injected by focused store tests. */
type TrackerSnapshotFactory = (
  instance: TrackerInstance,
  markerOptions?: TrackerMarkerDefaultsSnapshot,
  committedViewportLayout?: TrackerViewportLayoutRecord,
) => TrackerSnapshot;

/** One unique snapshot listener with independently owned registrations. */
interface SnapshotSubscriptionEntry {
  /** Whether this entry remains current. */
  active: boolean;
  /** Registered listener. */
  listener: TrackerSnapshotListener;
  /** Active owner count. */
  owners: number;
}

/**
 * Creates a snapshot store for a Tracker instance.
 *
 * @param instance - Internal instance context.
 * @param createSnapshot - Snapshot materializer.
 * @returns Snapshot store.
 */
function createTrackerSnapshotStore(
  instance: TrackerInstance,
  createSnapshot: TrackerSnapshotFactory = createTrackerInstanceSnapshot,
): TrackerSnapshotStore {
  const listeners = new Map<TrackerSnapshotListener, SnapshotSubscriptionEntry>();
  const pendingEmissions: PendingSnapshotEmission[] = [];
  let emitting = false;
  let revision = 0;
  let materializedRevision = -1;
  let snapshot: TrackerSnapshot | null = null;
  let currentInstance = instance;
  let currentMarkerOptions: TrackerMarkerDefaultsSnapshot | undefined;
  let currentCommittedViewportLayout: TrackerViewportLayoutRecord | undefined;

  /** Records a new observable state without constructing its immutable graph. */
  const advanceRevision = (
    nextInstance: TrackerInstance,
    markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
    committedViewportLayout: TrackerViewportLayoutRecord | undefined,
  ): void => {
    revision += 1;
    currentInstance = nextInstance;
    currentMarkerOptions = markerOptions;

    if (committedViewportLayout !== undefined) {
      currentCommittedViewportLayout = committedViewportLayout;
    }
  };

  /** Materializes and caches the latest observable revision on demand. */
  const materializeCurrentSnapshot = (): TrackerSnapshot => {
    if (snapshot === null || materializedRevision !== revision) {
      snapshot = createSnapshot(currentInstance, currentMarkerOptions, currentCommittedViewportLayout);
      materializedRevision = revision;
    }

    return snapshot;
  };

  /** Enqueues and synchronously drains one already materialized snapshot. */
  const deliverSnapshot = (emittedSnapshot: TrackerSnapshot): void => {
    pendingEmissions.push({ snapshot: emittedSnapshot });

    if (emitting) {
      return;
    }

    emitting = true;

    try {
      runTrackerPublicDispatch(instance, () => {
        let processedEmissions = 0;

        while (pendingEmissions.length > 0) {
          if (processedEmissions >= MAX_SNAPSHOT_EMISSIONS_PER_BATCH) {
            const droppedEmissions = pendingEmissions.length;

            instance.diagnostics.error(
              'ERR_TRACKER_REENTRANCY_LIMIT',
              'Tracker stopped a non-terminating snapshot publication feedback loop.',
              {
                droppedEmissions,
                processedEmissions,
              },
            );
            throw new TrackerLifecycleError('Tracker stopped a non-terminating snapshot publication feedback loop.', {
              code: 'ERR_TRACKER_REENTRANCY_LIMIT',
            });
          }

          const emission = pendingEmissions.shift()!;

          processedEmissions += 1;
          [...listeners.values()].forEach(({ listener }) => {
            try {
              listener(emission.snapshot);
            } catch (error) {
              reportHostError(error);
            }
          });
        }

        // Deferred public operations drain when this dispatch boundary exits.
        // Mark the current batch complete first so snapshots emitted by those
        // operations start a new deliverable batch instead of being discarded.
        emitting = false;
      });
    } finally {
      pendingEmissions.length = 0;
      emitting = false;
    }
  };

  return {
    clear() {
      listeners.clear();
    },

    emit(
      nextInstance: TrackerInstance = instance,
      markerOptions?: TrackerMarkerDefaultsSnapshot,
      committedViewportLayout?: TrackerViewportLayoutRecord,
    ) {
      advanceRevision(nextInstance, markerOptions, committedViewportLayout);

      if (listeners.size === 0) {
        return;
      }

      const emittedSnapshot = materializeCurrentSnapshot();

      deliverSnapshot(emittedSnapshot);
    },

    emitPrepared(
      preparedSnapshot: TrackerSnapshot,
      nextInstance: TrackerInstance = instance,
      markerOptions?: TrackerMarkerDefaultsSnapshot,
      committedViewportLayout?: TrackerViewportLayoutRecord,
    ) {
      advanceRevision(nextInstance, markerOptions, committedViewportLayout);
      snapshot = preparedSnapshot;
      materializedRevision = revision;

      if (listeners.size === 0) {
        return;
      }

      deliverSnapshot(preparedSnapshot);
    },

    getSnapshot() {
      return materializeCurrentSnapshot();
    },

    hasSubscribers() {
      return listeners.size > 0;
    },

    prepare(
      nextInstance: TrackerInstance = instance,
      markerOptions?: TrackerMarkerDefaultsSnapshot,
      committedViewportLayout?: TrackerViewportLayoutRecord,
    ) {
      return createSnapshot(nextInstance, markerOptions, committedViewportLayout);
    },

    refresh(
      nextInstance: TrackerInstance = instance,
      markerOptions?: TrackerMarkerDefaultsSnapshot,
      committedViewportLayout?: TrackerViewportLayoutRecord,
    ) {
      advanceRevision(nextInstance, markerOptions, committedViewportLayout);
    },

    subscribe(listener: TrackerSnapshotListener): TrackerSnapshotUnsubscribe {
      if (typeof listener !== 'function') {
        return noop;
      }

      let entry = listeners.get(listener);

      if (!entry) {
        entry = { active: true, listener, owners: 0 };
        listeners.set(listener, entry);
      }

      entry.owners += 1;
      const ownedEntry = entry;
      let ownerActive = true;

      return () => {
        if (!ownerActive) {
          return;
        }

        ownerActive = false;

        if (!ownedEntry.active || listeners.get(listener) !== ownedEntry) {
          return;
        }

        ownedEntry.owners -= 1;

        if (ownedEntry.owners === 0) {
          ownedEntry.active = false;
          listeners.delete(listener);
        }
      };
    },
  };
}

/**
 * Emits a snapshot update when the instance has a snapshot store.
 *
 * @param instance - Internal instance context.
 * @param markerOptions - Marker defaults retained by the publishing revision.
 * @param committedViewportLayout - Core-owned viewport committed by the publishing render.
 */
function emitTrackerInstanceSnapshot(
  instance: TrackerInstance,
  markerOptions?: TrackerMarkerDefaultsSnapshot,
  committedViewportLayout?: TrackerViewportLayoutRecord,
): void {
  instance.snapshotStore?.emit?.(instance, markerOptions, committedViewportLayout);
}

/**
 * Returns the current snapshot for an instance.
 *
 * @param instance - Internal instance context.
 * @returns Current snapshot.
 */
function getTrackerInstanceSnapshot(instance: TrackerInstance): TrackerSnapshot {
  if (!instance.snapshotStore) {
    return createTrackerInstanceSnapshot(instance);
  }

  return instance.snapshotStore.getSnapshot();
}

/**
 * Subscribes to snapshot updates.
 *
 * Repeating the same listener identity shares one delivery entry while each
 * returned unsubscribe independently owns and releases one registration.
 *
 * @param instance - Internal instance context.
 * @param listener - Snapshot listener.
 * @returns Unsubscribe function.
 */
function subscribeTrackerInstanceSnapshot(
  instance: TrackerInstance,
  listener: TrackerSnapshotListener,
): TrackerSnapshotUnsubscribe {
  assertTrackerInstanceAlive(instance, 'subscribe to snapshots');

  if (!instance.snapshotStore) {
    return noop;
  }

  return instance.snapshotStore.subscribe(listener);
}

export {
  MAX_SNAPSHOT_EMISSIONS_PER_BATCH,
  createTrackerSnapshotStore,
  emitTrackerInstanceSnapshot,
  getTrackerInstanceSnapshot,
  subscribeTrackerInstanceSnapshot,
};
