import type { TrackerClusterActivateEventPayload, TrackerSyncStartEventPayload } from '@rightxt/tracker-core';
import { TrackerElement } from '@rightxt/tracker-element';
import Tracker, { type TrackerVanillaMountRequest } from '@rightxt/tracker-vanilla';

/** Explicit Vanilla mount request for Window mode. */
const vanillaMountRequest: TrackerVanillaMountRequest = {
  renderHost: document.body,
  scrollRoot: window,
  sourceRoot: document,
};

/** Vanilla runtime using the final request-based mount contract. */
const tracker = new Tracker();

tracker.mount(vanillaMountRequest);
void tracker.whenDestroyed();

/** Public semantic payload containers are compile-time read-only. */
function assertReadonlyEventPayloads(
  syncStart: TrackerSyncStartEventPayload,
  clusterActivate: TrackerClusterActivateEventPayload,
): void {
  // @ts-expect-error Published payload fields are read-only.
  syncStart.scheduled = false;

  if (syncStart.reason !== null && syncStart.reason !== undefined) {
    // @ts-expect-error Nested render-reason fields are read-only.
    syncStart.reason.source = 'consumer-mutation';
    // @ts-expect-error Nested render-reason arrays are read-only.
    syncStart.reason.reasons?.push({ source: 'consumer-mutation' });
  }

  // @ts-expect-error Cluster marker arrays are read-only.
  clusterActivate.markers.push(clusterActivate.markers[0]!);
  // @ts-expect-error Nested marker DTO fields are read-only.
  clusterActivate.markers[0]!.label = 'consumer-mutation';
  // @ts-expect-error Borrowed platform-object fields cannot be reassigned.
  clusterActivate.sourceEvent = null;
}

void assertReadonlyEventPayloads;

/** Custom Element exposing adapter-only nullable DOM-reference properties. */
const trackerElement = new TrackerElement();

trackerElement.sourceRoot = document;
trackerElement.scrollRoot = window;
trackerElement.sourceRoot = null;
trackerElement.scrollRoot = null;
trackerElement.sourceRoot = undefined;
trackerElement.scrollRoot = undefined;

/** Vanilla core request rejects adapter-style null roots. */
const invalidVanillaMountRequest: TrackerVanillaMountRequest = {
  // @ts-expect-error Vanilla requests are non-nullable at the mount boundary.
  sourceRoot: null,
};

/**
 * TrackerElement narrows CustomEvent.detail per canonical event name through
 * typed addEventListener() overloads, and exposes no on()/off() subscription
 * methods; standard EventTarget methods are the only public event API.
 */
function assertElementEventContract(element: TrackerElement): void {
  element.addEventListener('cluster:activate', (event) => void event.detail.count);
  element.addEventListener('marker:activate', (event) => {
    const selector: string = event.detail.selector;

    void selector;
  });
  element.addEventListener('selection:change', (event) => void event.detail.selectedKey);
  element.addEventListener('sync:end', (event) => void event.detail.markersCount);

  element.addEventListener('sync:start', (event) => {
    // @ts-expect-error sync:start detail has no selector field.
    event.detail.selector;
  });
  element.addEventListener('track:activate', (event) => void event.detail.position);
  element.addEventListener('warning', (event) => void event.detail.code);
  element.addEventListener('destroy', (event) => void event.detail);

  // @ts-expect-error on() is not part of the TrackerElement public surface.
  element.on;
  // @ts-expect-error off() is not part of the TrackerElement public surface.
  element.off;
}

void assertElementEventContract;

/** Vanilla constructor options reject an own undefined field under exactOptionalPropertyTypes. */
new Tracker({
  // @ts-expect-error Own `undefined` is rejected under exactOptionalPropertyTypes.
  options: {
    orientation: undefined,
  },
});

/** TrackerElement's replaceRules() rejects an own undefined rule field under exactOptionalPropertyTypes. */
trackerElement.replaceRules([
  // @ts-expect-error Own `undefined` is rejected under exactOptionalPropertyTypes.
  {
    label: undefined,
    selector: '.target',
  },
]);

void invalidVanillaMountRequest;
