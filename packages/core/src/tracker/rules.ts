import { isValidInsertionIndex, isValidRemovalIndex } from '../rules/RuleStore.js';
import { RENDER_TARGETS } from '../schedule/renderTargets.js';
import type { TrackerAddRuleParams, TrackerOperationParams, TrackerRule } from '../types.js';
import { TrackerConfigurationError } from '../errors.js';
import { hasOwn, isPlainObject, snapshotCallTimeInput } from '../utils/object.js';
import { normalizeSelector } from '../utils/selector.js';
import type { TrackerInstance } from './createTrackerInstance.js';
import { syncTrackerInstanceContexts } from './instanceContext.js';
import type { TrackerLifecycleCallbacks } from './lifecycleCallbacks.js';
import { assertTrackerInstanceAlive } from './lifecycleGuards.js';
import { coordinateTrackerOperation } from './operationCoordinator.js';
import { shouldRender } from './operationParams.js';
import { performTrackerInstanceRenderRequest } from './rendering.js';
import { extractApproxSelectors, getProjectedRuleSelectors, pushPendingRuleOperation } from './ruleProjection.js';
import { assertTrackerInstanceRulesUpdateIsValid, performReplaceTrackerInstanceRules } from './updating.js';

/**
 * Returns a valid insertion index from addRule params.
 *
 * Invalid index handling (wrong range) is completed by RuleStore so it can emit
 * the canonical warning and append the rule.
 *
 * @param params - addRule params.
 * @returns Insertion index or undefined.
 * @throws TrackerConfigurationError when `params.index` is an own property with
 *   the value `undefined`.
 */
function getRuleInsertionIndex(params: unknown): number | undefined {
  if (!isPlainObject(params) || !hasOwn(params, 'index')) {
    return undefined;
  }

  const index = (params as TrackerAddRuleParams).index;

  if (index === undefined) {
    throw new TrackerConfigurationError('addRule() params.index must not be undefined.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  return index;
}

/**
 * Runs one rule-store mutation and synchronizes it transactionally.
 *
 * @param instance - Internal instance context.
 * @param mutation - Rule-store mutation.
 * @param callbacks - Lifecycle callbacks.
 * @returns Whether the rule set changed.
 */
function applyTrackerInstanceRuleMutation(
  instance: TrackerInstance,
  mutation: () => { changed: boolean },
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): boolean {
  const previousRules = instance.ruleStore.getAll();
  const previousRuleCounters = instance.diagnostics.getStats().rules;
  const result = mutation();

  if (!result.changed) {
    return false;
  }

  try {
    syncTrackerInstanceContexts(instance, callbacks);
  } catch (error) {
    const errors: unknown[] = [error];

    try {
      instance.ruleStore.restoreSnapshot(previousRules);
    } catch (rollbackError) {
      errors.push(rollbackError);
    }

    try {
      instance.diagnostics.restoreRuleCounters(previousRuleCounters);
    } catch (rollbackError) {
      errors.push(rollbackError);
    }

    try {
      syncTrackerInstanceContexts(instance, callbacks);
    } catch (rollbackError) {
      errors.push(rollbackError);
    }

    if (errors.length === 1) {
      throw error;
    }

    throw new AggregateError(errors, 'Tracker rule mutation and context rollback both failed.');
  }

  return true;
}

/**
 * Adds a rule to the ordered rule list.
 *
 * @param instance - Internal instance context.
 * @param rule - Public rule candidate.
 * @param params - Add params.
 * @param callbacks - Lifecycle callbacks.
 */
function performAddTrackerInstanceRule(
  instance: TrackerInstance,
  rule: unknown,
  params: TrackerAddRuleParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'add a rule');

  const render = shouldRender(params, ['index']);
  const index = getRuleInsertionIndex(params);
  const changed = applyTrackerInstanceRuleMutation(instance, () => instance.ruleStore.add(rule, index), callbacks);

  if (!changed) {
    return;
  }

  performTrackerInstanceRenderRequest(instance, RENDER_TARGETS.MARKERS, render, {
    source: 'addRule',
  });
}

/**
 * Removes all rules.
 *
 * @param instance - Internal instance context.
 * @param params - Clear params.
 * @param callbacks - Lifecycle callbacks.
 */
function performClearTrackerInstanceRules(
  instance: TrackerInstance,
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'clear rules');

  const render = shouldRender(params);
  const changed = applyTrackerInstanceRuleMutation(instance, () => instance.ruleStore.clear(), callbacks);

  if (!changed) {
    return;
  }

  performTrackerInstanceRenderRequest(instance, RENDER_TARGETS.MARKERS, render, {
    source: 'clearRules',
  });
}

