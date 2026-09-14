import type {
  TrackerDiagnosticCode,
  TrackerNormalizedRule,
  TrackerRule,
  TrackerRuleValidationResult,
  TrackerSourceRoot,
  TrackerValidationDiagnostic,
} from '../types.js';
import { assertConfigurationDiagnostics } from '../config/assertConfigurationDiagnostics.js';
import { areNormalizedMarkerAttributesEqual } from '../config/markerAttributes.js';
import { normalizeRule } from './normalizeRule.js';
import { collectOwnUndefinedRuleFieldDiagnostic, collectUnknownRuleOptionDiagnostics } from './ruleSchema.js';
import { validateNormalizedRule } from './validateRule.js';
import { validateRules } from './validateRules.js';
import { dispatchDiagnostics } from '../utils/diagnostic.js';
import { areValuesEqual, clonePublicRule, cloneValue } from '../utils/object.js';
import { normalizeSelector } from '../utils/selector.js';

interface RuleStoreDiagnostics {
  warn: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown> | null) => void;
  error: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown> | null) => void;
  recordRule?: (counterName: 'added' | 'removed' | 'cleared' | 'rejected' | 'duplicates', amount?: number) => void;
}

interface RuleStoreContext {
  diagnostics?: RuleStoreDiagnostics | null;
  selectorRoot?: TrackerSourceRoot | null;
}

interface RuleStoreSingleResult {
  changed: boolean;
  rule: TrackerNormalizedRule | null;
  diagnostics: TrackerValidationDiagnostic[];
}

interface RuleStoreClearResult {
  changed: boolean;
  diagnostics: TrackerValidationDiagnostic[];
}

interface RuleStoreListResult {
  changed: boolean;
  rules: TrackerNormalizedRule[];
  diagnostics: TrackerValidationDiagnostic[];
}

/** Mount-time rule revalidation candidate that has not mutated public store state. */
interface RuleStoreStagedResult extends RuleStoreListResult {
  /** Public rule snapshot corresponding to the staged normalized rules. */
  publicRules: TrackerRule[];
  /** Number of rules rejected by context-dependent validation. */
  rejected: number;
  /** Number of duplicate selectors rejected by validation. */
  duplicates: number;
}

/**
 * Compares normalized focus options.
 *
 * Target values may be strings or functions. Functions are compared by
 * reference, which is the only safe and predictable comparison strategy.
 */
function areFocusOptionsEqual(left: TrackerNormalizedRule['focus'], right: TrackerNormalizedRule['focus']): boolean {
  return left.enabled === right.enabled && left.target === right.target;
}

/**
 * Compares normalized marker options.
 */
function areMarkerOptionsEqual(left: TrackerNormalizedRule['marker'], right: TrackerNormalizedRule['marker']): boolean {
  return (
    left.className === right.className &&
    left.title === right.title &&
    areNormalizedMarkerAttributesEqual(left.attributes, right.attributes) &&
    areValuesEqual(left.cssVariables, right.cssVariables)
  );
}

/**
 * Compares ordered normalized rule arrays.
 */
function areRuleListsEqual(leftRules: TrackerNormalizedRule[], rightRules: TrackerNormalizedRule[]): boolean {
  if (leftRules.length !== rightRules.length) {
    return false;
  }

  return leftRules.every((rule, index) => areRulesEqual(rule, rightRules[index]));
}

/**
 * Compares public source payloads of ordered normalized rule arrays.
 *
 * Sources are compared structurally. Functions inside user rules are compared
 * by reference, which is the only safe and predictable comparison strategy.
 */
function areRuleSourceListsEqual(leftRules: TrackerNormalizedRule[], rightRules: TrackerNormalizedRule[]): boolean {
  if (leftRules.length !== rightRules.length) {
    return false;
  }

  return leftRules.every((rule, index) => areValuesEqual(rule.source, rightRules[index].source));
}

