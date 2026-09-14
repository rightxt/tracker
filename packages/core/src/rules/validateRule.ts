import type {
  TrackerNormalizedMarkerOptions,
  TrackerNormalizedRule,
  TrackerNormalizedRuleCandidate,
  TrackerRuleCssVariables,
  TrackerRuleValidationContext,
  TrackerRuleValidationResult,
  TrackerValidationDiagnostic,
} from '../types.js';
import { SCROLL_ALIGNS, SCROLL_BEHAVIORS } from '../constants.js';
import {
  getCssVariableNameError,
  isCssVariableMap,
  isRuleCssVariableValue,
  normalizeRuleCssVariables,
} from '../config/cssVariables.js';
import {
  cloneNormalizedMarkerAttributes,
  createPublicMarkerAttributes,
  isNormalizedMarkerAttributes,
  normalizeMarkerAttributes,
} from '../config/markerAttributes.js';
import type { TrackerMarkerAttributeIssue } from '../config/markerAttributes.js';
import { createDiagnostic } from '../utils/diagnostic.js';
import { hasOwn, isPlainObject } from '../utils/object.js';
import { isNonEmptyString } from '../utils/predicates.js';
import { getSelectorError } from '../utils/selector.js';
import { getReservedClassToken, normalizeUserClassName } from '../utils/className.js';
import { normalizeRule } from './normalizeRule.js';
import { collectOwnUndefinedRuleFieldDiagnostic, collectUnknownRuleOptionDiagnostics } from './ruleSchema.js';

/**
 * Validates the static or computed rule label.
 *
 * @param rule - Mutable normalized rule.
 * @param diagnostics - Mutable diagnostics array.
 */
function validateLabel(rule: TrackerNormalizedRuleCandidate, diagnostics: TrackerValidationDiagnostic[]): void {
  if (rule.label === null || typeof rule.label === 'string' || typeof rule.label === 'function') {
    return;
  }

  diagnostics.push(
    createDiagnostic('error', 'invalid-rule-label', 'Rule label must be a string, function, or null.', {
      label: rule.label,
    }),
  );
}

/**
 * Checks whether a normalized rule has a selector already stored by RuleStore.
 *
 * @param rule - Normalized rule.
 * @param context - Validation context.
 */
function hasDuplicateSelector(rule: TrackerNormalizedRuleCandidate, context: TrackerRuleValidationContext): boolean {
  return typeof context.hasSelector === 'function' && context.hasSelector(rule.selector);
}

/**
 * Checks whether a value is an allowed marker target spec.
 *
 * @param target - Target candidate.
 */
function isValidTargetSpec(target: unknown): boolean {
  return target === 'self' || isNonEmptyString(target) || typeof target === 'function';
}

/**
 * Validates focus options and applies safe fallbacks to the normalized rule.
 *
 * @param rule - Mutable normalized rule.
 * @param diagnostics - Mutable diagnostics array.
 */
function validateFocus(rule: TrackerNormalizedRuleCandidate, diagnostics: TrackerValidationDiagnostic[]): void {
  if (typeof rule.focus.enabled !== 'boolean') {
    rule.focus.enabled = false;

    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-focus',
        'rule.focus.enabled must be a boolean. Fallback value was applied.',
        { selector: rule.selector },
      ),
    );
  }

  if (!isValidTargetSpec(rule.focus.target)) {
    rule.focus.target = 'self';

    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-focus-target',
        'rule.focus.target must be "self", a selector string or a function.',
        { selector: rule.selector },
      ),
    );
  }
}

/**
 * Validates marker options and applies safe fallbacks to the normalized rule.
 *
 * @param rule - Mutable normalized rule.
 * @param context - Validation context.
 * @param diagnostics - Mutable diagnostics array.
 */
function validateMarker(
  rule: TrackerNormalizedRuleCandidate,
  context: TrackerRuleValidationContext,
  diagnostics: TrackerValidationDiagnostic[],
): void {
  if (typeof rule.marker.className !== 'string') {
    rule.marker.className = '';

    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-marker-class-name',
        'rule.marker.className must be a string. Fallback value was applied.',
        { selector: rule.selector },
      ),
    );
  } else {
    const reservedToken = getReservedClassToken(rule.marker.className);

    if (reservedToken !== null) {
      rule.marker.className = '';

      diagnostics.push(
        createDiagnostic(
          'warning',
          'reserved-rule-marker-class-name',
          `rule.marker.className contains reserved service class token "${reservedToken}".`,
          { selector: rule.selector, token: reservedToken },
        ),
      );
    } else {
      rule.marker.className = normalizeUserClassName(rule.marker.className);
    }
  }

  if (rule.marker.title !== undefined && typeof rule.marker.title !== 'boolean') {
    rule.marker.title = undefined;

    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-marker-title',
        'rule.marker.title must be a boolean. Fallback value was applied.',
        { selector: rule.selector },
      ),
    );
  }

  rule.marker.attributes = validateMarkerAttributes(rule.marker.attributes, diagnostics);

  rule.marker.cssVariables = validateRuleMarkerCssVariables(rule.marker.cssVariables, rule.selector, diagnostics);

  normalizeRuleMarkerSource(rule);
}

