import { createDiagnostic } from '../utils/diagnostic.js';
import { collectUnknownKeys, findFirstOwnUndefinedPath } from '../utils/object.js';
import type { TrackerValidationDiagnostic } from '../types.js';

/**
 * Allowed rule shape used for unknown-key detection on raw public rule input.
 */
const ALLOWED_RULE_SHAPE: Readonly<Record<string, unknown>> = Object.freeze({
  focus: {
    enabled: true,
    target: true,
  },
  label: true,
  marker: {
    attributes: true,
    className: true,
    cssVariables: true,
    title: true,
  },
  scroll: {
    align: true,
    behavior: true,
    enabled: true,
    target: true,
  },
  selector: true,
});

/**
 * Builds a `WARN_TRACKER_UNKNOWN_RULE_OPTION` warning diagnostic for every
 * key of a raw public rule that is not part of {@link ALLOWED_RULE_SHAPE}.
 *
 * @param rule - Raw public rule candidate.
 * @param details - Extra diagnostic details merged into every warning (e.g. a list index).
 * @returns Unknown-key warning diagnostics.
 */
function collectUnknownRuleOptionDiagnostics(
  rule: unknown,
  details: Record<string, unknown> = {},
): TrackerValidationDiagnostic[] {
  return collectUnknownKeys(rule, ALLOWED_RULE_SHAPE).map((path) =>
    createDiagnostic('warning', 'WARN_TRACKER_UNKNOWN_RULE_OPTION', `Unknown rule option "${path}" was ignored.`, {
      ...details,
      path,
    }),
  );
}

/**
 * Builds an `invalid-rule-option-value` error diagnostic when a raw public
 * rule has a known field explicitly set to `undefined`.
 *
 * @param rule - Raw public rule candidate.
 * @param details - Extra diagnostic details merged into the diagnostic (e.g. a list index).
 * @returns A single-entry array with the diagnostic, or an empty array when no field is explicitly `undefined`.
 */
function collectOwnUndefinedRuleFieldDiagnostic(
  rule: unknown,
  details: Record<string, unknown> = {},
): TrackerValidationDiagnostic[] {
  const path = findFirstOwnUndefinedPath(rule, ALLOWED_RULE_SHAPE);

  if (path === null) {
    return [];
  }

  return [
    createDiagnostic('error', 'invalid-rule-option-value', `Rule option "${path}" must not be undefined.`, {
      ...details,
      path,
    }),
  ];
}

export { ALLOWED_RULE_SHAPE, collectOwnUndefinedRuleFieldDiagnostic, collectUnknownRuleOptionDiagnostics };
