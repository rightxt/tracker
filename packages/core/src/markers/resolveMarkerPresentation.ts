import { isNormalizedMarkerAttributes } from '../config/markerAttributes.js';
import type {
  TrackerMarkerDefaultsSnapshot,
  TrackerRenderRecord,
  TrackerResolvedMarkerPresentation,
} from '../types.js';
import { normalizeUserClassName } from '../utils/className.js';
import { isPlainObject } from '../utils/object.js';
import { getPrimaryMarkerRecord } from '../tracker/renderRecords.js';

/**
 * Copies string-valued entries from a plain object.
 *
 * @param value - Map candidate.
 * @returns Detached string map.
 */
function copyStringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((result, [name, entry]) => {
    if (typeof entry === 'string') {
      result[name] = entry;
    }

    return result;
  }, {});
}

/**
 * Resolves complete application-owned presentation for one rendered item.
 *
 * @param markerOptions - Normalized global marker defaults.
 * @param renderRecord - Marker or cluster render record.
 * @returns Detached resolved presentation.
 */
function resolveMarkerPresentation(
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  renderRecord: TrackerRenderRecord,
): TrackerResolvedMarkerPresentation {
  const marker = getPrimaryMarkerRecord(renderRecord);
  const ruleMarker = marker?.rule?.marker;
  const attributes = copyStringMap(markerOptions?.attributes);
  const ruleAttributes = ruleMarker?.attributes;

  if (isNormalizedMarkerAttributes(ruleAttributes)) {
    Object.assign(attributes, copyStringMap(ruleAttributes.values));
    ruleAttributes.removals.forEach((name) => {
      delete attributes[name];
    });
  }

  const globalClassName = typeof markerOptions?.className === 'string' ? markerOptions.className : '';
  const ruleClassName = typeof ruleMarker?.className === 'string' ? ruleMarker.className : '';
  const titleEnabled =
    typeof ruleMarker?.title === 'boolean'
      ? ruleMarker.title
      : typeof markerOptions?.title === 'boolean'
        ? markerOptions.title
        : true;
  const label = marker?.label;

  return {
    attributes,
    className: normalizeUserClassName(`${globalClassName} ${ruleClassName}`),
    cssVariables: copyStringMap(ruleMarker?.cssVariables),
    title: titleEnabled && typeof label === 'string' && label !== '' ? label : null,
  };
}

export { resolveMarkerPresentation };