/**
 * Compares normalized rules by behaviorally relevant fields.
 *
 * The comparison intentionally ignores source object identity and rule.index.
 * Index is derived from array position, and source is a public-copy payload used
 * for getPublicRules(), not for runtime behavior.
 */
function areRulesEqual(
  left: TrackerNormalizedRule | null | undefined,
  right: TrackerNormalizedRule | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.selector === right.selector &&
    left.label === right.label &&
    areMarkerOptionsEqual(left.marker, right.marker) &&
    areScrollOptionsEqual(left.scroll, right.scroll) &&
    areFocusOptionsEqual(left.focus, right.focus)
  );
}

/**
 * Compares normalized scroll options.
 *
 * Target values may be strings or functions. Functions are compared by
 * reference, which is the only safe and predictable comparison strategy.
 */
function areScrollOptionsEqual(left: TrackerNormalizedRule['scroll'], right: TrackerNormalizedRule['scroll']): boolean {
  return (
    left.enabled === right.enabled &&
    left.target === right.target &&
    left.behavior === right.behavior &&
    left.align === right.align
  );
}

/**
 * Creates a selector set from normalized rules.
 */
function createSelectorSet(rules: TrackerNormalizedRule[]): Set<string> {
  return new Set(rules.map((rule) => rule.selector));
}

/**
 * Checks whether a value is a valid insertion index.
 *
 * @param index - Index candidate.
 * @param length - Current array length.
 */
function isValidInsertionIndex(index: unknown, length: number): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= length;
}

/**
 * Checks whether a value is a valid removal index.
 *
 * @param index - Index candidate.
 * @param length - Current array length.
 */
function isValidRemovalIndex(index: unknown, length: number): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < length;
}

/**
 * Assigns rule indexes according to the current order.
 */
function reindexRules(rules: TrackerNormalizedRule[]): void {
  rules.forEach((rule, index) => {
    (rule as { index: number }).index = index;
  });
}

/**
 * Stores normalized rules and enforces selector uniqueness.
 *
 * Rule order is priority order. Uniqueness is defined only by selector.trim().
 * This class does not perform DOM search.
 */
class RuleStore {
  /** Rule store context. */
  #context: RuleStoreContext;

  /** Ordered normalized rule list. */
  #rules: TrackerNormalizedRule[] = [];

  /** Selector uniqueness index. */
  #selectors = new Set<string>();

