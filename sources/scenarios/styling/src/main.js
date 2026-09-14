import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import './shared/base.css';
import './styles.css';

/**
 * Shared colors that make four local styling mechanisms resolve to the same computed appearance.
 */
const COMPARISON_COLORS = {
  cluster: 'rgb(15 23 42)',
  error: 'rgb(220 38 38)',
  marker: 'rgb(37 99 235)',
  ring: 'rgb(255 255 255)',
  track: 'rgb(226 232 240)',
  trackBorder: 'rgb(71 85 105)',
  viewport: 'rgb(14 116 144 / 0.24)',
  warning: 'rgb(217 119 6)',
};

/** Canonical tracked fixture cloned into every local comparison card. */
const fixtureTemplate = document.querySelector('#comparison-fixture-template');
/** One-column destination for the four equivalent local Tracker comparisons. */
const comparisonGrid = document.querySelector('.comparison-grid');

if (!(fixtureTemplate instanceof HTMLTemplateElement) || !(comparisonGrid instanceof HTMLElement)) {
  throw new Error('Styling scenario roots are missing.');
}

/** @type {Tracker[]} */
const trackers = [];

/**
 * Clones the canonical fixture and resolves one local element-scroll mount.
 *
 * @param {string} caseName - Value of the comparison card's data attribute.
 * @returns {{ fixtureHost: HTMLElement, scroller: HTMLElement, stage: HTMLElement }} Explicit mount roots.
 */
