import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import './styles.css';

import { clearAnnotationHighlights, createAnnotationHighlights, getContainedSelectionRange } from './annotations.js';
import { clearSearchHighlights, createSearchHighlights } from './search.js';

/** Minimum literal query length accepted by the report search. */
const MIN_SEARCH_LENGTH = 5;

/** Upper bound that keeps one search from producing an unusable rail. */
const MAX_SEARCH_RESULTS = 200;

const reportTools = document.querySelector('#report-tools');
const report = document.querySelector('#report-content');
const searchForm = document.querySelector('#report-search-form');
const searchInput = document.querySelector('#report-search-input');
const searchButton = document.querySelector('#report-search-submit');
const clearSearchButton = document.querySelector('#clear-report-search');
const searchCount = document.querySelector('#report-search-count');
const highlightSelectionButton = document.querySelector('#highlight-report-selection');
const removeAnnotationButton = document.querySelector('#remove-report-annotation');
const clearHighlightsButton = document.querySelector('#clear-report-highlights');
const highlightCount = document.querySelector('#report-highlight-count');
const selectionAction = document.querySelector('#highlight-selection-action');
const navigationButtons = [...document.querySelectorAll('[data-navigation-rule]')];

if (
  !(reportTools instanceof HTMLElement) ||
  !(report instanceof HTMLElement) ||
  !(searchForm instanceof HTMLFormElement) ||
  !(searchInput instanceof HTMLInputElement) ||
  !(searchButton instanceof HTMLButtonElement) ||
  !(clearSearchButton instanceof HTMLButtonElement) ||
  !(searchCount instanceof HTMLOutputElement) ||
  !(highlightSelectionButton instanceof HTMLButtonElement) ||
  !(removeAnnotationButton instanceof HTMLButtonElement) ||
  !(clearHighlightsButton instanceof HTMLButtonElement) ||
  !(highlightCount instanceof HTMLOutputElement) ||
  !(selectionAction instanceof HTMLButtonElement) ||
  navigationButtons.some((button) => !(button instanceof HTMLButtonElement))
) {
  throw new Error('Document search and annotation controls are incomplete.');
}

const activeNavigationRules = new Set(['h2']);
let activeAnnotationId = null;
let annotationCounter = 0;
let pendingSelectionRange = null;
let searchQuery = '';

/** Matches the breakpoint where the reading column loses its side margins. */
const narrowMediaQuery = window.matchMedia('(max-width: 42rem)');

/** Matches viewports where the centered reading column leaves a wide gutter. */
const wideMediaQuery = window.matchMedia('(min-width: 90rem)');

/**
 * Keeps the track inside the gutter available beside the reading column.
 *
 * @returns {string} Track thickness CSS length.
 */
function resolveTrackThickness() {
  if (narrowMediaQuery.matches) {
    return '0.75rem';
  }

  if (wideMediaQuery.matches) {
    return '1.75rem';
  }

  return '1rem';
}

/**
 * Uses the visible landmark text as the marker's accessible label.
 *
 * @param {Element} element Matched report landmark.
 * @returns {string | null} Non-empty marker label.
 */
function getLandmarkLabel(element) {
  return element.textContent?.trim() || null;
}

/**
 * Builds a concise marker label for a highlighted text fragment.
 *
 * @param {string} prefix Highlight kind.
 * @param {Element} element Highlight span.
 * @returns {string | null} Marker label.
 */
function getHighlightLabel(prefix, element) {
  const text = element.textContent?.trim();
  return text ? `${prefix}: ${text}` : null;
}

