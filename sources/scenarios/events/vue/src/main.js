import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import { Tracker } from '@rightxt/tracker-vue';
import '@rightxt/tracker-vue/style.css';
import './shared/base.css';
import './shared/events.css';

import { createEventOptions, createEventRules, createEventScenario } from './shared/scenario.js';

/** Shared scenario UI for Vue-owned Tracker subtree lifetimes. */
const ui = createEventScenario({
  integration: 'Vue',
  eventApi: `Render function: onMarkerActivate / onSyncEnd\nTemplate equivalent: @marker-activate / @sync-end\ntemplateRef.refresh() / templateRef.requestRefresh()\ntemplateRef.whenRuntimeDestroyed()\nNo destroy emit`,
  lifecycle:
    'Vue mounts and unmounts the Tracker subtree. Retain the exposed handle before unmount to await runtime destruction; there is no destroy emit.',
  lifecycleActions: [
    { action: 'mount', label: 'Mount Tracker' },
    { action: 'unmount', label: 'Unmount Tracker' },
  ],
  binding: 'Runtime notifications are Vue emits/listeners. Listener ordering and error handling remain Vue-owned.',
});

/** Normal immutable options restored after each one-shot observer warning. */
const BASE_OPTIONS = createEventOptions();
/** Vue-owned options identity passed to the current Tracker subtree. */
const options = shallowRef(BASE_OPTIONS);
/** Stable rule identity shared by successive Vue Tracker lifetimes. */
const rules = shallowRef(createEventRules());
/** Exposed handle for the currently mounted Vue Tracker component. */
const trackerHandle = shallowRef(null);
/** Declarative presence state for the Vue Tracker subtree. */
const trackerMounted = shallowRef(false);
let lifetime = 0;
let mutationSequence = 0;
let warningRestorePending = false;

/**
 * Publishes one Vue listener payload to the shared timeline.
 *
 * @param {string} eventName Public Core event name.
 * @param {object} payload Public event payload.
 */
function publish(eventName, payload) {
  ui.logEvent(eventName, payload, `Vue ${eventName.replace(':', '-')} emit`);
  if (eventName === 'warning' && warningRestorePending) {
    warningRestorePending = false;
    queueMicrotask(() => {
      options.value = BASE_OPTIONS;
    });
  }
  if (eventName === 'sync:end' || eventName === 'warning') {
    queueMicrotask(updateStats);
  }
}

/** @param {object} payload Marker activation payload. */
function onMarkerActivate(payload) {
  publish('marker:activate', payload);
}

/** @param {object} payload Synchronization completion payload. */
function onSyncEnd(payload) {
  publish('sync:end', payload);
  const failure = ui.consumeArmedFailure();
  if (failure === 'sync') {
    throw new Error('Intentional demo Vue listener failure');
  }
  if (failure === 'async') {
    return Promise.reject(new Error('Intentional demo Vue async listener failure'));
  }
  return undefined;
}

/** Minimal Vue owner that conditionally renders the Tracker subtree. */
const App = defineComponent({
  name: 'RuntimeEventsVueApp',
  setup() {
    return () =>
      trackerMounted.value
        ? h(Tracker, {
            ref: trackerHandle,
            options: options.value,
            rules: rules.value,
            sourceRoot: ui.fixture,
            onMarkerActivate,
            onClusterActivate: (payload) => publish('cluster:activate', payload),
            onTrackActivate: (payload) => publish('track:activate', payload),
            onSelectionChange: (payload) => publish('selection:change', payload),
            onSyncStart: (payload) => publish('sync:start', payload),
            onSyncEnd,
            onWarning: (payload) => publish('warning', payload),
          })
        : null;
  },
});

/** Vue application owning conditional Tracker subtree lifetimes. */
const app = createApp(App);
app.config.errorHandler = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  ui.addApplicationError(`Vue app.config.errorHandler: ${message}`);
  queueMicrotask(updateStats);
};
app.mount(ui.trackerHost);

/** Publishes statistics exposed by the current Vue handle. */
function updateStats() {
  ui.updateStats(trackerHandle.value?.getStats() ?? null);
}
/** Updates lifecycle controls from the current subtree state. */
function updateControls() {
  ui.setActionEnabled('mount', !trackerMounted.value);
  ui.setActionEnabled('unmount', trackerMounted.value);
  ui.setRuntimeAvailable(
    trackerMounted.value,
    trackerMounted.value
      ? `Vue Tracker lifetime ${String(lifetime)} is mounted and operational.`
      : 'Runtime absent. The Vue application exists, but its Tracker subtree is not mounted.',
  );
  updateStats();
}

ui.onAction('mount', async () => {
  if (trackerMounted.value) {
    return;
  }
  lifetime += 1;
  options.value = BASE_OPTIONS;
  ui.addBoundary(`Vue Tracker lifetime ${String(lifetime)}`);
  ui.addLifecycle('Mount requested', 'Vue creates the Tracker subtree and its Core runtime.');
  trackerMounted.value = true;
  await nextTick();
  updateControls();
});
ui.onAction('unmount', async () => {
  if (!trackerMounted.value || trackerHandle.value === null) {
    return;
  }
  const retainedHandle = trackerHandle.value;
  const completedLifetime = lifetime;
  const completion = retainedHandle.whenRuntimeDestroyed();
  ui.addLifecycle('Unmount requested', 'The exposed handle is retained before Vue removes the subtree.');
  trackerMounted.value = false;
  ui.resetFailureOnTeardown();
  await nextTick();
  updateControls();
  await completion;
  ui.addCompletion(
    'whenRuntimeDestroyed() resolved',
    `Vue Tracker lifetime ${String(completedLifetime)} completed; no destroy emit exists.`,
  );
});
ui.onAction('immediate', () => trackerHandle.value?.refresh());
ui.onAction('scheduled', () => trackerHandle.value?.requestRefresh());
ui.onAction('mutation', () => {
  mutationSequence += 1;
  const item = document.createElement('p');
  item.textContent = `Observed mutation ${String(mutationSequence)}`;
  ui.mutationZone.append(item);
});
ui.onAction('warning', () => {
  warningRestorePending = true;
  options.value = createEventOptions({
    updates: { ...BASE_OPTIONS.updates, mutation: { debounce: 0, enabled: true, targets: () => [] } },
  });
});
ui.onAction('sync-error', () => {
  if (trackerHandle.value === null) {
    return;
  }
  ui.armFailure('sync');
  trackerHandle.value.refresh();
});
ui.onAction('async-error', () => {
  if (trackerHandle.value === null) {
    return;
  }
  ui.armFailure('async');
  trackerHandle.value.refresh();
});

updateControls();
window.addEventListener('pagehide', () => app.unmount(), { once: true });