/**
 * Removes a rule by index.
 *
 * @param instance - Internal instance context.
 * @param index - Rule index.
 * @param params - Remove params.
 * @param callbacks - Lifecycle callbacks.
 */
function performRemoveTrackerInstanceRuleByIndex(
  instance: TrackerInstance,
  index: number,
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'remove a rule');

  const render = shouldRender(params);
  const changed = applyTrackerInstanceRuleMutation(instance, () => instance.ruleStore.removeByIndex(index), callbacks);

  if (!changed) {
    return;
  }

  performTrackerInstanceRenderRequest(instance, RENDER_TARGETS.MARKERS, render, {
    source: 'removeRuleByIndex',
  });
}

/**
 * Removes a rule by selector.
 *
 * @param instance - Internal instance context.
 * @param selector - Rule selector.
 * @param params - Remove params.
 * @param callbacks - Lifecycle callbacks.
 */
function performRemoveTrackerInstanceRuleBySelector(
  instance: TrackerInstance,
  selector: string,
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'remove a rule');

  const render = shouldRender(params);
  const changed = applyTrackerInstanceRuleMutation(
    instance,
    () => instance.ruleStore.removeBySelector(selector),
    callbacks,
  );

  if (!changed) {
    return;
  }

  performTrackerInstanceRenderRequest(instance, RENDER_TARGETS.MARKERS, render, {
    source: 'removeRuleBySelector',
  });
}

/**
 * Replaces the full rule list using the standard options validation path.
 *
 * This state-oriented helper is intended for framework wrappers that receive
 * rules as props, inputs or child configuration and should not manually diff
 * add/remove operations.
 *
 * @param instance - Internal instance context.
 * @param rules - Next public rule list candidate.
 * @param params - Replace params.
 * @param callbacks - Lifecycle callbacks.
 */
function replaceTrackerInstanceRules(
  instance: TrackerInstance,
  rules: readonly TrackerRule[],
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'replace rules');

  const rulesSnapshot = snapshotCallTimeInput(rules);
  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot);
  assertTrackerInstanceRulesUpdateIsValid(instance, rulesSnapshot);
  const releaseOperation = pushPendingRuleOperation(instance, () => extractApproxSelectors(rulesSnapshot));

  coordinateTrackerOperation(
    instance,
    'replaceRules',
    () => performReplaceTrackerInstanceRules(instance, rulesSnapshot, paramsSnapshot, callbacks),
    { deferredResult: undefined, cleanup: releaseOperation },
  );
}

/**
 * Resolves the normalized selector for a rule candidate, if any.
 *
 * @param rule - Public rule candidate.
 * @returns Normalized selector, or an empty string when it cannot be resolved.
 */
function resolveCandidateSelector(rule: unknown): string {
  return isPlainObject(rule) ? normalizeSelector((rule as { selector?: unknown }).selector) : '';
}