function prepareComparisonCase(caseName) {
  const card = document.querySelector(`[data-comparison-case="${caseName}"]`);

  if (!(card instanceof HTMLElement)) {
    throw new Error(`Styling comparison case "${caseName}" is missing.`);
  }

  const fixtureHost = card.querySelector('[data-fixture-host]');
  const stage = card.querySelector('.comparison-stage');
  const scroller = card.querySelector('.comparison-scroller');

  if (!(fixtureHost instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
    throw new Error(`Styling comparison case "${caseName}" is incomplete.`);
  }

  fixtureHost.append(fixtureTemplate.content.cloneNode(true));

  return { fixtureHost, scroller, stage };
}

/**
 * Uses the fixture's visible title as the native marker title.
 *
 * @param {Element} element - Tracked fixture item or comparison heading.
 * @returns {string | null} Human-readable marker label.
 */
function resolveTargetLabel(element) {
  return element.querySelector('strong')?.textContent?.trim() ?? element.textContent?.trim() ?? null;
}

/** Explicit source, scroll, and render roots for the CSS-cascade comparison. */
const cascadeRoots = prepareComparisonCase('cascade');
/** Local Tracker styled through ordinary consumer CSS cascade rules. */
const cascadeTracker = new Tracker({
  options: {
    a11y: { enabled: true, keyboard: true, label: 'CSS cascade styling comparison' },
    clustering: { enabled: true, threshold: 7 },
    placement: 'right',
  },
  rules: [
    { selector: '.fixture-target--normal', label: resolveTargetLabel },
    {
      selector: '.fixture-target--warning',
      label: resolveTargetLabel,
      marker: { className: 'cascade-marker--warning' },
    },
    {
      selector: '.fixture-target--error',
      label: resolveTargetLabel,
      marker: { className: 'cascade-marker--error' },
    },
  ],
});
cascadeTracker.mount({
  renderHost: cascadeRoots.stage,
  scrollRoot: cascadeRoots.scroller,
  sourceRoot: cascadeRoots.fixtureHost,
});
trackers.push(cascadeTracker);

/** Explicit source, scroll, and render roots for the JavaScript-variable comparison. */
const variablesRoots = prepareComparisonCase('variables');
/** Local Tracker styled through public JavaScript CSS-variable options. */
const variablesTracker = new Tracker({
  options: {
    a11y: { enabled: true, keyboard: true, label: 'JavaScript variables styling comparison' },
    clustering: { enabled: true, threshold: 7 },
    cssVariables: {
      '--rxtt-cluster-bg': COMPARISON_COLORS.cluster,
      '--rxtt-cluster-text-color': '#fff',
      '--rxtt-marker-bg': COMPARISON_COLORS.marker,
      '--rxtt-marker-border-radius': '999px',
      '--rxtt-marker-min-size': '7px',
      '--rxtt-marker-ring-color': COMPARISON_COLORS.ring,
      '--rxtt-marker-ring-width': '2px',
      '--rxtt-track-bg': COMPARISON_COLORS.track,
      '--rxtt-track-border-color': COMPARISON_COLORS.trackBorder,
      '--rxtt-track-border-width': '1px',
      '--rxtt-track-thickness': '14px',
      '--rxtt-viewport-bg': COMPARISON_COLORS.viewport,
    },
    placement: 'right',
  },
  rules: [
    { selector: '.fixture-target--normal', label: resolveTargetLabel },
    {
      selector: '.fixture-target--warning',
      label: resolveTargetLabel,
      marker: { cssVariables: { '--rxtt-marker-bg': COMPARISON_COLORS.warning } },
    },
    {
      selector: '.fixture-target--error',
      label: resolveTargetLabel,
      marker: { cssVariables: { '--rxtt-marker-bg': COMPARISON_COLORS.error } },
    },
  ],
});
variablesTracker.mount({
  renderHost: variablesRoots.stage,
  scrollRoot: variablesRoots.scroller,
  sourceRoot: variablesRoots.fixtureHost,
});
trackers.push(variablesTracker);

/** Explicit source, scroll, and render roots for the public-class comparison. */
const classesRoots = prepareComparisonCase('classes');
/** Local Tracker styled through public track, viewport, and marker class hooks. */
const classesTracker = new Tracker({
  options: {
    a11y: { enabled: true, keyboard: true, label: 'Public classes styling comparison' },
    clustering: { enabled: true, threshold: 7 },
    marker: { className: 'class-theme-marker' },
    placement: 'right',
    track: { className: 'class-theme-track' },
    viewport: { className: 'class-theme-viewport' },
  },
  rules: [
    { selector: '.fixture-target--normal', label: resolveTargetLabel },
    {
      selector: '.fixture-target--warning',
      label: resolveTargetLabel,
      marker: { className: 'class-theme-marker--warning' },
    },
    {
      selector: '.fixture-target--error',
      label: resolveTargetLabel,
      marker: { className: 'class-theme-marker--error' },
    },
  ],
});
classesTracker.mount({
  renderHost: classesRoots.stage,
  scrollRoot: classesRoots.scroller,
  sourceRoot: classesRoots.fixtureHost,
});
trackers.push(classesTracker);

/** Explicit source, scroll, and render roots for the public-attribute comparison. */
const attributesRoots = prepareComparisonCase('attributes');
/** Local Tracker styled through public marker attributes and consumer selectors. */
const attributesTracker = new Tracker({
  options: {
    a11y: { enabled: true, keyboard: true, label: 'Selector and attribute styling comparison' },
    clustering: { enabled: true, threshold: 7 },
    marker: {
      attributes: {
        'data-attribute-scope': 'global',
        'data-comparison-theme': 'equivalent',
        'data-obsolete-style-hook': 'removed-after-mount',
      },
    },
    placement: 'right',
    track: { className: 'attribute-theme-track' },
    viewport: { className: 'attribute-theme-viewport' },
  },
  rules: [
    {
      selector: '.fixture-target--normal',
      label: resolveTargetLabel,
      marker: { attributes: { 'data-tone': 'normal' } },
    },
    {
      selector: '.fixture-target--warning',
      label: resolveTargetLabel,
      marker: {
        attributes: {
          'data-attribute-scope': null,
          'data-tone': 'warning',
        },
      },
    },
    {
      selector: '.fixture-target--error',
      label: resolveTargetLabel,
      marker: {
        attributes: {
          'data-attribute-scope': 'error-rule',
          'data-tone': 'error',
        },
      },
    },
  ],
});
attributesTracker.mount({
  renderHost: attributesRoots.stage,
  scrollRoot: attributesRoots.scroller,
  sourceRoot: attributesRoots.fixtureHost,
});
trackers.push(attributesTracker);
attributesTracker.patchOptions({
  marker: { attributes: { 'data-obsolete-style-hook': null } },
});

/** Minimal page-level Tracker styled as the left overview ruler. */
const rulerTracker = new Tracker({
  options: {
    a11y: { enabled: true, keyboard: true, label: 'Minimal ruler page navigation' },
    clustering: { enabled: false },
    marker: { className: 'ruler-marker' },
    placement: 'left',
    track: { className: 'ruler-track' },
    viewport: { className: 'ruler-viewport' },
  },
  rules: [{ selector: '.comparison-card__title', label: resolveTargetLabel }],
});
rulerTracker.mount({ renderHost: document.body, sourceRoot: document.body });
trackers.push(rulerTracker);

/** Page-level Tracker styled as the right neon rail. */
const neonTracker = new Tracker({
  options: {
    a11y: { enabled: true, keyboard: true, label: 'Neon rail page navigation' },
    clustering: { enabled: false },
    marker: { className: 'neon-marker' },
    placement: 'right',
    track: { className: 'neon-track' },
    viewport: { className: 'neon-viewport' },
  },
  rules: [{ selector: '.comparison-card__title', label: resolveTargetLabel }],
});
neonTracker.mount({ renderHost: document.body, sourceRoot: document.body });
trackers.push(neonTracker);

window.addEventListener(
  'pagehide',
  () => {
    for (const tracker of trackers) {
      tracker.destroy();
    }
  },
  { once: true },
);
