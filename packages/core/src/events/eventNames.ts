import type { TrackerEventName, TrackerEventNameConstants } from '../types.js';

/** Public Tracker event names. */
const EVENT_NAMES: TrackerEventNameConstants = Object.freeze({
  MARKER_ACTIVATE: 'marker:activate',
  CLUSTER_ACTIVATE: 'cluster:activate',
  TRACK_ACTIVATE: 'track:activate',
  SELECTION_CHANGE: 'selection:change',
  SYNC_START: 'sync:start',
  SYNC_END: 'sync:end',
  WARNING: 'warning',
  DESTROY: 'destroy',
});

/** Public Tracker event name values. */
const EVENT_NAME_VALUES: ReadonlyArray<TrackerEventName> = Object.freeze(
  Object.values(EVENT_NAMES) as TrackerEventName[],
);

export { EVENT_NAMES, EVENT_NAME_VALUES };
