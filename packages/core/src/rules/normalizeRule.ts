import type { TrackerNormalizedRuleCandidate, TrackerRuleNormalizationContext, TrackerRuleSource } from '../types.js';
import { cloneValue, isPlainObject } from '../utils/object.js';
import { normalizeSelector } from '../utils/selector.js';

/**
 * Creates a source rule snapshot for public getRules().
 *
 * The snapshot keeps public rule semantics and stores the normalized selector so
 * getRules() reflects the selector uniqueness contract. Nested plain data is
 * deep-copied so later mutation of the user input cannot change the snapshot;
 * callback functions are preserved by reference.
 *
 * @param rule - Public rule candidate.
 * @param selector - Normalized selector.
 */
function createSourceRule(rule: unknown, selector: string): TrackerRuleSource {
  if (!isPlainObject(rule)) {
    return { selector };
  }

  const source = cloneValue(rule) as TrackerRuleSource;

  source.selector = selector;

  return source;
}

/**
 * Normalizes shorthand focus options.
 *
 * Boolean values are treated as enabled flags. Object values override defaults.
 * Invalid known values are preserved for validateRule().
 *
 * @param focus - Public focus option candidate.
 */
function normalizeFocus(focus: unknown): TrackerNormalizedRuleCandidate['focus'] {
  if (focus === undefined) {
    return { enabled: false, target: 'self' };
  }

  if (typeof focus === 'boolean') {
    return {
      enabled: focus,
      target: 'self',
    };
  }

  const focusOptions = isPlainObject(focus) ? focus : null;

  return {
    enabled: focusOptions === null ? (focus as never) : 'enabled' in focusOptions ? focusOptions.enabled : false,
    target: focusOptions === null ? 'self' : 'target' in focusOptions ? focusOptions.target : 'self',
  };
}

/**
 * Normalizes rule label configuration.
 *
 * Labels may be static strings, functions, null or invalid values. Invalid
 * values are preserved for validateRule() or later marker creation decisions.
 *
 * @param rule - Public rule candidate.
 */
function normalizeLabel(rule: unknown): unknown {
  if (!isPlainObject(rule) || !('label' in rule)) {
    return null;
  }

  return rule.label;
}

/**
 * Normalizes marker options while preserving invalid known values for
 * validateRule().
 *
 * @param marker - Public marker options candidate.
 */
function normalizeMarker(marker: unknown): TrackerNormalizedRuleCandidate['marker'] {
  if (marker === undefined) {
    return {
      className: '',
      title: undefined,
      attributes: {},
      cssVariables: {},
    };
  }

  const markerOptions = isPlainObject(marker) ? marker : null;

  return {
    className: markerOptions === null ? (marker as never) : 'className' in markerOptions ? markerOptions.className : '',
    title: markerOptions === null ? undefined : 'title' in markerOptions ? markerOptions.title : undefined,
    attributes: markerOptions === null ? {} : 'attributes' in markerOptions ? cloneValue(markerOptions.attributes) : {},
    cssVariables:
      markerOptions === null || !('cssVariables' in markerOptions) ? {} : cloneValue(markerOptions.cssVariables),
  };
}

/**
 * Normalizes a public rule into the internal rule shape.
 *
 * This function performs no DOM reads and does not validate selector syntax
 * through querySelector(). Validation is handled by validateRule().
 *
 * @param rule - Public rule candidate.
 * @param context - Normalization context.
 */
function normalizeRule(rule: unknown, context: TrackerRuleNormalizationContext = {}): TrackerNormalizedRuleCandidate {
  const index = Number.isInteger(context.index) ? (context.index as number) : 0;
  const selector = normalizeSelector(isPlainObject(rule) ? rule.selector : '');

  return {
    index,
    selector,
    label: normalizeLabel(rule),
    marker: normalizeMarker(isPlainObject(rule) ? rule.marker : undefined),
    scroll: normalizeScroll(isPlainObject(rule) ? rule.scroll : undefined),
    focus: normalizeFocus(isPlainObject(rule) ? rule.focus : undefined),
    source: createSourceRule(rule, selector),
  };
}

/**
 * Normalizes shorthand scroll options.
 *
 * Boolean values are treated as enabled flags. Object values override defaults.
 * Invalid known values are preserved for validateRule().
 *
 * @param scroll - Public scroll option candidate.
 */
function normalizeScroll(scroll: unknown): TrackerNormalizedRuleCandidate['scroll'] {
  if (scroll === undefined) {
    return { enabled: true, target: 'self', behavior: 'auto', align: 'start' };
  }

  if (typeof scroll === 'boolean') {
    return {
      enabled: scroll,
      target: 'self',
      behavior: 'auto',
      align: 'start',
    };
  }

  const scrollOptions = isPlainObject(scroll) ? scroll : null;

  return {
    enabled: scrollOptions === null ? (scroll as never) : 'enabled' in scrollOptions ? scrollOptions.enabled : true,
    target: scrollOptions === null ? 'self' : 'target' in scrollOptions ? scrollOptions.target : 'self',
    behavior: scrollOptions === null ? 'auto' : 'behavior' in scrollOptions ? scrollOptions.behavior : 'auto',
    align: scrollOptions === null ? 'start' : 'align' in scrollOptions ? scrollOptions.align : 'start',
  };
}

export { normalizeRule };
