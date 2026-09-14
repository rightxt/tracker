import { isElement } from '../dom/element.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import { cloneValue } from '../utils/object.js';
import type {
  TrackerDiagnosticCode,
  TrackerMarkerRecord,
  TrackerMarkerRecordContext,
  TrackerNormalizedRule,
  TrackerQueryMatch,
} from '../types.js';

/**
 * Creates an internal MarkerRecord from a query match.
 *
 * The function computes label at record creation time. It does not create DOM
 * marker elements, does not measure geometry and does not perform scroll or
 * focus side effects.
 *
 * Record keys come from `context.getElementKey`. Without that provider the
 * fallback key is derived from the rule index and selector only, so it is
 * stable and unique only when a rule matches at most one element.
 *
 * @param match - Query match.
 * @param context - Marker creation context.
 * @returns Marker record or null when match is invalid.
 */
function createMarkerRecord(
  match: TrackerQueryMatch,
  context: TrackerMarkerRecordContext = {},
): TrackerMarkerRecord | null {
  if (!match || !isElement(match.element) || !match.rule) {
    return null;
  }

  const { element, rule } = match;
  const diagnostics = context.diagnostics || null;
  const key =
    typeof context.getElementKey === 'function'
      ? context.getElementKey(element)
      : `${rule.index ?? match.ruleIndex ?? 0}:${rule.selector}`;

  const label = resolveLabel(element, rule, diagnostics);
  return {
    kind: 'marker',
    key,
    element,
    rule,
    ruleIndex: Number.isInteger(match.ruleIndex) ? match.ruleIndex : (rule.index ?? 0),
    selector: rule.selector,
    label,
    scroll: cloneValue(rule.scroll),
    focus: cloneValue(rule.focus),
    cluster: null,
  };
}

/**
 * Resolves a marker label from a rule label option.
 *
 * @param element - Source DOM element.
 * @param rule - Normalized rule.
 * @param diagnostics - Diagnostics layer.
 * @returns Computed label.
 */
function resolveLabel(
  element: Element,
  rule: TrackerNormalizedRule,
  diagnostics: {
    error?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
  } | null,
): string | null {
  if (typeof rule.label === 'string') {
    return rule.label;
  }

  if (typeof rule.label !== 'function') {
    return null;
  }

  try {
    const label = (rule.label as (el: Element) => unknown)(element);

    return typeof label === 'string' ? label : null;
  } catch (error) {
    diagnostics?.error?.('rule-label-error', `Rule label function failed for selector "${rule.selector}".`, {
      selector: rule.selector,
      error: getErrorMessage(error),
    });

    return null;
  }
}

export { createMarkerRecord };
