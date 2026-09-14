import type {
  TrackerClusterRenderRecord,
  TrackerMarkerRecord,
  TrackerMarkerRenderRecord,
  TrackerRenderRecord,
} from '../types.js';

/**
 * Returns whether a render record represents a cluster.
 *
 * @param record - Render record candidate.
 * @returns True when record is a cluster.
 */
function isClusterRenderRecord(record: TrackerRenderRecord | null | undefined): record is TrackerClusterRenderRecord {
  return record != null && record.kind === 'cluster';
}

/**
 * Returns whether a render record represents a single marker.
 *
 * @param record - Render record candidate.
 * @returns True when record is a marker.
 */
function isMarkerRenderRecord(record: TrackerRenderRecord | null | undefined): record is TrackerMarkerRenderRecord {
  return record != null && record.kind === 'marker';
}

/**
 * Returns the primary marker data for a marker or cluster render record.
 *
 * @param renderRecord - Render record candidate.
 * @returns Primary marker record or null.
 */
function getPrimaryMarkerRecord(renderRecord: TrackerRenderRecord | null | undefined): TrackerMarkerRecord | null {
  if (isClusterRenderRecord(renderRecord)) {
    return renderRecord.primaryMarker ?? null;
  }

  if (isMarkerRenderRecord(renderRecord)) {
    return renderRecord.marker ?? null;
  }

  return null;
}

export { getPrimaryMarkerRecord, isClusterRenderRecord, isMarkerRenderRecord };
