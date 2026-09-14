import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Tracker } from '@rightxt/tracker-react';
import '@rightxt/tracker-react/style.css';
import '../../../../../shared/application/base.css';
import '../../../../../shared/events/styles.css';

import {
  createEventOptions,
  createEventRules,
  createEventScenario,
  installIntentionalErrorCapture,
} from '../../../../../shared/events/scenario.js';

/** Shared scenario UI for React-owned Tracker component lifetimes. */
const ui = createEventScenario({
  integration: 'React',
  eventApi: `<Tracker onMarkerActivate={handler} onSyncEnd={handler} ... />\nref.current.refresh() / ref.current.requestRefresh()\nref.current.whenRuntimeDestroyed()\nNo onDestroy callback prop`,
  lifecycle:
    'React mounts and unmounts the Tracker component. Retain its imperative handle before unmount to await runtime destruction; there is no destroy callback prop.',
  lifecycleActions: [
    { action: 'mount', label: 'Mount Tracker' },
    { action: 'unmount', label: 'Unmount Tracker' },
  ],
  binding: 'Runtime events are React callback props. This integration intentionally exposes no imperative .on() API.',
});

/** Imperative handle retained only while the React Tracker is mounted. */
const trackerRef = createRef();
/** React root that owns conditional Tracker component lifetimes. */
const root = createRoot(ui.trackerHost);
/** Stable marker rules shared by successive React Tracker lifetimes. */
const rules = createEventRules();
/** Normal options restored after each one-shot observer warning. */
const BASE_OPTIONS = createEventOptions();
let options = BASE_OPTIONS;
let mounted = false;
let lifetime = 0;
let mutationSequence = 0;
let warningRestorePending = false;

/** Releases page-level ownership of intentional application-error capture. */
const removeGlobalCapture = installIntentionalErrorCapture((message) => {
  ui.addApplicationError(message);
  queueMicrotask(updateStats);
});

/**
 * Publishes one React callback payload to the shared timeline.
 *
 * @param {string} eventName Public Core event name.
 * @param {object} payload Public event payload.
 */
function publish(eventName, payload) {
  ui.logEvent(eventName, payload, `React ${toCallbackName(eventName)} prop`);
  if (eventName === 'warning' && warningRestorePending) {
    warningRestorePending = false;
    queueMicrotask(() => {
      options = BASE_OPTIONS;
      renderTracker();
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
    throw new Error('Intentional demo React callback failure');
  }
  if (failure === 'async') {
    return Promise.reject(new Error('Intentional demo React async callback failure'));
  }
  return undefined;
}

/** Commits the requested present/absent Tracker component state. */
function renderTracker() {
  flushSync(() => {
    root.render(
      mounted ? (
        <Tracker
          ref={trackerRef}
          options={options}
          rules={rules}
          sourceRoot={ui.fixture}
          onMarkerActivate={onMarkerActivate}
          onClusterActivate={(payload) => publish('cluster:activate', payload)}
          onTrackActivate={(payload) => publish('track:activate', payload)}
          onSelectionChange={(payload) => publish('selection:change', payload)}
          onSyncStart={(payload) => publish('sync:start', payload)}
          onSyncEnd={onSyncEnd}
          onWarning={(payload) => publish('warning', payload)}
        />
      ) : null,
    );
  });
}

/** Publishes statistics exposed by the current imperative handle. */
function updateStats() {
  ui.updateStats(trackerRef.current?.getStats() ?? null);
}
/** Updates lifecycle controls from the current React component state. */
function updateControls() {
  ui.setActionEnabled('mount', !mounted);
  ui.setActionEnabled('unmount', mounted);
  ui.setRuntimeAvailable(
    mounted,
    mounted
      ? `React Tracker lifetime ${String(lifetime)} is mounted and operational.`
      : 'Runtime absent. The React root exists, but no Tracker component is mounted.',
  );
  updateStats();
}
/**
 * Returns the React callback-prop name corresponding to a Core event name.
 *
 * @param {string} eventName Public Core event name.
 * @returns {string} React callback prop name.
 */
function toCallbackName(eventName) {
  return `on${eventName
    .split(/[:]/u)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join('')}`;
}

ui.onAction('mount', () => {
  if (mounted) {
    return;
  }
  lifetime += 1;
  options = BASE_OPTIONS;
  mounted = true;
  ui.addBoundary(`React Tracker lifetime ${String(lifetime)}`);
  ui.addLifecycle('Mount requested', 'React creates the Tracker component and its Core runtime.');
  renderTracker();
  updateControls();
});
ui.onAction('unmount', () => {
  if (!mounted || trackerRef.current === null) {
    return;
  }
  const retainedHandle = trackerRef.current;
  const completedLifetime = lifetime;
  const completion = retainedHandle.whenRuntimeDestroyed();
  ui.addLifecycle('Unmount requested', 'The handle is retained before React removes the component.');
  mounted = false;
  ui.resetFailureOnTeardown();
  renderTracker();
  updateControls();
  void completion.then(() =>
    ui.addCompletion(
      'whenRuntimeDestroyed() resolved',
      `React Tracker lifetime ${String(completedLifetime)} completed; no onDestroy callback exists.`,
    ),
  );
});
ui.onAction('immediate', () => trackerRef.current?.refresh());
ui.onAction('scheduled', () => trackerRef.current?.requestRefresh());
ui.onAction('mutation', () => {
  mutationSequence += 1;
  const item = document.createElement('p');
  item.textContent = `Observed mutation ${String(mutationSequence)}`;
  ui.mutationZone.append(item);
});
ui.onAction('warning', () => {
  warningRestorePending = true;
  options = createEventOptions({
    updates: { ...BASE_OPTIONS.updates, mutation: { debounce: 0, enabled: true, targets: () => [] } },
  });
  renderTracker();
});
ui.onAction('sync-error', () => {
  if (trackerRef.current === null) {
    return;
  }
  ui.armFailure('sync');
  trackerRef.current.refresh();
});
ui.onAction('async-error', () => {
  if (trackerRef.current === null) {
    return;
  }
  ui.armFailure('async');
  trackerRef.current.refresh();
});

renderTracker();
updateControls();
window.addEventListener(
  'pagehide',
  () => {
    removeGlobalCapture();
    root.unmount();
  },
  { once: true },
);
