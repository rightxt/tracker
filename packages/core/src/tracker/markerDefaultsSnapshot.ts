import type { TrackerMarkerDefaults, TrackerMarkerDefaultsSnapshot } from '../types.js';
import { isPlainObject } from '../utils/object.js';

/**
 * Freezes the small marker-defaults graph passed to renderer hooks.
 *
 * @param value - Marker defaults snapshot.
 * @returns Frozen marker defaults snapshot.
 */
function freezeMarkerDefaultsSnapshot(value: TrackerMarkerDefaultsSnapshot): TrackerMarkerDefaultsSnapshot {
  if (value.attributes !== undefined) {
    Object.freeze(value.attributes);
  }

  return Object.freeze(value);
}

/**
 * Materializes normalized global marker defaults for one operation.
 *
 * @param marker - Committed marker defaults.
 * @returns Detached frozen renderer-facing defaults.
 */
function createTrackerMarkerDefaultsSnapshot(
  marker: TrackerMarkerDefaults | undefined,
): TrackerMarkerDefaultsSnapshot | undefined {
  if (!isPlainObject(marker)) {
    return undefined;
  }

  const attributes = isPlainObject(marker.attributes)
    ? Object.entries(marker.attributes).reduce<Record<string, string>>((result, [name, value]) => {
        if (typeof value === 'string') {
          result[name] = value;
        }

        return result;
      }, {})
    : undefined;
  const snapshot: {
    attributes?: Readonly<Record<string, string>>;
    className?: string;
    title?: boolean;
  } = {};

  if (attributes !== undefined) {
    snapshot.attributes = attributes;
  }

  if (typeof marker.className === 'string') {
    snapshot.className = marker.className;
  }

  if (typeof marker.title === 'boolean') {
    snapshot.title = marker.title;
  }

  return freezeMarkerDefaultsSnapshot(snapshot);
}

export { createTrackerMarkerDefaultsSnapshot };