/** Navigation rules exposed by the panel toggles. */
const NAVIGATION_RULES = Object.freeze([
  {
    color: 'var(--report-h1-accent)',
    id: 'h1',
    label: getLandmarkLabel,
    name: 'Title',
    selector: 'h1',
  },
  {
    color: 'var(--report-h2-accent)',
    id: 'h2',
    label: getLandmarkLabel,
    name: 'Sections',
    selector: 'h2',
  },
  {
    color: 'var(--report-h3-accent)',
    id: 'h3',
    label: getLandmarkLabel,
    name: 'Subsections',
    selector: 'h3',
  },
  {
    color: 'var(--report-h4-accent)',
    id: 'h4',
    label: getLandmarkLabel,
    name: 'Details',
    selector: 'h4',
  },
  {
    color: 'var(--report-table-accent)',
    id: 'tables',
    label: getLandmarkLabel,
    name: 'Tables',
    selector: 'caption',
  },
  {
    color: 'var(--report-figure-accent)',
    id: 'figures',
    label: getLandmarkLabel,
    name: 'Figures',
    selector: 'figcaption',
  },
]);

/** Rules that remain active independently of landmark navigation toggles. */
const HIGHLIGHT_RULES = Object.freeze([
  {
    selector: '.report-search-hit',
    label: (element) => getHighlightLabel('Search result', element),
    marker: {
      className: 'report-search-marker',
      cssVariables: { '--rxtt-marker-bg': 'var(--report-search-accent)' },
    },
  },
  {
    selector: '.report-annotation',
    label: (element) => getHighlightLabel('Highlighted text', element),
    marker: {
      className: 'report-annotation-marker',
      cssVariables: { '--rxtt-marker-bg': 'var(--report-highlight-accent)' },
    },
  },
]);

/**
 * Builds the currently enabled landmark rules followed by permanent highlight rules.
 *
 * @returns {object[]} Tracker rules for the current panel state.
 */
function buildActiveRules() {
  return [
    ...NAVIGATION_RULES.filter((rule) => activeNavigationRules.has(rule.id)).map(({ color, label, selector }) => ({
      label,
      marker: { cssVariables: { '--rxtt-marker-bg': color } },
      selector,
    })),
    ...HIGHLIGHT_RULES,
  ];
}

const tracker = new Tracker({
  options: {
    clustering: { enabled: false },
    cssVariables: {
      '--rxtt-marker-min-size': '0.5rem',
      '--rxtt-track-thickness': resolveTrackThickness(),
    },
  },
  rules: buildActiveRules(),
});

tracker.mount({ sourceRoot: report });

/**
 * Synchronizes counts and disabled states with the actual highlighted DOM.
 */
function syncHighlightControls() {
  const searchTotal = report.querySelectorAll('.report-search-hit').length;
  const annotationTotal = report.querySelectorAll('.report-annotation').length;
  const activeAnnotationExists =
    activeAnnotationId !== null &&
    report.querySelector(`[data-annotation-id="${CSS.escape(activeAnnotationId)}"]`) !== null;

  if (!activeAnnotationExists) {
    activeAnnotationId = null;
  }

  searchButton.disabled = searchInput.value.trim().length < MIN_SEARCH_LENGTH;
  clearSearchButton.disabled = searchTotal === 0;
  searchCount.value = String(searchTotal);
  clearHighlightsButton.disabled = annotationTotal === 0;
  removeAnnotationButton.disabled = !activeAnnotationExists;
  highlightCount.value = String(annotationTotal);
}

/**
 * Updates one navigation toggle without relying on color alone.
 *
 * @param {HTMLButtonElement} button Navigation toggle.
 * @param {boolean} active Whether its rule is enabled.
 */
function updateNavigationButton(button, active) {
  button.setAttribute('aria-pressed', String(active));
}

