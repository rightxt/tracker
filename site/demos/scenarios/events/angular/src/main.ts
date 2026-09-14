import { Component, ErrorHandler, Injectable, signal, viewChild } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { TrackerComponent } from '@rightxt/tracker-angular';

import {
  createEventOptions,
  createEventRules,
  createEventScenario,
  installIntentionalErrorCapture,
} from '../../../../../shared/events/scenario.js';

/** Shared scenario UI for Angular-owned Tracker component lifetimes. */
const ui = createEventScenario({
  integration: 'Angular',
  eventApi: `(markerActivate)="onMarkerActivate($event)"\n(syncEnd)="onSyncEnd($event)"\ntracker().refresh() / tracker().requestRefresh()\ntracker().whenRuntimeDestroyed()\nNo destroy output`,
  lifecycle:
    'Angular creates and removes the Tracker component through template control flow. Retain the queried component before removal to await runtime destruction; there is no destroy output.',
  lifecycleActions: [
    { action: 'mount', label: 'Create component' },
    { action: 'unmount', label: 'Remove component' },
  ],
  binding: 'Runtime notifications are Angular outputs. Subscriber delivery and errors remain Angular-owned.',
});

type TrackerOptions = Exclude<ReturnType<TrackerComponent['options']>, undefined>;
type TrackerRules = Exclude<ReturnType<TrackerComponent['rules']>, undefined>;
/** Normal immutable options restored after each one-shot observer warning. */
const baseOptions = createEventOptions() as TrackerOptions;
/** Signal-owned options input for the current Angular Tracker component. */
const options = signal<TrackerOptions>(baseOptions);
/** Stable rules input shared by successive Angular Tracker lifetimes. */
const rules = createEventRules() as TrackerRules;
/** Declarative presence state for the Angular Tracker component. */
const trackerMounted = signal(false);
/** Actual camel-cased Angular output names shown beside public event payloads. */
const outputNames: Readonly<Record<string, string>> = {
  'cluster:activate': 'clusterActivate',
  'marker:activate': 'markerActivate',
  'selection:change': 'selectionChange',
  'sync:end': 'syncEnd',
  'sync:start': 'syncStart',
  'track:activate': 'trackActivate',
  warning: 'warning',
};
let lifetime = 0;
let mutationSequence = 0;
let warningRestorePending = false;

/** Host element for the standalone Angular application. */
const appHost = document.createElement('events-angular-app');
ui.trackerHost.append(appHost);

/** Routes Angular-owned callback failures to the scenario application-error channel. */
@Injectable()
class DemoErrorHandler implements ErrorHandler {
  /**
   * Publishes one framework-owned exception without reclassifying it as a Tracker error.
   *
   * @param {unknown} error Exception delivered by Angular.
   */
  handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    ui.addApplicationError(`Angular ErrorHandler: ${message}`);
  }
}

/** Angular owner of the conditional first-party Tracker integration. */
@Component({
  selector: 'events-angular-app',
  imports: [TrackerComponent],
  template: `
    @if (trackerMounted()) {
      <rxt-tracker-angular
        [options]="options()"
        [rules]="rules"
        [sourceRoot]="fixture"
        (markerActivate)="onMarkerActivate($event)"
        (clusterActivate)="publish('cluster:activate', $event)"
        (trackActivate)="publish('track:activate', $event)"
        (selectionChange)="publish('selection:change', $event)"
        (syncStart)="publish('sync:start', $event)"
        (syncEnd)="onSyncEnd($event)"
        (warning)="publish('warning', $event)"
      />
    }
  `,
})
class EventsAngularComponent {
  /** DOM source passed through the Angular integration input. */
  readonly fixture = ui.fixture;
  /** Signal supplying immutable Tracker option replacements. */
  readonly options = options;
  /** Stable marker rules supplied to every component lifetime. */
  readonly rules = rules;
  /** Signal controlling whether the Tracker component exists. */
  readonly trackerMounted = trackerMounted;
  /** Query exposing the current first-party integration handle. */
  readonly tracker = viewChild(TrackerComponent);

  /**
   * Publishes an Angular output payload and schedules one-shot warning restoration.
   *
   * @param {string} eventName Core event name represented by the output.
   * @param {unknown} payload Output payload owned by Angular delivery.
   */
  publish(eventName: string, payload: unknown): void {
    ui.logEvent(eventName, payload, `Angular ${outputNames[eventName] ?? eventName} output`);
    if (eventName === 'warning' && warningRestorePending) {
      warningRestorePending = false;
      queueMicrotask(() => options.set(baseOptions));
    }
    if (eventName === 'sync:end' || eventName === 'warning') {
      queueMicrotask(updateStats);
    }
  }

