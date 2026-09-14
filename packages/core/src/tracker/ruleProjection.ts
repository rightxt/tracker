import { isPlainObject } from '../utils/object.js';
import { normalizeSelector } from '../utils/selector.js';
import type { TrackerInstance } from './createTrackerInstance.js';

/** A queued rule mutation not yet committed to the RuleStore. */
interface PendingRuleOperation {
  /** Projects this operation's effect onto an accumulated selector list. */
  project: (selectors: readonly string[]) => readonly string[];
}

/** Per-instance FIFO queue of not-yet-committed rule mutations. */
const pendingRuleOperations = new WeakMap<TrackerInstance, PendingRuleOperation[]>();

/**
 * Registers a queued rule mutation for an instance.
 *
 * @param instance - Internal instance context.
 * @param project - Selector-list projection for this operation.
 * @returns Cleanup callback that removes exactly this operation by identity.
 */
function pushPendingRuleOperation(
  instance: TrackerInstance,
  project: (selectors: readonly string[]) => readonly string[],
): () => void {
  let operations = pendingRuleOperations.get(instance);

  if (!operations) {
    operations = [];
    pendingRuleOperations.set(instance, operations);
  }

  const queue = operations;
  const operation: PendingRuleOperation = { project };

  queue.push(operation);

  return () => {
    const index = queue.indexOf(operation);

    if (index !== -1) {
      queue.splice(index, 1);
    }
  };
}

/**
 * Extracts approximate normalized selectors from a raw rule-list candidate.
 *
 * @param rules - Raw rule-list candidate.
 * @returns Normalized selectors resolved from plain-object entries.
 */
function extractApproxSelectors(rules: unknown): string[] {
  if (!Array.isArray(rules)) {
    return [];
  }

  const selectors: string[] = [];

  rules.forEach((rule) => {
    const selector = isPlainObject(rule) ? normalizeSelector(rule.selector) : '';

    if (selector !== '') {
      selectors.push(selector);
    }
  });

  return selectors;
}

/**
 * Returns selectors projected through every accepted pending rule operation.
 *
 * @param instance - Internal instance context.
 * @returns Projected selector list.
 */
function getProjectedRuleSelectors(instance: TrackerInstance): readonly string[] {
  const base = extractApproxSelectors(instance.ruleStore.getPublicRules());
  const operations = pendingRuleOperations.get(instance);

  if (!operations || operations.length === 0) {
    return base;
  }

  return operations.reduce(
    (selectors: readonly string[], operation) => operation.project(selectors),
    base as readonly string[],
  );
}

export { extractApproxSelectors, getProjectedRuleSelectors, pushPendingRuleOperation };