const navigationRulesById = new Map(NAVIGATION_RULES.map((rule) => [rule.id, rule]));
for (const button of navigationButtons) {
  const ruleId = button.dataset.navigationRule;
  const rule = ruleId === undefined ? undefined : navigationRulesById.get(ruleId);
  const count = button.querySelector('.report-tools__rule-count');
  if (rule === undefined || !(count instanceof HTMLElement)) {
    throw new Error('Document navigation controls do not match their Tracker rules.');
  }

  button.style.setProperty('--report-control-accent', rule.color);
  const elementCount = report.querySelectorAll(rule.selector).length;
  const accessibleDescription = `${rule.name}, ${String(elementCount)} ${elementCount === 1 ? 'item' : 'items'}`;
  count.textContent = String(elementCount);
  button.setAttribute('aria-label', accessibleDescription);
  button.title = accessibleDescription;
  updateNavigationButton(button, activeNavigationRules.has(rule.id));
  button.addEventListener('click', () => {
    if (activeNavigationRules.has(rule.id)) {
      activeNavigationRules.delete(rule.id);
    } else {
      activeNavigationRules.add(rule.id);
    }
    updateNavigationButton(button, activeNavigationRules.has(rule.id));
    tracker.replaceRules(buildActiveRules());
  });
}

/** Keeps anchor and marker navigation below the actual sticky panel height. */
function updateScrollClearance() {
  const isSticky = getComputedStyle(reportTools).position === 'sticky';
  const clearance = isSticky ? Math.ceil(reportTools.getBoundingClientRect().height + 16) : 16;
  document.documentElement.style.setProperty('--report-tools-scroll-clearance', `${String(clearance)}px`);
}

const toolsResizeObserver = new ResizeObserver(updateScrollClearance);
toolsResizeObserver.observe(reportTools);
updateScrollClearance();
syncHighlightControls();

/**
 * Applies a literal report search after validating visual density.
 *
 * @param {string} rawQuery User-entered query.
 * @returns {boolean} Whether the search was applied.
 */
function applySearch(rawQuery) {
  clearSearchHighlights(report);
  const query = rawQuery.trim();
  searchQuery = query;
  if (query.length < MIN_SEARCH_LENGTH) {
    searchQuery = '';
    searchInput.setCustomValidity(`Enter at least ${String(MIN_SEARCH_LENGTH)} characters.`);
    tracker.render();
    syncHighlightControls();
    return false;
  }

  const matches = createSearchHighlights(report, query, MAX_SEARCH_RESULTS);
  if (matches.overflow) {
    searchQuery = '';
    searchInput.setCustomValidity(`More than ${String(MAX_SEARCH_RESULTS)} matches found. Refine the search phrase.`);
    searchInput.reportValidity();
    tracker.render();
    syncHighlightControls();
    return false;
  }

  searchInput.setCustomValidity('');
  tracker.render();
  syncHighlightControls();
  return true;
}

/**
 * Clears transient search wrappers while preserving annotations.
 *
 * @param {{ resetInput?: boolean }} [options] Clear behavior.
 */
function clearSearch({ resetInput = true } = {}) {
  clearSearchHighlights(report);
  searchQuery = '';
  if (resetInput) {
    searchInput.value = '';
  }
  searchInput.setCustomValidity('');
  tracker.render();
  syncHighlightControls();
}

/** Hides the contextual selection action and releases its stored range. */
function hideSelectionAction() {
  selectionAction.hidden = true;
  highlightSelectionButton.disabled = true;
  pendingSelectionRange = null;
}

/** Positions the contextual action next to the current valid report selection. */
function updateSelectionAction() {
  const range = getContainedSelectionRange(report);
  if (range === null) {
    hideSelectionAction();
    return;
  }
  pendingSelectionRange = range;
  highlightSelectionButton.disabled = false;
  selectionAction.hidden = false;
  const rect = range.getBoundingClientRect();
  const maximumLeft = window.innerWidth - selectionAction.offsetWidth - 8;
  const maximumTop = window.innerHeight - selectionAction.offsetHeight - 8;
  selectionAction.style.left = `${String(Math.max(8, Math.min(rect.left, maximumLeft)))}px`;
  selectionAction.style.top = `${String(Math.max(8, Math.min(rect.bottom + 8, maximumTop)))}px`;
}

/**
 * Selects one annotation group for explicit removal.
 *
 * @param {string | null} annotationId Group identifier.
 */