/**
 * Validates and filters custom marker attributes.
 *
 * @param attributes - Attribute candidates.
 * @param diagnostics - Mutable diagnostics array.
 * @returns Safe attributes.
 */
function validateMarkerAttributes(
  attributes: unknown,
  diagnostics: TrackerValidationDiagnostic[],
): TrackerNormalizedMarkerOptions['attributes'] {
  if (isNormalizedMarkerAttributes(attributes)) {
    return cloneNormalizedMarkerAttributes(attributes);
  }

  const result = normalizeMarkerAttributes(attributes);

  result.issues.forEach((issue) => {
    diagnostics.push(createRuleMarkerAttributeDiagnostic(issue));
  });

  return result.attributes;
}

/**
 * Creates a stable diagnostic for one rule marker attribute issue.
 *
 * @param issue - Attribute normalization issue.
 * @returns Validation diagnostic.
 */
function createRuleMarkerAttributeDiagnostic(issue: TrackerMarkerAttributeIssue): TrackerValidationDiagnostic {
  const details = {
    name: issue.name,
    normalizedName: issue.normalizedName,
    value: issue.value,
  };
  const issueName = issue.name || 'rule.marker.attributes';

  if (issue.kind === 'collision') {
    return createDiagnostic(
      'warning',
      'marker-attribute-name-collision',
      `Marker attribute "${issueName}" collides with another key after ASCII lowercasing.`,
      details,
    );
  }

  if (issue.kind === 'reserved') {
    return createDiagnostic(
      'warning',
      'reserved-marker-attribute',
      `Marker attribute "${issueName}" is reserved by Tracker.`,
      details,
    );
  }

  if (issue.kind === 'value') {
    return createDiagnostic(
      'warning',
      'invalid-marker-attribute-value',
      `Marker attribute "${issueName}" has an invalid value.`,
      details,
    );
  }

  return createDiagnostic(
    'warning',
    'invalid-marker-attribute',
    `Marker attribute "${issueName}" does not match the supported attribute grammar.`,
    details,
  );
}

/**
 * Validates a complete rule marker custom-property map.
 *
 * @param variables - Map candidate.
 * @param selector - Rule selector used in diagnostics.
 * @param diagnostics - Mutable diagnostics array.
 * @returns Valid custom-property values.
 */
function validateRuleMarkerCssVariables(
  variables: unknown,
  selector: string,
  diagnostics: TrackerValidationDiagnostic[],
): TrackerRuleCssVariables {
  if (!isCssVariableMap(variables)) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-marker-css-variables',
        'rule.marker.cssVariables must be a plain object.',
        { selector, variables },
      ),
    );
    return {};
  }

  const accepted: Record<string, unknown> = {};

  Object.entries(variables).forEach(([name, value]) => {
    const nameError = getCssVariableNameError(name, 'rule-marker');

    if (nameError !== null) {
      diagnostics.push(
        createDiagnostic('warning', 'invalid-rule-css-variable-name', nameError, {
          name,
          selector,
        }),
      );
    }

    if (!isRuleCssVariableValue(value)) {
      diagnostics.push(
        createDiagnostic(
          'warning',
          'invalid-rule-css-variable-value',
          `rule.marker.cssVariables.${name} must be a string.`,
          { name, selector, value },
        ),
      );
    }

    // Only entries whose name is accepted at rule-marker scope and whose value
    // is a string reach the normalized rule; an invalid name is reported and
    // dropped rather than forwarded verbatim.
    if (nameError === null && isRuleCssVariableValue(value)) {
      accepted[name] = value;
    }
  });

  return normalizeRuleCssVariables(accepted);
}

/**
 * Rewrites public rule marker fields to their normalized round-trip-safe form.
 *
 * @param rule - Mutable normalized rule candidate.
 */
function normalizeRuleMarkerSource(rule: TrackerNormalizedRuleCandidate): void {
  if (!isPlainObject(rule.source.marker)) {
    return;
  }

  if (hasOwn(rule.source.marker, 'className')) {
    rule.source.marker.className = rule.marker.className as string;
  }

  if (hasOwn(rule.source.marker, 'attributes')) {
    rule.source.marker.attributes = createPublicMarkerAttributes(
      rule.marker.attributes as TrackerNormalizedMarkerOptions['attributes'],
    );
  }

  if (hasOwn(rule.source.marker, 'cssVariables')) {
    rule.source.marker.cssVariables = {
      ...(rule.marker.cssVariables as TrackerRuleCssVariables),
    };
  }

  if (hasOwn(rule.source.marker, 'title')) {
    rule.source.marker.title = rule.marker.title as boolean | undefined;
  }
}

/**
 * Validates a normalized rule.
 *
 * Invalid selectors make the rule invalid. Invalid optional fields are sanitized
 * where possible and reported as warnings.
 *
 * @param rule - Normalized rule candidate.
 * @param context - Validation context.
 */