  /**
   * @param context - Rule store context.
   */
  constructor(context: RuleStoreContext = {}) {
    this.#context = {
      diagnostics: context.diagnostics ?? null,
      selectorRoot: context.selectorRoot ?? null,
    };
  }

  /**
   * Returns the number of stored rules.
   */
  get size(): number {
    return this.#rules.length;
  }

  /**
   * Adds a rule to the ordered rule list.
   *
   * @param rule - Public rule candidate.
   * @param index - Optional insertion index.
   */
  add(rule: unknown, index?: number): RuleStoreSingleResult {
    if (index !== undefined && !isValidInsertionIndex(index, this.#rules.length)) {
      assertConfigurationDiagnostics(
        [
          {
            type: 'warning',
            code: 'invalid-rule-index',
            message: 'Rule insertion index is out of range.',
            details: { index, size: this.#rules.length },
          },
        ],
        'Tracker rule',
      );
    }

    const insertionIndex = index ?? this.#rules.length;

    const result = this.#normalizeAndValidateRule(rule, insertionIndex, this.#selectors);

    assertConfigurationDiagnostics(result.diagnostics, 'Tracker rule');

    if (!result.valid || result.rule === null) {
      return {
        changed: false,
        rule: null,
        diagnostics: result.diagnostics,
      };
    }

    this.#rules.splice(insertionIndex, 0, result.rule);
    this.#selectors.add(result.rule.selector);
    reindexRules(this.#rules);

    this.#context.diagnostics?.recordRule?.('added');

    return {
      changed: true,
      rule: result.rule,
      diagnostics: result.diagnostics,
    };
  }

  /**
   * Validates a rule candidate without adding it to the stored rule list.
   *
   * Mirrors the validation performed by {@link add}, discarding the normalized
   * result. Intended as a synchronous pre-check before an addRule() call that
   * may be deferred for execution during reentrant dispatch, so an invalid
   * candidate throws visibly to the original caller instead of only surfacing
   * through deferred-operation diagnostics.
   *
   * @param rule - Public rule candidate.
   * @param index - Optional insertion index used only for diagnostic context.
   * @param selectors - Selector set to check for duplicates against, in place
   *   of the committed store. Passed by callers that project queued but
   *   not-yet-committed rule mutations onto the committed selector list.
   * @param collectionSize - Ordered collection size used for index validation.
   * @throws TrackerConfigurationError when the candidate fails validation.
   */
  validateCandidate(
    rule: unknown,
    index?: number,
    selectors?: ReadonlySet<string>,
    collectionSize = this.#rules.length,
  ): void {
    if (index !== undefined && !isValidInsertionIndex(index, collectionSize)) {
      assertConfigurationDiagnostics(
        [
          {
            type: 'warning',
            code: 'invalid-rule-index',
            message: 'Rule insertion index is out of range.',
            details: { index, size: collectionSize },
          },
        ],
        'Tracker rule',
      );
    }

    const insertionIndex = isValidInsertionIndex(index, collectionSize) ? index : collectionSize;
    const result = this.#normalizeAndValidateRule(rule, insertionIndex, selectors ?? this.#selectors);

    assertConfigurationDiagnostics(result.diagnostics, 'Tracker rule');
  }

  /**
   * Clears all rules.
   */
  clear(): RuleStoreClearResult {
    if (this.#rules.length === 0) {
      return {
        changed: false,
        diagnostics: [],
      };
    }

    this.#rules = [];
    this.#selectors.clear();

    this.#context.diagnostics?.recordRule?.('cleared');

    return {
      changed: true,
      diagnostics: [],
    };
  }

  /**
   * Releases stored rules and validation context without recording diagnostics.
   */
  destroy(): void {
    this.#rules = [];
    this.#selectors.clear();
    this.#context = {
      diagnostics: null,
      selectorRoot: null,
    };
  }

  /**
   * Returns internal normalized rules.
   *
   * The returned array is a shallow copy. Rule objects are internal records and
   * must not be exposed through the public API.
   */
  getAll(): TrackerNormalizedRule[] {
    return [...this.#rules];
  }

  /**
   * Returns public rule copies.
   *
   * Mutating the returned array or objects does not mutate internal RuleStore
   * state. Function references inside user rules are intentionally preserved.
   * After replace(), the copies reflect the latest accepted input even when the
   * replacement was behaviorally a no-op.
   */
  getPublicRules() {
    return this.#rules.map((rule) => clonePublicRule(rule.source));
  }

  /**
   * Restores a previously captured internal rule snapshot without diagnostics or counter changes.
   *
   * @param rules - Normalized rules captured through getAll().
   */
  restoreSnapshot(rules: readonly TrackerNormalizedRule[]): void {
    this.#rules = [...rules];
    this.#selectors = createSelectorSet(this.#rules);
    reindexRules(this.#rules);
  }

  /**
   * Checks whether a normalized selector already exists.
   *
   * @param selector - Normalized selector.
   */
  hasSelector(selector: string): boolean {
    return this.#selectors.has(selector);
  }

  /**
   * Normalizes and validates a rule against a selector set.
   *
   * @param rule - Public rule candidate.
   * @param index - Rule index.
   * @param selectors - Selector set used for duplicate checks.
   */
  #normalizeAndValidateRule(rule: unknown, index: number, selectors: ReadonlySet<string>): TrackerRuleValidationResult {
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

    const normalizedRule = normalizeRule(rule, {
      index,
    });

    const result = validateNormalizedRule(normalizedRule, {
      selectorRoot: this.#context.selectorRoot,
      hasSelector: (selector) => selectors.has(selector),
    });

    if (unknownKeyDiagnostics.length === 0) {
      return result;
    }

    const diagnostics = [...unknownKeyDiagnostics, ...result.diagnostics];

    return {
      ...result,
      diagnostics,
      warnings: [...unknownKeyDiagnostics, ...result.warnings],
    };
  }

  /**
   * Records added/removed rule counters as a selector-set delta of a
   * behavior-changing replacement.
   *
   * @param previousSelectors - Selector set before the replacement.
   * @param nextSelectors - Selector set after the replacement.
   */
  #recordReplaceDelta(previousSelectors: ReadonlySet<string>, nextSelectors: ReadonlySet<string>): void {
    let addedCount = 0;
    let removedCount = 0;

    nextSelectors.forEach((selector) => {
      if (!previousSelectors.has(selector)) {
        addedCount += 1;
      }
    });

    previousSelectors.forEach((selector) => {
      if (!nextSelectors.has(selector)) {
        removedCount += 1;
      }
    });

    if (addedCount > 0) {
      this.#context.diagnostics?.recordRule?.('added', addedCount);
    }

    if (removedCount > 0) {
      this.#context.diagnostics?.recordRule?.('removed', removedCount);
    }
  }

  /**
   * Removes one stored rule and restores all derived indexes and counters.
   *
   * @param index - Existing rule index.
   * @returns Successful removal result.
   */
  #removeAt(index: number): RuleStoreSingleResult {
    const [removedRule] = this.#rules.splice(index, 1);

    this.#selectors.delete(removedRule.selector);
    reindexRules(this.#rules);
    this.#context.diagnostics?.recordRule?.('removed');

    return {
      changed: true,
      rule: removedRule,
      diagnostics: [],
    };
  }

  /**
   * Removes a rule by index.
   *
   * @param index - Rule index.
   */
  removeByIndex(index: unknown): RuleStoreSingleResult {
    this.validateRemovalIndex(index);

    return this.#removeAt(index);
  }

  /**
   * Validates an indexed removal without mutating the stored rule list.
   *
   * @param index - Rule index candidate.
   * @param collectionSize - Ordered collection size used for validation.
   * @throws TrackerConfigurationError when the index is invalid.
   */
  validateRemovalIndex(index: unknown, collectionSize = this.#rules.length): asserts index is number {
    if (!isValidRemovalIndex(index, collectionSize)) {
      const entry: TrackerValidationDiagnostic = {
        type: 'warning',
        code: 'invalid-rule-index',
        message: 'Invalid rule index. No rule was removed.',
        details: {
          index,
          size: collectionSize,
        },
      };

      assertConfigurationDiagnostics([entry], 'Tracker rule removal');
      throw new TypeError('Unreachable invalid rule index.');
    }
  }

  /**
   * Removes a rule by normalized selector.
   *
   * @param selector - Rule selector.
   */
  removeBySelector(selector: unknown): RuleStoreSingleResult {
    const normalizedSelector = this.validateRemovalSelector(selector);

    const index = this.#rules.findIndex((rule) => rule.selector === normalizedSelector);

    if (index === -1) {
      return {
        changed: false,
        rule: null,
        diagnostics: [],
      };
    }

    return this.#removeAt(index);
  }

  /**
   * Validates and normalizes a selector removal candidate without mutation.
   *
   * @param selector - Rule selector candidate.
   * @returns Normalized non-empty selector.
   * @throws TrackerConfigurationError when the selector is invalid.
   */
  validateRemovalSelector(selector: unknown): string {
    const normalizedSelector = normalizeSelector(selector);

    if (typeof selector !== 'string' || normalizedSelector === '') {
      const entry: TrackerValidationDiagnostic = {
        type: 'warning',
        code: 'invalid-rule-selector',
        message: 'Rule selector must be a non-empty string.',
        details: { selector },
      };

      assertConfigurationDiagnostics([entry], 'Tracker rule removal');
    }

    return normalizedSelector;
  }

  /**
   * Replaces the full rule list.
   *
   * The replacement is validated in temporary storage and rejected atomically
   * when any rule is invalid or duplicated.
   *
   * The returned `changed` flag reflects runtime behavior only. A replacement
   * that differs only in public source payloads still updates stored rules (so
   * getPublicRules() reflects the latest input) but reports `changed: false`
   * and does not trigger a re-render.
   *
   * Rule counters `added` and `removed` are recorded as selector-set deltas
   * when the replacement changes runtime behavior.
   *
   * @param rules - Public rule list candidate.
   */
  replace(rules: unknown): RuleStoreListResult {
    const validationResult = validateRules(rules, {
      selectorRoot: this.#context.selectorRoot,
    });

    assertConfigurationDiagnostics(validationResult.diagnostics, 'Tracker rules');

    const nextRules = validationResult.rules;
    const nextSelectors = createSelectorSet(nextRules);

    reindexRules(nextRules);

    const changed = !areRuleListsEqual(this.#rules, nextRules);
    const sourceChanged = !changed && !areRuleSourceListsEqual(this.#rules, nextRules);

    if (changed) {
      this.#recordReplaceDelta(this.#selectors, nextSelectors);
    }

    if (changed || sourceChanged) {
      this.#rules = nextRules;
      this.#selectors = createSelectorSet(nextRules);
    }

    return {
      changed,
      rules: this.getAll(),
      diagnostics: [],
    };
  }

  /**
   * Builds context-dependent rule validation state without mutating the store,
   * public counters, diagnostics, or selector indexes.
   *
   * @param context - Candidate validation context.
   * @param context.selectorRoot - Candidate selector root.
   * @returns Staged validation result.
   */
  stageRevalidation(context: { selectorRoot?: TrackerSourceRoot | null } = {}): RuleStoreStagedResult {
    const selectorRoot = 'selectorRoot' in context ? context.selectorRoot : this.#context.selectorRoot;
    const nextRules: TrackerNormalizedRule[] = [];
    const nextSelectors = new Set<string>();
    const diagnostics: TrackerValidationDiagnostic[] = [];
    let rejected = 0;
    let duplicates = 0;

    this.#rules.forEach((storedRule) => {
      const rule = cloneValue(storedRule) as TrackerNormalizedRule;
      const result = validateNormalizedRule(rule, {
        selectorRoot,
        hasSelector: (selector) => nextSelectors.has(selector),
      });

      diagnostics.push(...result.diagnostics);

      if (!result.valid || result.rule === null) {
        rejected += result.errors.length > 0 ? 1 : 0;
        duplicates += result.warnings.some((entry) => entry.code === 'duplicate-rule-selector') ? 1 : 0;
        return;
      }

      nextRules.push(result.rule);
      nextSelectors.add(result.rule.selector);
    });

    reindexRules(nextRules);

    return {
      changed: !areRuleListsEqual(this.#rules, nextRules),
      rules: nextRules,
      publicRules: nextRules.map((rule) => clonePublicRule(rule.source)),
      diagnostics,
      rejected,
      duplicates,
    };
  }

  /**
   * Atomically installs and publishes one successful staged validation result.
   *
   * @param staged - Staged rule validation result.
   */
  commitStagedRevalidation(staged: RuleStoreStagedResult): void {
    dispatchDiagnostics(staged.diagnostics, this.#context.diagnostics);

    if (staged.rejected > 0) {
      this.#context.diagnostics?.recordRule?.('rejected', staged.rejected);
    }

    if (staged.duplicates > 0) {
      this.#context.diagnostics?.recordRule?.('duplicates', staged.duplicates);
    }

    if (!staged.changed) {
      return;
    }

    this.#rules = staged.rules;
    this.#selectors = createSelectorSet(staged.rules);
  }

  /**
   * Updates store context used by future rule validations.
   *
   * Existing rules are not re-normalized by this method.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<RuleStoreContext> = {}): void {
    this.#context = {
      ...this.#context,
      ...context,
    };
  }
}

export { RuleStore, isValidInsertionIndex, isValidRemovalIndex };
export type { RuleStoreStagedResult };
