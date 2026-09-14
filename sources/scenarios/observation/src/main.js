import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import './shared/base.css';
import './styles.css';

/** Long-form copy that gives the shared marker fixture stable page geometry. */
const FILLER_TEXT =
  'Scroll the page and watch both rails: their marker sets stay identical because both Trackers query the same source root with the same rules.';

/** Identical marker rules shared by the scoped and broad Trackers. */
const TRACKED_RULES = [
  { selector: '.demo-error', label: 'Error' },
  { selector: '.demo-note', label: 'Note' },
];

/** Shared source/query root used by both Tracker instances. */
const trackedRegion = requireElement('#tracked-region', HTMLElement);
/** Static fixture container inside the shared source root. */
const trackedContent = requireElement('#tracked-content', HTMLElement);
/** Destination for non-matching mutations inside sourceRoot. */
const insideList = requireElement('#inside-list', HTMLElement);
/** Destination for non-matching mutations outside sourceRoot. */
const outsideList = requireElement('#outside-list', HTMLElement);
/** Removal control for experiment nodes inside sourceRoot. */
const removeInsideButton = requireElement('#remove-inside', HTMLButtonElement);
/** Removal control for experiment nodes outside sourceRoot. */
const removeOutsideButton = requireElement('#remove-outside', HTMLButtonElement);

renderTrackedContent(trackedContent);

/** Tracker using sourceRoot as both query scope and default mutation target. */
const scopedTracker = new Tracker({
  options: createPresentationOptions({
    a11yLabel: 'Scoped mutation observation',
    markerColor: '#1971c2',
    profile: 'scoped',
    trackBackground: '#e7f5ff',
    trackClassName: 'observation-scoped-track',
    trackOffset: '0px',
  }),
  rules: TRACKED_RULES,
});

/** Tracker retaining the same query scope while observing document.body for mutation invalidation. */
const broadTracker = new Tracker({
  options: {
    ...createPresentationOptions({
      a11yLabel: 'Broad mutation observation',
      markerColor: '#e8590c',
      profile: 'broad',
      trackBackground: '#fff8e1',
      trackClassName: 'observation-broad-track',
      trackOffset: '1.75rem',
    }),
    updates: {
      mutation: {
        targets: ({ document: activeDocument }) => [activeDocument.body],
      },
    },
  },
  rules: TRACKED_RULES,
});

/** Mutation, render-request, and marker fields for both comparison cards. */
const statsViews = [createStatsView('#scoped-stats', scopedTracker), createStatsView('#broad-stats', broadTracker)];

/** Event listener lifetime for the page controls. */
const eventController = new AbortController();
/** Shared options that release page controls during teardown. */
const listenerOptions = { signal: eventController.signal };
/** Public event unsubscriptions owned by this page lifetime. */
const eventUnsubscribes = [
  scopedTracker.on('sync:end', refreshObservationStats),
  broadTracker.on('sync:end', refreshObservationStats),
];

if (document.readyState === 'complete') {
  initializeObservationScenario();
} else {
  document.addEventListener('DOMContentLoaded', initializeObservationScenario, { once: true });
}

requireElement('#add-inside', HTMLButtonElement).addEventListener(
  'click',
  () => addExperimentNode(insideList, 'inside'),
  listenerOptions,
);
removeInsideButton.addEventListener('click', () => removeExperimentNode(insideList), listenerOptions);
requireElement('#add-outside', HTMLButtonElement).addEventListener(
  'click',
  () => addExperimentNode(outsideList, 'outside'),
  listenerOptions,
);
removeOutsideButton.addEventListener('click', () => removeExperimentNode(outsideList), listenerOptions);

/**
 * Connects both observers only after deferred aggregate-site infrastructure has run.
 *
 * Standalone pages use the same document lifecycle without depending on aggregate navigation.
 */
function initializeObservationScenario() {
  scopedTracker.mount({ sourceRoot: trackedRegion });
  broadTracker.mount({ sourceRoot: trackedRegion });
  refreshObservationStats();
}

/**
 * Appends one deliberately non-matching childList mutation to an experiment region.
 *
 * @param {HTMLElement} list Mutation destination.
 * @param {'inside' | 'outside'} location Relationship to sourceRoot.
 */
function addExperimentNode(list, location) {
  const item = document.createElement('p');
  item.className = `observation-experiment-node observation-experiment-node--${location}`;
  item.textContent = `Non-matching node ${String(list.childElementCount + 1)} added ${location} sourceRoot.`;
  list.append(item);
  updateRemovalControls();
}

