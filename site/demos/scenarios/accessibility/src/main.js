import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import '../../../../shared/application/base.css';
import './styles.css';

/** Accessible name exposed by the Tracker root. */
const ACCESSIBLE_TRACKER_LABEL = 'Demo section navigation';

/** Ordered source labels represented by the unclustered vertical rail. */
const FIXTURE_LABELS = Object.freeze(['Introduction', 'Installation', 'Configuration', 'Events', 'Cleanup']);

/** Rule that gives every section one label, built-in scroll target, and focus target. */
const TRACKED_RULES = [
  {
    selector: '.accessibility-target',
    label: (element) => element.getAttribute('data-section-label'),
    scroll: { align: 'start', behavior: 'auto', enabled: true, target: 'self' },
    focus: { enabled: true, target: 'self' },
  },
];

/** Public options that enable the authoritative Core keyboard state machine. */
const TRACKER_OPTIONS = {
  a11y: { enabled: true, keyboard: true, label: ACCESSIBLE_TRACKER_LABEL },
  clustering: { enabled: false },
  orientation: 'vertical',
  track: { className: 'accessibility-track' },
};

/** Source/query boundary containing the five semantic sections. */
const fixture = requireElement('#accessibility-fixture', HTMLElement);
/** DOM-order host placed between the two ordinary focus targets. */
const trackerHost = requireElement('#accessibility-tracker-host', HTMLElement);
/** Status panel used by browser validation and the visible lesson. */
const statePanel = requireElement('#accessibility-state', HTMLElement);

/** Tracker retained for the page lifetime. */
const tracker = new Tracker({ options: TRACKER_OPTIONS, rules: TRACKED_RULES });

/** DOM listener lifetime owned by this page. */
const eventController = new AbortController();
/** Public subscriptions released before Tracker destruction. */
const trackerUnsubscribes = [
  tracker.on('selection:change', handleSelectionChange),
  tracker.on('marker:activate', handleMarkerActivation),
  tracker.subscribeSnapshot(renderSelection),
];

document.addEventListener('focusin', renderFocusState, { signal: eventController.signal });

if (document.readyState === 'complete') {
  mountTracker();
} else {
  document.addEventListener('DOMContentLoaded', mountTracker, { once: true });
}

/** Mounts the window-mode Tracker into its intentional position in native tab order. */
function mountTracker() {
  tracker.mount({ renderHost: trackerHost, sourceRoot: fixture });
  renderSelection(tracker.getSnapshot());
  renderFocusState();

  const root = requireElement('.rxtt.accessibility-track', HTMLElement);
  statePanel.dataset.accessibleLabel = root.getAttribute('aria-label') ?? '';
  statePanel.dataset.rootTabindex = root.getAttribute('tabindex') ?? '';
  statePanel.dataset.fixtureCount = String(FIXTURE_LABELS.length);
}

/**
 * Reflects the real active DOM element without changing focus.
 *
 * @param {FocusEvent} [event] Native focus transition when called by the listener.
 */
function renderFocusState(event) {
  const activeElement = event?.target instanceof Element ? event.target : document.activeElement;
  const description = describeFocusedElement(activeElement);

  setOutput('#focus-state', description);
  statePanel.dataset.focusState = description;
}

/**
 * Projects logical selection from the immutable public snapshot.
 *
 * @param {{ items: ReadonlyArray<{ key: string, label: string | null }>, selection: { key: string | null } }} snapshot Public Tracker snapshot.
 */
function renderSelection(snapshot) {
  const selectedItem = snapshot.items.find((item) => item.key === snapshot.selection.key);
  const label = selectedItem?.label ?? 'None';

  setOutput('#selection-state', label);
  statePanel.dataset.selectionKey = snapshot.selection.key ?? '';
  statePanel.dataset.selectionLabel = label;
}

/**
 * Reports a committed logical selection transition without implementing navigation.
 *
 * @param {{ previousKey: string | null, selectedKey: string | null }} payload Public selection event payload.
 */
function handleSelectionChange(payload) {
  const transition = `${payload.previousKey ?? 'None'} → ${payload.selectedKey ?? 'None'}`;
  setOutput('#selection-transition', transition);
  statePanel.dataset.selectionPreviousKey = payload.previousKey ?? '';
  statePanel.dataset.selectionSelectedKey = payload.selectedKey ?? '';

  queueMicrotask(() => renderSelection(tracker.getSnapshot()));
}

/**
 * Reflects public marker activation after Core has completed built-in scroll and focus behavior.
 *
 * @param {{ element: Element, key: string, label: string | null, sourceEvent: Event | null }} payload Public marker activation payload.
 */
function handleMarkerActivation(payload) {
  fixture.querySelectorAll('.accessibility-target.is-activated').forEach((element) => {
    element.classList.remove('is-activated');
  });

  if (payload.element instanceof HTMLElement) {
    payload.element.classList.add('is-activated');
  }

  const label = payload.label ?? 'Unlabelled source';
  const source = payload.sourceEvent instanceof KeyboardEvent ? payload.sourceEvent.key : 'Pointer';
  setOutput('#activation-state', `${label} via ${source}`);
  statePanel.dataset.activationKey = payload.key;
  statePanel.dataset.activationLabel = label;
  statePanel.dataset.activationSource = source;
  statePanel.dataset.activationFocus = describeFocusedElement(document.activeElement);
}

/**
 * Returns the user-facing identity of the current focus target.
 *
 * @param {EventTarget | null} element Active focus target.
 * @returns {string} Stable focus description.
 */
function describeFocusedElement(element) {
  if (!(element instanceof Element) || element === document.body) {
    return 'Document body';
  }
  if (element.matches('.rxtt.accessibility-track')) {
    return 'Tracker root';
  }
  if (element instanceof HTMLElement && element.dataset.sectionLabel !== undefined) {
    return `Source: ${element.dataset.sectionLabel}`;
  }
  if (element.id === 'outside-before') {
    return 'Outside control before Tracker';
  }
  if (element.id === 'outside-after') {
    return 'Outside control after Tracker';
  }
  return element instanceof HTMLElement ? element.textContent?.trim() || element.tagName : element.nodeName;
}

/**
 * Writes a value to a required output element.
 *
 * @param {string} selector Output selector.
 * @param {string} value Display value.
 */
function setOutput(selector, value) {
  requireElement(selector, HTMLOutputElement).value = value;
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
    throw new Error(`Accessibility scenario is missing required element: ${selector}`);
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
