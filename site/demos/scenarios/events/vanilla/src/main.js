import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import '../../../../../shared/application/base.css';
import '../../../../../shared/events/styles.css';

import {
  createEventOptions,
  createEventRules,
  createEventScenario,
  installIntentionalErrorCapture,
} from '../../../../../shared/events/scenario.js';

/** Shared scenario UI for the current Vanilla Tracker lifetime. */
const ui = createEventScenario({
  integration: 'Vanilla',
  eventApi: `tracker.on('sync:end', handler)\nunsubscribe() / tracker.off(eventName, handler)\ntracker.render() / tracker.requestRender()\ntracker.whenDestroyed()`,
  lifecycle:
    'Create an object, mount and temporarily unmount the same instance, then destroy it terminally. A destroyed Tracker cannot be mounted again.',
  lifecycleActions: [
    { action: 'create', label: 'Create Tracker' },
    { action: 'mount', label: 'Mount' },
    { action: 'unmount', label: 'Unmount' },
    { action: 'destroy', label: 'Destroy' },
  ],
  binding: 'Vanilla deduplicates one callback identity while retaining independent reference-counted owners.',
  bindingExperiment: true,
});

/** Normal options restored after each one-shot observer warning. */
const BASE_OPTIONS = createEventOptions();
/** Shared marker rules applied to every Vanilla Tracker object. */
const RULES = createEventRules();
let tracker = null;
let mounted = false;
let objectSequence = 0;
let mountCycle = 0;
let mutationSequence = 0;
let warningRestorePending = false;

/** Releases page-level ownership of intentional application-error capture. */
const removeGlobalCapture = installIntentionalErrorCapture((message) => {
  ui.addApplicationError(message);
  queueMicrotask(updateStats);
});

/** Updates controls and statistics from the current Vanilla object/mount state. */
function updateControls() {
  const live = tracker !== null && !tracker.destroyed;
  ui.setActionEnabled('create', !live);
  ui.setActionEnabled('mount', live && !mounted);
  ui.setActionEnabled('unmount', live && mounted);
  ui.setActionEnabled('destroy', live);
  ui.setRuntimeAvailable(
    live && mounted,
    live
      ? mounted
        ? 'Tracker is mounted and operational.'
        : 'Tracker object exists and is temporarily unmounted.'
      : 'Runtime absent. Create a Tracker to begin.',
  );
  ui.updateStats(live ? tracker.getStats() : null);
}

/**
 * Attaches public event and intentional-failure subscriptions.
 *
 * @param {Tracker} nextTracker Unmounted Vanilla Tracker object.
 */
function attachListeners(nextTracker) {
  for (const eventName of ui.EVENT_NAMES) {
    nextTracker.on(eventName, (payload) => {
      ui.logEvent(eventName, payload, 'tracker.on()');
      if (eventName === 'warning' && warningRestorePending) {
        warningRestorePending = false;
        queueMicrotask(() => nextTracker.replaceOptions(BASE_OPTIONS));
      }
      if (eventName === 'sync:end' || eventName === 'warning') {
        queueMicrotask(updateStats);
      }
    });
  }
  nextTracker.on('sync:end', () => {
    const failure = ui.consumeArmedFailure();
    if (failure === 'sync') {
      throw new Error('Intentional demo handler failure');
    }
    if (failure === 'async') {
      return Promise.reject(new Error('Intentional demo async handler failure'));
    }
    return undefined;
  });
}

/** Publishes current runtime statistics when the Tracker object remains live. */
function updateStats() {
  ui.updateStats(tracker !== null && !tracker.destroyed ? tracker.getStats() : null);
}

ui.onAction('create', () => {
  objectSequence += 1;
  mountCycle = 0;
  ui.addBoundary(`Tracker instance #${String(objectSequence)}`);
  ui.addLifecycle('new Tracker()', 'Application constructs an unmounted Tracker object.');
  tracker = new Tracker({ options: BASE_OPTIONS, rules: RULES });
  mounted = false;
  attachListeners(tracker);
  updateControls();
});
ui.onAction('mount', () => {
  if (tracker === null || tracker.destroyed || mounted) {
    return;
  }
  mountCycle += 1;
  ui.addBoundary(`Mount cycle #${String(mountCycle)}`);
  ui.addLifecycle('tracker.mount()', 'Application requests a mount for this reusable Tracker object.');
  tracker.mount({ renderHost: document.body, sourceRoot: ui.fixture });
  mounted = true;
  updateControls();
});
ui.onAction('unmount', () => {
  if (tracker === null || !mounted) {
    return;
  }
  ui.addLifecycle(
    'tracker.unmount()',
    'Application detaches this mount cycle; object identity and subscriptions remain.',
  );
  ui.resetFailureOnTeardown();
  tracker.unmount();
  mounted = false;
  updateControls();
});
ui.onAction('destroy', () => {
  if (tracker === null || tracker.destroyed) {
    return;
  }
  const current = tracker;
  const completion = current.whenDestroyed();
  ui.addLifecycle('Terminal destroy requested');
  current.destroy();
  mounted = false;
  ui.resetFailureOnTeardown();
  updateControls();
  void completion.then(() =>
    ui.addCompletion('whenDestroyed() resolved', 'Terminal cleanup for this Tracker object completed.'),
  );
});
ui.onAction('immediate', () => tracker?.render());
ui.onAction('scheduled', () => tracker?.requestRender());
ui.onAction('mutation', () => {
  mutationSequence += 1;
  const item = document.createElement('p');
  item.textContent = `Observed mutation ${String(mutationSequence)}`;
  ui.mutationZone.append(item);
});
ui.onAction('warning', () => {
  if (tracker === null) {
    return;
  }
  warningRestorePending = true;
  tracker.patchOptions({ updates: { mutation: { enabled: true, targets: () => [] } } });
});
ui.onAction('sync-error', () => {
  if (tracker === null || !mounted) {
    return;
  }
  ui.armFailure('sync');
  tracker.render();
});
ui.onAction('async-error', () => {
  if (tracker === null || !mounted) {
    return;
  }
  ui.armFailure('async');
  tracker.render();
});
ui.onAction('binding-experiment', () => {
  if (tracker === null || !mounted) {
    return;
  }
  const marker = tracker.root?.querySelector('.rxtt__marker[data-rxtt-kind="marker"]');
  if (!(marker instanceof HTMLElement)) {
    return;
  }
  let deliveries = 0;
  const callback = () => {
    deliveries += 1;
  };
  const firstOwner = tracker.on('marker:activate', callback);
  const secondOwner = tracker.on('marker:activate', callback);
  marker.click();
  ui.addBindingEntry(`Two owners, one delivery: ${String(deliveries)}`);
  firstOwner();
  marker.click();
  ui.addBindingEntry(`After first unsubscribe, callback remains: ${String(deliveries)}`);
  secondOwner();
  marker.click();
  ui.addBindingEntry(`After final unsubscribe, callback is gone: ${String(deliveries)}`);
  tracker.on('marker:activate', callback);
  tracker.on('marker:activate', callback);
  tracker.off('marker:activate', callback);
  marker.click();
  ui.addBindingEntry(`off() released all current owners: ${String(deliveries)}`);
});

updateControls();
window.addEventListener(
  'pagehide',
  () => {
    removeGlobalCapture();
    tracker?.destroy();
  },
  { once: true },
);
