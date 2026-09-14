import type {
  TrackerNormalizedRule,
  TrackerRuleValidationContext,
  TrackerRulesValidationResult,
  TrackerValidationDiagnostic,
} from '../types.js';
import { normalizeRule } from './normalizeRule.js';
import { collectOwnUndefinedRuleFieldDiagnostic, collectUnknownRuleOptionDiagnostics } from './ruleSchema.js';
import { validateNormalizedRule } from './validateRule.js';
import { createDiagnostic } from '../utils/diagnostic.js';

/**
 * Validates a complete ordered rule list without mutating runtime state.
 *
 * @param rules - Public rule-list candidate.
 * @param context - Rule defaults and selector validation context.
 * @returns Normalized rules and every validation diagnostic.
 */
function validateRules(rules: unknown, context: TrackerRuleValidationContext = {}): TrackerRulesValidationResult {
  if (!Array.isArray(rules)) {
    const diagnostic = createDiagnostic('error', 'invalid-rules', 'Rules must be an array.');

    return {
      diagnostics: [diagnostic],
      errors: [diagnostic],
      rules: [],
      valid: false,
      warnings: [],
    };
  }

  const diagnostics: TrackerValidationDiagnostic[] = [];
  const normalizedRules: TrackerNormalizedRule[] = [];
  const selectors = new Set<string>();
  let hadRejectedRule = false;

  for (let inputIndex = 0; inputIndex < rules.length; inputIndex += 1) {
    if (!(inputIndex in rules)) {
      hadRejectedRule = true;
      diagnostics.push(
        createDiagnostic('error', 'invalid-rule', 'Rule list must not contain empty entries.', {
          index: inputIndex,
        }),
      );
      continue;
    }

    const undefinedFieldDiagnostics = collectOwnUndefinedRuleFieldDiagnostic(rules[inputIndex], {
      index: inputIndex,
    });

    if (undefinedFieldDiagnostics.length > 0) {
      hadRejectedRule = true;
      diagnostics.push(...undefinedFieldDiagnostics);
      continue;
    }

    diagnostics.push(...collectUnknownRuleOptionDiagnostics(rules[inputIndex], { index: inputIndex }));

    const result = validateNormalizedRule(
      normalizeRule(rules[inputIndex], {
        index: normalizedRules.length,
      }),
      {
        ...context,
        hasSelector: (selector) => selectors.has(selector),
      },
    );

    diagnostics.push(...result.diagnostics);

    if (result.valid && result.rule !== null) {
      normalizedRules.push(result.rule);
      selectors.add(result.rule.selector);
    } else {
      hadRejectedRule = true;
    }
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.type === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.type === 'warning');

  return {
    diagnostics,
    errors,
    rules: normalizedRules,
    valid: errors.length === 0 && !hadRejectedRule,
    warnings,
  };
}

export { validateRules };