/**
 * Creates styling-only options so the two semantic configurations remain directly comparable.
 *
 * @param {{
 *   a11yLabel: string,
 *   markerColor: string,
 *   profile: string,
 *   trackBackground: string,
 *   trackClassName: string,
 *   trackOffset: string,
 * }} presentation Visual and accessible profile values.
 * @returns {object} Public options unrelated to mutation observation scope.
 */
function createPresentationOptions({ a11yLabel, markerColor, profile, trackBackground, trackClassName, trackOffset }) {
  return {
    a11y: { enabled: true, label: a11yLabel },
    cssVariables: {
      '--rxtt-marker-bg': markerColor,
      '--rxtt-track-bg': trackBackground,
      '--rxtt-track-border-color': markerColor,
      '--rxtt-track-border-width': '1px',
      '--rxtt-track-offset': trackOffset,
      '--rxtt-track-thickness': '1.25rem',
    },
    marker: { attributes: { 'data-observation-profile': profile } },
    track: { className: trackClassName },
  };
}

/**
 * Resolves the safe readonly fields for one Tracker statistics card.
 *
 * @param {string} selector Statistics-card selector.
 * @param {Tracker} tracker Tracker represented by the card.
 * @returns {{ markers: HTMLInputElement, mutation: HTMLInputElement, requested: HTMLInputElement, tracker: Tracker }} Statistics view.
 */
function createStatsView(selector, tracker) {
  return {
    markers: requireElement(`${selector} [data-field="markers"]`, HTMLInputElement),
    mutation: requireElement(`${selector} [data-field="mutation"]`, HTMLInputElement),
    requested: requireElement(`${selector} [data-field="requested"]`, HTMLInputElement),
    tracker,
  };
}

/** Copies public mutation-specific statistics into DOM-mutation-safe input values. */
function refreshObservationStats() {
  for (const view of statsViews) {
    const stats = view.tracker.getStats();
    view.mutation.value = String(stats.observers.mutation);
    view.requested.value = String(stats.renders.requested);
    view.markers.value = String(stats.markers.current);
  }
}

/**
 * Removes the most recently added experiment node from one mutation region.
 *
 * @param {HTMLElement} list Mutation source.
 */
function removeExperimentNode(list) {
  list.lastElementChild?.remove();
  updateRemovalControls();
}

/**
 * Fills the shared source root with deterministic rule matches and page geometry.
 *
 * @param {HTMLElement} container Static fixture destination.
 */
function renderTrackedContent(container) {
  const targets = [
    { className: 'demo-error', sections: [2, 4, 8], text: 'Error target' },
    { className: 'demo-note', sections: [3, 6, 9], text: 'Note target' },
  ];

  for (let index = 1; index <= 10; index += 1) {
    const section = document.createElement('section');
    section.className = 'observation-section';

    const heading = document.createElement('h3');
    heading.textContent = `Tracked region — section ${String(index)}`;
    section.append(heading);

    const description = document.createElement('p');
    description.textContent = FILLER_TEXT;
    section.append(description);

    for (const target of targets) {
      if (!target.sections.includes(index)) {
        continue;
      }
      const targetElement = document.createElement('div');
      targetElement.className = target.className;
      targetElement.textContent = `${target.text} in section ${String(index)}.`;
      section.append(targetElement);
    }
    container.append(section);
  }
}

/**
 * Returns a required element with a runtime-checked browser type.
 *
 * @template {Element} T
 * @param {string} selector Selector for the required element.
 * @param {{ new (): T }} elementType Expected DOM constructor.
 * @returns {T} Matching element.
 */
function requireElement(selector, elementType) {
  const element = document.querySelector(selector);
  if (!(element instanceof elementType)) {
    throw new Error(`Observation scenario is missing required element: ${selector}`);
  }
  return element;
}

/** Synchronizes removal availability with the visible experiment-node state. */
function updateRemovalControls() {
  removeInsideButton.disabled = insideList.childElementCount === 0;
  removeOutsideButton.disabled = outsideList.childElementCount === 0;
}

window.addEventListener(
  'pagehide',
  () => {
    eventController.abort();
    eventUnsubscribes.forEach((unsubscribe) => unsubscribe());
    scopedTracker.destroy();
    broadTracker.destroy();
  },
  { once: true },
);
