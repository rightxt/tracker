import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import '../../../../shared/application/base.css';
import './styles.css';

/** Compact threshold in normalized track percentage points. */
const COMPACT_THRESHOLD = 1;

/** Expanded threshold in normalized track percentage points. */
const EXPANDED_THRESHOLD = 20;

/** Stable fixture labels in their physical track order. */
const FIXTURE_LABELS = Object.freeze(['Target A', 'Target B', 'Target C', 'Target D', 'Target E', 'Target F']);

/** Threshold values exposed by the single controlled experiment. */
const THRESHOLD_PROFILES = Object.freeze({
  compact: COMPACT_THRESHOLD,
  expanded: EXPANDED_THRESHOLD,
});

/** Rule that represents every deterministic fixture source exactly once. */
const TRACKED_RULES = [
  {
    selector: '.cluster-target',
    label: (element) => element.getAttribute('data-target-label'),
    focus: { enabled: true, target: 'self' },
  },
];

/** Public options for one vertical element-mode Tracker. */
const TRACKER_OPTIONS = {
  a11y: { enabled: true, label: 'Clustering fixture navigation' },
  clustering: { enabled: true, threshold: COMPACT_THRESHOLD },
  orientation: 'vertical',
  track: { className: 'clustering-track' },
  viewport: { enabled: true },
};

/** Fixed geometry source plane. */
const fixture = requireElement('#clustering-fixture', HTMLElement);
/** Scroll boundary whose content range is normalized to the track. */
const scroller = requireElement('#clustering-scroller', HTMLElement);
/** Positioned host that owns the element-mode Tracker overlay. */
const stage = requireElement('#clustering-stage', HTMLElement);
/** Output containing the currently committed threshold. */
const thresholdOutput = requireElement('#current-threshold', HTMLOutputElement);
/** Threshold radio group. */
const thresholdControl = requireElement('#threshold-control', HTMLFieldSetElement);

/** Tracker instance retained while the page is active. */
const tracker = new Tracker({ options: TRACKER_OPTIONS, rules: TRACKED_RULES });

/** Event listener lifetime owned by this page. */
const eventController = new AbortController();
/** Public subscriptions released with the page. */
const trackerUnsubscribes = [
  tracker.on('marker:activate', handleMarkerActivation),
  tracker.on('cluster:activate', handleClusterActivation),
  tracker.subscribeSnapshot(renderClusteringResult),
];

thresholdControl.addEventListener('change', handleThresholdChange, { signal: eventController.signal });

if (document.readyState === 'complete') {
  mountTracker();
} else {
  document.addEventListener('DOMContentLoaded', mountTracker, { once: true });
}

/** Mounts the Tracker after aggregate-site navigation has had an opportunity to install. */
function mountTracker() {
  tracker.mount({ renderHost: stage, scrollRoot: scroller, sourceRoot: fixture });
  renderClusteringResult(tracker.getSnapshot());
}

/**
 * Applies the selected public clustering threshold to the mounted Tracker.
 *
 * @param {Event} event Radio-group change event.
 */
function handleThresholdChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.name !== 'threshold' || !input.checked) {
    return;
  }

  const threshold = THRESHOLD_PROFILES[input.value];
  if (threshold === undefined) {
    throw new Error(`Unknown clustering threshold profile: ${input.value}`);
  }

  thresholdOutput.value = formatThreshold(threshold);
  tracker.patchOptions({ clustering: { threshold } });
}

/**
 * Reports one public standalone-marker activation.
 *
 * @param {{ label: string | null }} payload Public marker activation payload.
 */
function handleMarkerActivation(payload) {
  const label = payload.label ?? 'Unlabelled source';
  updateActivationStatus({ count: 1, kind: 'Standalone marker', members: [label], primary: label });
}

/**
 * Reports one public cluster activation and its ordered represented members.
 *
 * @param {{ count: number, markers: ReadonlyArray<{ label: string | null }>, primaryMarker: { label: string | null } | null }} payload Public cluster activation payload.
 */
function handleClusterActivation(payload) {
  const members = payload.markers.map((marker) => marker.label ?? 'Unlabelled source');
  const primary = payload.primaryMarker?.label ?? 'None';
  updateActivationStatus({ count: payload.count, kind: 'Cluster', members, primary });
}

/**
 * Projects immutable public snapshot counts into the result panel.
 *
 * @param {{ clusters: ReadonlyArray<{ count: number }>, markers: ReadonlyArray<unknown> }} snapshot Public Tracker snapshot.
 */
function renderClusteringResult(snapshot) {
  const clusterCounts = snapshot.clusters.map((cluster) => cluster.count);
  const representedSources = snapshot.markers.length + clusterCounts.reduce((total, count) => total + count, 0);

  setOutput('#tracked-source-count', FIXTURE_LABELS.length);
  setOutput('#standalone-count', snapshot.markers.length);
  setOutput('#cluster-count', snapshot.clusters.length);
  setOutput('#represented-source-count', representedSources);
  setOutput('#cluster-counts', clusterCounts.length === 0 ? 'None' : clusterCounts.join(', '));

  const result = requireElement('#clustering-result', HTMLElement);
  result.dataset.standaloneCount = String(snapshot.markers.length);
  result.dataset.clusterCount = String(snapshot.clusters.length);
  result.dataset.clusterCounts = clusterCounts.join(',');
  result.dataset.representedSourceCount = String(representedSources);
}

/**
 * Writes application-owned activation state.
 *
 * @param {{ count: number, kind: string, members: ReadonlyArray<string>, primary: string }} activation Activation summary.
 */
function updateActivationStatus({ count, kind, members, primary }) {
  setOutput('#activation-kind', kind);
  setOutput('#activation-count', count);
  setOutput('#activation-members', members.join(', '));
  setOutput('#activation-primary', primary);
  requireElement('#activation-summary', HTMLElement).textContent = `${kind} activated: ${members.join(', ')}.`;

  const panel = requireElement('#clustering-activation', HTMLElement);
  panel.dataset.activationKind = kind === 'Cluster' ? 'cluster' : 'marker';
  panel.dataset.activationCount = String(count);
  panel.dataset.activationMembers = members.join('|');
  panel.dataset.activationPrimary = primary;
}

/**
 * Formats the public threshold unit without treating it as a CSS length.
 *
 * @param {number} threshold Threshold in track percentage points.
 * @returns {string} Human-readable threshold.
 */
function formatThreshold(threshold) {
  return `${String(threshold)} percentage ${threshold === 1 ? 'point' : 'points'}`;
}

/**
 * Writes a value to a required output element.
 *
 * @param {string} selector Output selector.
 * @param {string | number} value Display value.
 */
function setOutput(selector, value) {
  requireElement(selector, HTMLOutputElement).value = String(value);
}

/**
 * Returns a required element with a runtime-checked browser type.
 *
 * @template {Element} T
 * @param {string} selector Required selector.
 * @param {{ new (): T }} elementType Expected DOM constructor.
 * @returns {T} Matching element.
 */
function requireElement(selector, elementType) {
  const element = document.querySelector(selector);
  if (!(element instanceof elementType)) {
    throw new Error(`Clustering scenario is missing required element: ${selector}`);
  }
  return element;
}

window.addEventListener(
  'pagehide',
  () => {
    eventController.abort();
    trackerUnsubscribes.forEach((unsubscribe) => unsubscribe());
    tracker.destroy();
  },
  { once: true },
);