function validateNormalizedRule(
  rule: unknown,
  context: TrackerRuleValidationContext = {},
): TrackerRuleValidationResult {
  const diagnostics: TrackerValidationDiagnostic[] = [];

  if (!isPlainObject(rule)) {
    diagnostics.push(createDiagnostic('error', 'invalid-rule', 'Rule must be an object.'));

    return {
      valid: false,
      rule: null,
      diagnostics,
      warnings: [],
      errors: diagnostics,
    };
  }

  if (typeof rule.selector !== 'string' || rule.selector === '') {
    diagnostics.push(
      createDiagnostic('error', 'invalid-rule-selector', 'Rule selector must be a non-empty string.', {
        selector: rule.selector,
      }),
    );

    return {
      valid: false,
      rule: null,
      diagnostics,
      warnings: [],
      errors: diagnostics,
    };
  }

  const selectorError = getSelectorError(rule.selector, context.selectorRoot ?? null);

  if (selectorError !== null) {
    diagnostics.push(
      createDiagnostic(
        'error',
        'invalid-rule-selector',
        `Rule selector "${rule.selector}" is not a valid CSS selector.`,
        {
          selector: rule.selector,
          error: selectorError.message,
        },
      ),
    );

    return {
      valid: false,
      rule: null,
      diagnostics,
      warnings: [],
      errors: diagnostics,
    };
  }

  const normalizedRule = rule as unknown as TrackerNormalizedRuleCandidate;

  if (hasDuplicateSelector(normalizedRule, context)) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'duplicate-rule-selector',
        `Rule selector "${rule.selector}" already exists and was ignored.`,
        { selector: rule.selector },
      ),
    );

    return {
      valid: false,
      rule: null,
      diagnostics,
      warnings: diagnostics,
      errors: [],
    };
  }

  validateLabel(normalizedRule, diagnostics);
  validateMarker(normalizedRule, context, diagnostics);
  validateScroll(normalizedRule, diagnostics);
  validateFocus(normalizedRule, diagnostics);

  const warnings = diagnostics.filter((item) => item.type === 'warning');
  const errors = diagnostics.filter((item) => item.type === 'error');

  return {
    valid: errors.length === 0,
    rule: normalizedRule as unknown as TrackerNormalizedRule,
    diagnostics,
    warnings,
    errors,
  };
}

/**
 * Validates a raw public rule after applying the same safe normalization used
 * by complete rule-list validation.
 *
 * @param rule - Raw public rule candidate.
 * @param context - Validation context.
 * @returns Normalized rule and validation diagnostics.
 */
function validateRule(rule: unknown, context: TrackerRuleValidationContext = {}): TrackerRuleValidationResult {
  if (!isPlainObject(rule)) {
    return validateNormalizedRule(rule, context);
  }

  const undefinedFieldDiagnostics = collectOwnUndefinedRuleFieldDiagnostic(rule);

  if (undefinedFieldDiagnostics.length > 0) {
    return {
      valid: false,
      rule: null,
      diagnostics: undefinedFieldDiagnostics,
      warnings: [],
      errors: undefinedFieldDiagnostics,
    };
  }

  const unknownKeyDiagnostics = collectUnknownRuleOptionDiagnostics(rule);
  const result = validateNormalizedRule(normalizeRule(rule), context);

  if (unknownKeyDiagnostics.length === 0) {
    return result;
  }

  return {
    ...result,
    diagnostics: [...unknownKeyDiagnostics, ...result.diagnostics],
    warnings: [...unknownKeyDiagnostics, ...result.warnings],
  };
}

/**
 * Validates scroll options and applies safe fallbacks to the normalized rule.
 *
 * @param rule - Mutable normalized rule.
 * @param diagnostics - Mutable diagnostics array.
 */
function validateScroll(rule: TrackerNormalizedRuleCandidate, diagnostics: TrackerValidationDiagnostic[]): void {
  if (typeof rule.scroll.enabled !== 'boolean') {
    rule.scroll.enabled = true;

    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-scroll',
        'rule.scroll.enabled must be a boolean. Fallback value was applied.',
        { selector: rule.selector },
      ),
    );
  }

  if (!isValidTargetSpec(rule.scroll.target)) {
    rule.scroll.target = 'self';

    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-scroll-target',
        'rule.scroll.target must be "self", a selector string or a function.',
        { selector: rule.selector },
      ),
    );
  }

  if (!SCROLL_BEHAVIORS.includes(rule.scroll.behavior as string)) {
    rule.scroll.behavior = 'auto';

    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-scroll-behavior',
        'rule.scroll.behavior must be "auto" or "smooth". Fallback value was applied.',
        { selector: rule.selector },
      ),
    );
  }

  if (!SCROLL_ALIGNS.includes(rule.scroll.align as string)) {
    rule.scroll.align = 'start';

    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-rule-scroll-align',
        'rule.scroll.align must be "start", "center", "end" or "nearest". Fallback value was applied.',
        { selector: rule.selector },
      ),
    );
  }
}

export { validateNormalizedRule, validateRule };