function setActiveAnnotation(annotationId) {
  activeAnnotationId = annotationId;
  for (const annotation of report.querySelectorAll('.report-annotation')) {
    annotation.classList.toggle('report-annotation--active', annotation.dataset.annotationId === annotationId);
  }
  syncHighlightControls();
}

/**
 * Wraps every selected text-node segment in one annotation group.
 *
 * @param {Range | null} range Selected report range.
 * @returns {number} Number of annotation spans created.
 */
function createAnnotation(range) {
  if (range === null) {
    return 0;
  }
  const retainedQuery = searchQuery;
  clearSearchHighlights(report);
  const annotationId = `annotation-${String(annotationCounter + 1)}`;
  const createdCount = createAnnotationHighlights(report, range, annotationId);
  if (createdCount === 0) {
    if (retainedQuery !== '') {
      applySearch(retainedQuery);
    }
    return 0;
  }

  annotationCounter += 1;
  setActiveAnnotation(null);
  getSelection()?.removeAllRanges();
  hideSelectionAction();
  if (retainedQuery !== '') {
    applySearch(retainedQuery);
  } else {
    tracker.render();
    syncHighlightControls();
  }
  return createdCount;
}

/** Removes the active annotation group while preserving the current search. */
function removeActiveAnnotation() {
  if (activeAnnotationId === null) {
    return;
  }
  const retainedQuery = searchQuery;
  clearSearchHighlights(report);
  clearAnnotationHighlights(report, `[data-annotation-id="${CSS.escape(activeAnnotationId)}"]`);
  setActiveAnnotation(null);
  if (retainedQuery !== '') {
    applySearch(retainedQuery);
  } else {
    tracker.render();
    syncHighlightControls();
  }
}

/** Clears persistent annotations while preserving the current search. */
function clearAnnotations() {
  const retainedQuery = searchQuery;
  clearSearchHighlights(report);
  clearAnnotationHighlights(report);
  setActiveAnnotation(null);
  hideSelectionAction();
  if (retainedQuery !== '') {
    applySearch(retainedQuery);
  } else {
    tracker.render();
    syncHighlightControls();
  }
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applySearch(searchInput.value);
});
searchInput.addEventListener('input', () => {
  searchInput.setCustomValidity('');
  syncHighlightControls();
});
clearSearchButton.addEventListener('click', () => clearSearch());
highlightSelectionButton.addEventListener('pointerdown', (event) => {
  pendingSelectionRange = getContainedSelectionRange(report);
  event.preventDefault();
});
highlightSelectionButton.addEventListener('click', () =>
  createAnnotation(pendingSelectionRange ?? getContainedSelectionRange(report)),
);
removeAnnotationButton.addEventListener('click', removeActiveAnnotation);
clearHighlightsButton.addEventListener('click', clearAnnotations);
selectionAction.addEventListener('pointerdown', (event) => event.preventDefault());
selectionAction.addEventListener('click', () => createAnnotation(pendingSelectionRange));
document.addEventListener('selectionchange', () => queueMicrotask(updateSelectionAction));
report.addEventListener('click', (event) => {
  const annotation = event.target instanceof Element ? event.target.closest('.report-annotation') : null;
  if (annotation instanceof HTMLElement) {
    setActiveAnnotation(annotation.dataset.annotationId ?? null);
  }
});

/** Re-applies track thickness when the viewport crosses a width breakpoint. */
function handleBreakpointChange() {
  tracker.patchOptions({ cssVariables: { '--rxtt-track-thickness': resolveTrackThickness() } });
  updateScrollClearance();
}

narrowMediaQuery.addEventListener('change', handleBreakpointChange);
wideMediaQuery.addEventListener('change', handleBreakpointChange);

window.addEventListener(
  'pagehide',
  () => {
    narrowMediaQuery.removeEventListener('change', handleBreakpointChange);
    wideMediaQuery.removeEventListener('change', handleBreakpointChange);
    toolsResizeObserver.disconnect();
    tracker.destroy();
  },
  { once: true },
);
