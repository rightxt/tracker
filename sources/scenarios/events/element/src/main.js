import '@rightxt/tracker-element/register';
import '@rightxt/tracker-element/style.css';
import './shared/base.css';
import './shared/events.css';

import {
  createEventOptions,
  createEventRules,
  createEventScenario,
  installIntentionalErrorCapture,
} from './shared/scenario.js';

/** Shared scenario UI across persistent Custom Element objects and runtime generations. */
const ui = createEventScenario({
  integration: 'Element',
  eventApi: `tracker.addEventListener('sync:end', listener)\npayload = event.detail\ntracker.render() / tracker.requestRender()\nremoveEventListener() / AbortSignal`,
  lifecycle:
    'The detached HTMLElement persists. Disconnect destroys one Core runtime generation; reconnecting the same element creates the next. Existing DOM listeners survive.',
  lifecycleActions: [
    { action: 'create', label: 'Create element' },
    { action: 'connect', label: 'Connect' },
    { action: 'disconnect', label: 'Disconnect' },
    { action: 'discard', label: 'Discard' },
  ],
  binding: 'Listeners follow native EventTarget identity, capture, removal, and AbortSignal semantics.',
  bindingExperiment: true,
});

/** Normal options restored after each one-shot observer warning. */
const BASE_OPTIONS = createEventOptions();
/** Shared marker rules applied to every Custom Element object. */
const RULES = createEventRules();
let tracker = null;
let elementSequence = 0;
let generation = 0;
let mutationSequence = 0;
let warningRestorePending = false;

/** Releases page-level ownership of intentional application-error capture. */
const removeGlobalCapture = installIntentionalErrorCapture((message) => {
  ui.addApplicationError(message);
  queueMicrotask(updateStats);
});

/** Publishes statistics for the currently connected runtime generation. */
function updateStats() {
  ui.updateStats(tracker?.isConnected ? tracker.getStats() : null);
}

/** Updates controls from the detached/connected HTMLElement state. */
function updateControls() {
  const exists = tracker !== null;
  const connected = tracker?.isConnected ?? false;
  ui.setActionEnabled('create', !exists);
  ui.setActionEnabled('connect', exists && !connected);
  ui.setActionEnabled('disconnect', connected);
  ui.setActionEnabled('discard', exists && !connected);
  ui.setRuntimeAvailable(
    connected,
    !exists
      ? 'Runtime absent. Create an element to begin.'
      : connected
        ? `Element connected; runtime generation ${String(generation)} is operational.`
        : 'Element exists detached; no Core runtime generation is active.',
  );
  updateStats();
}

/**
 * Attaches persistent DOM listeners before the element's first connection.
 *
 * @param {HTMLElement} element Detached Tracker custom element.
 */
function attachListeners(element) {
  for (const eventName of ui.EVENT_NAMES) {
    element.addEventListener(eventName, (event) => {
      ui.logEvent(
        eventName,
        event.detail,
        `CustomEvent: bubbles=${String(event.bubbles)}, composed=${String(event.composed)}, cancelable=${String(event.cancelable)}`,
      );
      if (eventName === 'warning' && warningRestorePending) {
        warningRestorePending = false;
        queueMicrotask(() => element.replaceOptions(BASE_OPTIONS));
      }
      if (eventName === 'sync:end' || eventName === 'warning') {
        queueMicrotask(updateStats);
      }
    });
  }
  element.addEventListener('sync:end', () => {
    const failure = ui.consumeArmedFailure();
    if (failure === 'sync') {
      throw new Error('Intentional demo Element listener failure');
    }
    if (failure === 'async') {
      return Promise.reject(new Error('Intentional demo Element async listener failure'));
    }
    return undefined;
  });
}

ui.onAction('create', () => {
  elementSequence += 1;
  generation = 0;
  ui.addBoundary(`Element object #${String(elementSequence)}`);
  ui.addLifecycle('document.createElement()', 'Application creates and configures a detached Tracker element.');
  tracker = document.createElement('rxt-tracker');
  attachListeners(tracker);
  tracker.sourceRoot = ui.fixture;
  tracker.replaceOptions(BASE_OPTIONS);
  tracker.replaceRules(RULES);
  updateControls();
});
ui.onAction('connect', () => {
  if (tracker === null || tracker.isConnected) {
    return;
  }
  generation += 1;
  ui.addBoundary(`Runtime generation #${String(generation)}`);
  ui.addLifecycle(
    'Element connected',
    'Application appends the same HTMLElement and creates a Core runtime generation.',
  );
  ui.trackerHost.append(tracker);
  updateControls();
});
ui.onAction('disconnect', () => {
  if (tracker === null || !tracker.isConnected) {
    return;
  }
  ui.addLifecycle('Element disconnected', 'Application removes the element; its current Core runtime emits destroy.');
  ui.resetFailureOnTeardown();
  tracker.remove();
  updateControls();
});
ui.onAction('discard', () => {
  if (tracker === null || tracker.isConnected) {
    return;
  }
  ui.addLifecycle('Detached HTMLElement discarded', 'A later Create action produces a different element object.');
  tracker = null;
  ui.resetFailureOnTeardown();
  updateControls();
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
  if (tracker === null || !tracker.isConnected) {
    return;
  }
  ui.armFailure('sync');
  tracker.render();
});
ui.onAction('async-error', () => {
  if (tracker === null || !tracker.isConnected) {
    return;
  }
  ui.armFailure('async');
  tracker.render();
});
ui.onAction('binding-experiment', () => {
  if (tracker === null || !tracker.isConnected) {
    return;
  }
  const marker = tracker.querySelector('.rxtt__marker[data-rxtt-kind="marker"]');
  if (!(marker instanceof HTMLElement)) {
    return;
  }
  let deliveries = 0;
  const callback = () => {
    deliveries += 1;
  };
  tracker.addEventListener('marker:activate', callback);
  tracker.addEventListener('marker:activate', callback);
  marker.click();
  ui.addBindingEntry(`Duplicate equivalent listeners deliver once: ${String(deliveries)}`);
  tracker.removeEventListener('marker:activate', callback);
  marker.click();
  ui.addBindingEntry(`removeEventListener() detached it: ${String(deliveries)}`);
  const controller = new AbortController();
  tracker.addEventListener('marker:activate', callback, { signal: controller.signal });
  controller.abort();
  marker.click();
  ui.addBindingEntry(`AbortSignal detached its listener: ${String(deliveries)}`);
});

updateControls();
window.addEventListener(
  'pagehide',
  () => {
    removeGlobalCapture();
    tracker?.remove();
  },
  { once: true },
);
