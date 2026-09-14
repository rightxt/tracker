import { EVENT_NAMES } from './eventNames.js';

import type {
  TrackerClusterActivateEventPayload,
  TrackerEventMarker,
  TrackerEventName,
  TrackerEventPayloadMap,
  TrackerRenderReason,
} from '../types.js';

/** Freezes one Core-owned marker DTO without traversing its borrowed Element. */
function freezeEventMarker(marker: TrackerEventMarker): void {
  Object.freeze(marker);
}

/** Freezes one Core-owned render reason tree. */
function freezeRenderReason(reason: TrackerRenderReason | null | undefined): void {
  if (reason === null || reason === undefined || Object.isFrozen(reason)) {
    return;
  }

  reason.reasons?.forEach(freezeRenderReason);

  if (reason.reasons !== undefined) {
    Object.freeze(reason.reasons);
  }

  Object.freeze(reason);
}

/** Freezes the Core-owned containers in a cluster activation payload. */
function freezeClusterPayload(payload: TrackerClusterActivateEventPayload): void {
  payload.markers.forEach(freezeEventMarker);

  if (payload.primaryMarker !== null) {
    freezeEventMarker(payload.primaryMarker);
  }

  Object.freeze(payload.markers);
}

/**
 * Applies the public immutability contract to one semantic event payload.
 *
 * Platform objects and arbitrary diagnostic details are deliberately left
 * untouched; only containers created and owned by Tracker are frozen.
 *
 * @param eventName - Canonical semantic event name.
 * @param payload - Payload created by Core.
 * @returns The same payload identity after selective freezing.
 */
function freezeTrackerEventPayload<TEventName extends TrackerEventName>(
  eventName: TEventName,
  payload: TrackerEventPayloadMap[TEventName],
): TrackerEventPayloadMap[TEventName] {
  if (eventName === EVENT_NAMES.CLUSTER_ACTIVATE) {
    freezeClusterPayload(payload as TrackerClusterActivateEventPayload);
  } else if (eventName === EVENT_NAMES.SYNC_START) {
    freezeRenderReason((payload as TrackerEventPayloadMap[typeof EVENT_NAMES.SYNC_START]).reason);
  }

  Object.freeze(payload);

  return payload;
}

export { freezeTrackerEventPayload };
