import { Component, signal, viewChild } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { TrackerComponent } from '@rightxt/tracker-angular';

import { createPlaygroundWorkbench } from '../../../../shared/playground/workbench.js';

/** Source root owned by the shared playground fixture. */
const content = document.querySelector('#playground-workbench-content');
if (!(content instanceof HTMLElement)) {
  throw new Error('Angular playground content root is missing.');
}

type TrackerOptions = Exclude<ReturnType<TrackerComponent['options']>, undefined>;
type TrackerRules = Exclude<ReturnType<TrackerComponent['rules']>, undefined>;
type PlaygroundConfiguration = { options: TrackerOptions; rules: TrackerRules };

/** Replaceable configuration delivered through Angular signal inputs. */
const configuration = signal<PlaygroundConfiguration>({ options: {}, rules: [] });
/** Receives Angular output events once the workbench is initialized. */
let receiveWorkbenchEvent: (eventName: string, payload: unknown) => void = () => {};

/** Angular-owned declarative boundary around the shared DOM workbench. */
@Component({
  selector: 'angular-playground',
  imports: [TrackerComponent],
  template: `
    <rxt-tracker-angular
      [options]="configuration().options"
      [rules]="configuration().rules"
      [sourceRoot]="content"
      (clusterActivate)="dispatchEvent('cluster:activate', $event)"
      (markerActivate)="dispatchEvent('marker:activate', $event)"
      (selectionChange)="dispatchEvent('selection:change', $event)"
      (syncEnd)="dispatchEvent('sync:end', $event)"
      (syncStart)="dispatchEvent('sync:start', $event)"
      (trackActivate)="dispatchEvent('track:activate', $event)"
      (warning)="dispatchEvent('warning', $event)"
    />
  `,
})
class PlaygroundComponent {
  /** Signal-backed complete configuration bound to Tracker inputs. */
  readonly configuration = configuration;
  /** DOM source root passed through the Tracker sourceRoot input. */
  readonly content = content;
  /** Query for the mounted public Tracker component handle. */
  readonly tracker = viewChild(TrackerComponent);

  /** Forwards an Angular output to the framework-neutral workbench presentation. */
  dispatchEvent(eventName: string, payload: unknown): void {
    receiveWorkbenchEvent(eventName, payload);
  }
}

/** Bootstrapped Angular component used to access the public Tracker query. */
let component: PlaygroundComponent | null = null;

/** Returns the mounted public Angular Tracker component handle. */
function getTracker(): TrackerComponent {
  const tracker = component?.tracker();
  if (tracker === undefined) {
    throw new Error('Angular Tracker component handle is unavailable.');
  }
  return tracker;
}

/** Demo-only bridge from the shared workbench to Angular signals and component methods. */
const workbench = createPlaygroundWorkbench({
  commitConfiguration: (candidate) => {
    configuration.set(candidate as PlaygroundConfiguration);
  },
  getStats: () => getTracker().getStats(),
  renderNow: () => getTracker().refresh(),
  requestRender: () => getTracker().requestRefresh(),
  resetStats: () => getTracker().resetStats(),
});
receiveWorkbenchEvent = workbench.handleEvent;
configuration.set(workbench.getInitialConfiguration() as PlaygroundConfiguration);
/** Angular application reference used for page-exit teardown. */
const application = await bootstrapApplication(PlaygroundComponent);
const bootstrappedComponent = application.components[0]?.instance;
if (!(bootstrappedComponent instanceof PlaygroundComponent)) {
  throw new Error('Angular playground component did not bootstrap.');
}
component = bootstrappedComponent;
workbench.start();

window.addEventListener('pagehide', () => application.destroy(), { once: true });
