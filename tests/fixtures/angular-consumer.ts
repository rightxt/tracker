import { Component } from '@angular/core';

import { TrackerComponent } from '@rightxt/tracker-angular';
import '@rightxt/tracker-angular/style.css';

import type { TrackerMarkerActivateEventPayload, TrackerRule } from '@rightxt/tracker-core';

@Component({
  selector: 'test-app',
  standalone: true,
  imports: [TrackerComponent],
  template: `
    <rxt-tracker-angular
      [options]="options"
      [rules]="rules"
      [sourceRoot]="sourceRoot"
      [scrollRoot]="scrollRoot"
      (clusterActivate)="handleClusterActivate()"
      (markerActivate)="handleMarkerActivate($event)"
      (selectionChange)="handleSelectionChange()"
      (syncStart)="handleSyncStart()"
      (syncEnd)="handleSyncEnd()"
      (trackActivate)="handleTrackActivate()"
      (warning)="handleWarning()"
    />
  `,
})
class AngularConsumerComponent {
  /** Immutable tracker options. */
  readonly options = { placement: 'right' } as const;

  /** Immutable tracker rules. */
  readonly rules: readonly TrackerRule[] = [{ selector: '.error' }];

  /** Adapter-only nullable source root. */
  readonly sourceRoot: Document | null = null;

  /** Adapter-only nullable represented viewport. */
  readonly scrollRoot: Window | null = null;

  /** Receives typed marker activation output. */
  handleMarkerActivate(payload: TrackerMarkerActivateEventPayload): string {
    return payload.selector;
  }

  /** Receives the cluster-activation output. */
  handleClusterActivate(): void {}

  /** Receives the selection-change output. */
  handleSelectionChange(): void {}

  /** Receives the sync-start output. */
  handleSyncStart(): void {}

  /** Receives the sync-end output. */
  handleSyncEnd(): void {}

  /** Receives the track-activation output. */
  handleTrackActivate(): void {}

  /** Receives the warning output. */
  handleWarning(): void {}
}

/**
 * TrackerComponent implements the shared declarative handle directly. Core
 * event subscription and configuration getters are not part of its public
 * surface, and there is no destroy Output; whenRuntimeDestroyed() is authoritative.
 */
function assertHandleShape(handle: TrackerComponent): void {
  handle.getState();
  handle.getStats();
  handle.refresh();
  handle.requestRefresh();
  handle.resetStats();
  void handle.whenRuntimeDestroyed();

  // @ts-expect-error on() is not part of the public TrackerComponent surface.
  handle.on;
  // @ts-expect-error off() is not part of the public TrackerComponent surface.
  handle.off;
  // @ts-expect-error getOptions() is not part of the public TrackerComponent surface.
  handle.getOptions;
  // @ts-expect-error getRules() is not part of the public TrackerComponent surface.
  handle.getRules;
  // @ts-expect-error There is no destroy Output; whenRuntimeDestroyed() is authoritative.
  handle.destroy;
}

void assertHandleShape;

/** A rule's own undefined field is still rejected inside the rules input. */
// @ts-expect-error Own `undefined` is rejected under exactOptionalPropertyTypes.
const invalidRuleField: TrackerRule = {
  label: undefined,
  selector: '.target',
};

void invalidRuleField;

export { AngularConsumerComponent };