/** Coordinates one public rule insertion. */
function addTrackerInstanceRule(
  instance: TrackerInstance,
  rule: unknown,
  params: TrackerAddRuleParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'add a rule');

  if (!isPlainObject(rule)) {
    throw new TypeError('addRule() requires a rule object.');
  }

  const ruleSnapshot = snapshotCallTimeInput(rule);
  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot, ['index']);
  let releaseOperation: (() => void) | null = null;

  if (!instance.destroyed) {
    const requestedIndex = getRuleInsertionIndex(paramsSnapshot);
    const projectedSelectors = getProjectedRuleSelectors(instance);

    instance.ruleStore.validateCandidate(
      ruleSnapshot,
      requestedIndex,
      new Set(projectedSelectors),
      projectedSelectors.length,
    );

    const candidateSelector = resolveCandidateSelector(ruleSnapshot);

    releaseOperation = pushPendingRuleOperation(instance, (selectors) => {
      if (candidateSelector === '' || selectors.includes(candidateSelector)) {
        return selectors;
      }

      const insertAt = isValidInsertionIndex(requestedIndex, selectors.length) ? requestedIndex : selectors.length;
      const next = selectors.slice();

      next.splice(insertAt, 0, candidateSelector);

      return next;
    });
  }

  coordinateTrackerOperation(
    instance,
    'addRule',
    () => performAddTrackerInstanceRule(instance, ruleSnapshot, paramsSnapshot, callbacks),
    {
      deferredResult: undefined,
      cleanup: () => releaseOperation?.(),
    },
  );
}

/** Coordinates one public rule clear. */
function clearTrackerInstanceRules(
  instance: TrackerInstance,
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'clear rules');

  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot);
  const releaseOperation = pushPendingRuleOperation(instance, () => []);

  coordinateTrackerOperation(
    instance,
    'clearRules',
    () => performClearTrackerInstanceRules(instance, paramsSnapshot, callbacks),
    {
      deferredResult: undefined,
      cleanup: releaseOperation,
    },
  );
}

/** Coordinates one public indexed rule removal. */
function removeTrackerInstanceRuleByIndex(
  instance: TrackerInstance,
  index: number,
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'remove a rule');

  if (typeof index !== 'number') {
    throw new TypeError('removeRuleByIndex() requires a numeric index.');
  }

  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot);
  let releaseOperation: (() => void) | null = null;

  if (!instance.destroyed) {
    const projectedSelectors = getProjectedRuleSelectors(instance);

    instance.ruleStore.validateRemovalIndex(index, projectedSelectors.length);
    releaseOperation = pushPendingRuleOperation(instance, (selectors) => {
      if (!isValidRemovalIndex(index, selectors.length)) {
        return selectors;
      }

      const next = selectors.slice();

      next.splice(index, 1);

      return next;
    });
  }

  coordinateTrackerOperation(
    instance,
    'removeRuleByIndex',
    () => performRemoveTrackerInstanceRuleByIndex(instance, index, paramsSnapshot, callbacks),
    {
      deferredResult: undefined,
      cleanup: () => releaseOperation?.(),
    },
  );
}

/** Coordinates one public selector rule removal. */
function removeTrackerInstanceRuleBySelector(
  instance: TrackerInstance,
  selector: string,
  params: TrackerOperationParams | undefined = undefined,
  callbacks: Partial<TrackerLifecycleCallbacks> = {},
): void {
  assertTrackerInstanceAlive(instance, 'remove a rule');

  if (typeof selector !== 'string') {
    throw new TypeError('removeRuleBySelector() requires a string selector.');
  }

  const paramsSnapshot = snapshotCallTimeInput(params);

  shouldRender(paramsSnapshot);
  let releaseOperation: (() => void) | null = null;

  if (!instance.destroyed) {
    const candidateSelector = instance.ruleStore.validateRemovalSelector(selector);

    releaseOperation = pushPendingRuleOperation(instance, (selectors) =>
      candidateSelector === '' ? selectors : selectors.filter((entry) => entry !== candidateSelector),
    );
  }

  coordinateTrackerOperation(
    instance,
    'removeRuleBySelector',
    () => performRemoveTrackerInstanceRuleBySelector(instance, selector, paramsSnapshot, callbacks),
    {
      deferredResult: undefined,
      cleanup: () => releaseOperation?.(),
    },
  );
}

export {
  addTrackerInstanceRule,
  clearTrackerInstanceRules,
  removeTrackerInstanceRuleByIndex,
  removeTrackerInstanceRuleBySelector,
  replaceTrackerInstanceRules,
};