  /**
   * Publishes marker activation through the shared timeline.
   *
   * @param {unknown} payload Angular marker-activation output payload.
   */
  onMarkerActivate(payload: unknown): void {
    this.publish('marker:activate', payload);
  }

  /**
   * Publishes synchronization completion and runs the armed consumer-failure experiment.
   *
   * @param {unknown} payload Angular synchronization output payload.
   * @returns {void | Promise<never>} Rejected Promise only for the intentional async failure run.
   */
  onSyncEnd(payload: unknown): void | Promise<never> {
    this.publish('sync:end', payload);
    const failure = ui.consumeArmedFailure();
    if (failure === 'sync') {
      throw new Error('Intentional demo Angular output subscriber failure');
    }
    if (failure === 'async') {
      return Promise.reject(new Error('Intentional demo Angular async subscriber failure'));
    }
    return undefined;
  }
}

/** Releases page-level ownership of intentional application-error capture. */
const removeGlobalCapture = installIntentionalErrorCapture((message: string) => ui.addApplicationError(message));
/** Standalone Angular application owning the component lifecycle. */
const application = await bootstrapApplication(EventsAngularComponent, {
  providers: [{ provide: ErrorHandler, useClass: DemoErrorHandler }],
});
/** Bootstrapped scenario component used by external demo controls. */
const component = application.components[0]?.instance;
if (!(component instanceof EventsAngularComponent)) {
  throw new Error('Angular events component did not bootstrap.');
}

/** Publishes public statistics from the current queried Tracker component. */
function updateStats(): void {
  ui.updateStats(component.tracker()?.getStats() ?? null);
}
/** Updates external lifecycle controls from Angular's declarative component state. */
function updateControls(): void {
  ui.setActionEnabled('mount', !trackerMounted());
  ui.setActionEnabled('unmount', trackerMounted());
  ui.setRuntimeAvailable(
    trackerMounted(),
    trackerMounted()
      ? `Angular Tracker lifetime ${String(lifetime)} is created and operational.`
      : 'Runtime absent. The Angular application exists, but template control flow has not created Tracker.',
  );
  updateStats();
}

ui.onAction('mount', () => {
  if (trackerMounted()) {
    return;
  }
  lifetime += 1;
  options.set(baseOptions);
  ui.addBoundary(`Angular Tracker lifetime ${String(lifetime)}`);
  ui.addLifecycle(
    'Component creation requested',
    'Angular template control flow creates Tracker and its Core runtime.',
  );
  trackerMounted.set(true);
  queueMicrotask(updateControls);
});
ui.onAction('unmount', () => {
  const retainedComponent = component.tracker();
  if (!trackerMounted() || retainedComponent === undefined) {
    return;
  }
  const completion = retainedComponent.whenRuntimeDestroyed();
  const completedLifetime = lifetime;
  ui.addLifecycle(
    'Component removal requested',
    'The component reference is retained before template control flow removes it.',
  );
  trackerMounted.set(false);
  ui.resetFailureOnTeardown();
  queueMicrotask(updateControls);
  void completion.then(() =>
    ui.addCompletion(
      'whenRuntimeDestroyed() resolved',
      `Angular Tracker lifetime ${String(completedLifetime)} completed; no destroy output exists.`,
    ),
  );
});
ui.onAction('immediate', () => component.tracker()?.refresh());
ui.onAction('scheduled', () => component.tracker()?.requestRefresh());
ui.onAction('mutation', () => {
  mutationSequence += 1;
  const item = document.createElement('p');
  item.textContent = `Observed mutation ${String(mutationSequence)}`;
  ui.mutationZone.append(item);
});
ui.onAction('warning', () => {
  warningRestorePending = true;
  options.set({
    ...baseOptions,
    updates: { ...(baseOptions.updates ?? {}), mutation: { debounce: 0, enabled: true, targets: () => [] } },
  });
});
ui.onAction('sync-error', () => {
  const current = component.tracker();
  if (current === undefined) {
    return;
  }
  ui.armFailure('sync');
  current.refresh();
});
ui.onAction('async-error', () => {
  const current = component.tracker();
  if (current === undefined) {
    return;
  }
  ui.armFailure('async');
  current.refresh();
});

updateControls();
window.addEventListener(
  'pagehide',
  () => {
    removeGlobalCapture();
    application.destroy();
  },
  { once: true },
);
