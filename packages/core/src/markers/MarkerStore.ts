import { createMarkerRecord } from './createMarkerRecord.js';
import { areNormalizedMarkerAttributesEqual } from '../config/markerAttributes.js';
import { isInComposedSubtree } from '../dom/composedTree.js';
import { isElement } from '../dom/element.js';
import { getInternalDomRegistry } from '../dom/internalDomRegistry.js';
import { toQueryElements } from '../query/QueryEngine.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import { areValuesEqual } from '../utils/object.js';
import type {
  TrackerDiagnosticCode,
  TrackerMarkerRecord,
  TrackerMarkerRecordContext,
  TrackerMarkerStoreRebuildResult,
  TrackerNormalizedRule,
  TrackerQueryMatch,
  TrackerSourceRoot,
} from '../types.js';

interface MarkerStoreDiagnostics {
  /** Error reporter. */
  error?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
  /** Marker lifecycle counter hook. */
  recordMarker?: (counterName: 'created' | 'removed', amount?: number) => void;
  /** Current render counts updater. */
  setCurrentRenderCounts?: (counters: { markers?: number; clusters?: number }) => void;
}

interface MarkerStoreContext {
  /** Diagnostics layer. */
  diagnostics?: MarkerStoreDiagnostics | null;
  /** Marker record factory. */
  createRecord?: (match: TrackerQueryMatch, context?: TrackerMarkerRecordContext) => TrackerMarkerRecord | null;
  /** Authoritative source-query root used to reject records built outside it. */
  sourceRoot?: TrackerSourceRoot | null;
}

/**
 * Record fields that affect marker rendering or interaction behavior without
 * necessarily changing marker lifecycle.
 */
const RECORD_STATE_KEYS: ReadonlyArray<string> = Object.freeze([
  'element',
  'ruleIndex',
  'selector',
  'label',
  'scroll',
  'focus',
]);

/**
 * Counts created and removed records by key.
 *
 * @param previousRecords - Previous marker records.
 * @param nextRecords - Next marker records.
 * @returns Lifecycle counts.
 */
function countRecordChanges(
  previousRecords: TrackerMarkerRecord[],
  nextRecords: TrackerMarkerRecord[],
): { created: number; removed: number } {
  const previousKeys = new Set(previousRecords.map((record) => record.key));
  const nextKeys = new Set(nextRecords.map((record) => record.key));

  let created = 0;
  let removed = 0;

  nextKeys.forEach((key) => {
    if (!previousKeys.has(key)) {
      created += 1;
    }
  });

  previousKeys.forEach((key) => {
    if (!nextKeys.has(key)) {
      removed += 1;
    }
  });

  return {
    created,
    removed,
  };
}

/**
 * Checks whether record state changed.
 *
 * Lifecycle changes are detected by key sequence. In-place render/interaction
 * changes are detected by selected record fields.
 *
 * @param previousRecords - Previous marker records.
 * @param nextRecords - Next marker records.
 * @returns True when marker record state changed.
 */
function hasMarkerRecordsChanged(previousRecords: TrackerMarkerRecord[], nextRecords: TrackerMarkerRecord[]): boolean {
  if (hasRecordSequenceChanged(previousRecords, nextRecords)) {
    return true;
  }

  return previousRecords.some((record, index) => hasRecordStateChanged(record, nextRecords[index]));
}

/**
 * Compares record key sequences.
 *
 * @param previousRecords - Previous marker records.
 * @param nextRecords - Next marker records.
 * @returns True when the key sequence is different.
 */
function hasRecordSequenceChanged(previousRecords: TrackerMarkerRecord[], nextRecords: TrackerMarkerRecord[]): boolean {
  if (previousRecords.length !== nextRecords.length) {
    return true;
  }

  return previousRecords.some((record, index) => record.key !== nextRecords[index]?.key);
}

/**
 * Checks whether render-relevant marker record state changed.
 *
 * @param previousRecord - Previous marker record.
 * @param nextRecord - Next marker record.
 * @returns True when record state changed.
 */
function hasRecordStateChanged(previousRecord: TrackerMarkerRecord, nextRecord: TrackerMarkerRecord): boolean {
  const fieldsChanged = RECORD_STATE_KEYS.some(
    (key) =>
      !areValuesEqual(
        (previousRecord as unknown as Record<string, unknown>)[key],
        (nextRecord as unknown as Record<string, unknown>)[key],
      ),
  );
  const previousMarker = previousRecord.rule.marker;
  const nextMarker = nextRecord.rule.marker;

  return (
    fieldsChanged ||
    previousMarker.className !== nextMarker.className ||
    previousMarker.title !== nextMarker.title ||
    !areNormalizedMarkerAttributesEqual(previousMarker.attributes, nextMarker.attributes) ||
    !areValuesEqual(previousMarker.cssVariables, nextMarker.cssVariables)
  );
}

/**
 * Stores MarkerRecord objects built from query matches.
 *
 * The store owns marker record state but does not own DOM marker elements.
 * Deduplication strategy is fixed: first rule wins.
 */
class MarkerStore {
  /**
   * Store context with constructor defaults applied.
   */
  #context: Required<MarkerStoreContext>;

  /**
   * Stable element ids used for marker keys.
   */
  #elementKeys: WeakMap<Element, string> = new WeakMap();

  /**
   * Last assigned element id.
   */
  #nextElementId = 1;

  /**
   * Current marker records.
   */
  #records: TrackerMarkerRecord[] = [];

  /**
   * Ordered query matches from the last full (non-reused) rebuild. Used to detect
   * whether a subsequent rebuild's input is semantically identical to the last one,
   * so the previous records can be reused without invoking the record factory again.
   * Reset to null whenever anything that could invalidate that comparison happens
   * (clear, destroy, restore, or a context patch).
   */
  #lastMatches: TrackerQueryMatch[] | null = null;

  /**
   * Skipped count from the last full (non-reused) rebuild, replayed verbatim on reuse.
   */
  #lastSkipped = 0;

  /**
   * @param context - Diagnostics and an optional marker
   * record factory (createMarkerRecord by default). References are retained
   * for the store lifetime. Element references are held weakly for stable
   * marker keys, so the store does not prevent element garbage collection.
   */
  constructor(context: MarkerStoreContext = {}) {
    this.#context = {
      diagnostics: context.diagnostics || null,
      createRecord: typeof context.createRecord === 'function' ? context.createRecord : createMarkerRecord,
      sourceRoot: context.sourceRoot ?? null,
    };
  }

  /**
   * Returns the number of stored marker records.
   *
   * @returns Marker count.
   */
  get size(): number {
    return this.#records.length;
  }

  /**
   * Clears all marker records.
   *
   * Element keys are intentionally preserved so records can keep stable keys if
   * the same elements appear again later in the instance lifecycle.
   *
   * @returns Clear result.
   */
  clear(): { changed: boolean; removed: number } {
    const removed = this.#records.length;

    this.#lastMatches = null;
    this.#lastSkipped = 0;

    if (removed === 0) {
      return {
        changed: false,
        removed: 0,
      };
    }

    this.#records = [];

    this.#context.diagnostics?.recordMarker?.('removed', removed);
    this.#context.diagnostics?.setCurrentRenderCounts?.({
      markers: 0,
      clusters: 0,
    });

    return {
      changed: true,
      removed,
    };
  }

  /**
   * Releases marker records, stable element keys and rebuild context.
   */
  destroy(): void {
    this.#records = [];
    this.#elementKeys = new WeakMap();
    this.#nextElementId = 1;
    this.#lastMatches = null;
    this.#lastSkipped = 0;
    this.#context = {
      diagnostics: null,
      createRecord: createMarkerRecord,
      sourceRoot: null,
    };
  }

  /**
   * Returns current marker records.
   *
   * The array is copied. MarkerRecord objects are internal records and should be
   * treated as immutable by callers.
   *
   * @returns Marker records.
   */
  getAll(): TrackerMarkerRecord[] {
    return [...this.#records];
  }

  /**
   * Restores records captured before a failed render without recording lifecycle changes.
   *
   * Invalidates the reuse cache: the restored records were not necessarily produced by
   * the last query matches the store observed, so reusing against `#lastMatches` after
   * a rollback could return records that no longer reflect `#records`.
   *
   * @param records - Previously committed marker records.
   */
  restore(records: readonly TrackerMarkerRecord[]): void {
    this.#records = [...records];
    this.#lastMatches = null;
    this.#lastSkipped = 0;
  }

  /**
   * Checks whether a candidate record's element still belongs to the source root
   * subtree and remains outside Tracker-owned internal DOM.
   *
   * @param record - Candidate marker record.
   * @returns True when the element remains a valid marker source.
   */
  #isRecordElementValid(record: TrackerMarkerRecord): boolean {
    if (this.#context.sourceRoot !== null && !isInComposedSubtree(record.element, this.#context.sourceRoot)) {
      return false;
    }

    const ownerDocument = record.element.ownerDocument;

    return ownerDocument === null || !getInternalDomRegistry(ownerDocument).isNodeExcluded(record.element);
  }

  /**
   * Checks whether an element is still an authoritative selector match for a rule,
   * scoped through `sourceRoot` exactly as QueryEngine would scope it.
   *
   * This is not equivalent to `element.matches(rule.selector)`: for root-relative
   * selector forms such as `:scope`, `Element.prototype.matches()` resolves the
   * scoping root to the element itself rather than to `sourceRoot`, which would
   * silently answer the wrong question.
   *
   * @param element - Candidate element.
   * @param rule - Rule the element was originally matched under.
   * @param sourceRoot - Authoritative query root.
   * @returns True when a fresh, root-scoped query still matches this element.
   */
  #isElementCurrentlyMatchedByRule(
    element: Element,
    rule: TrackerNormalizedRule,
    sourceRoot: TrackerSourceRoot,
  ): boolean {
    try {
      return toQueryElements(sourceRoot.querySelectorAll(rule.selector), sourceRoot).includes(element);
    } catch (error) {
      this.#context.diagnostics?.error?.(
        'query-selector-error',
        `Rule selector "${rule.selector}" failed during selector revalidation.`,
        {
          selector: rule.selector,
          error: getErrorMessage(error),
        },
      );

      return false;
    }
  }

  /**
   * Returns a stable key for a source element.
   *
   * @param element - Source element.
   * @returns Stable element key.
   */
  #getElementKey(element: Element): string {
    const existingKey = this.#elementKeys.get(element);

    if (existingKey) {
      return existingKey;
    }

    const key = `m${this.#nextElementId}`;
    this.#nextElementId += 1;

    this.#elementKeys.set(element, key);

    return key;
  }

  /**
   * Checks whether `matches` is semantically identical to the input of the last full
   * rebuild, so that rebuild's records can be reused verbatim.
   *
   * Reuse requires, for every index, reference equality of `element`, `rule` and
   * `ruleIndex` against the last rebuild's matches, and excludes any matched rule
   * with a function `label` (a volatile input the store cannot cheaply compare).
   * Rule reference equality is sufficient to cover the rule's `marker`/`scroll`/
   * `focus` fields too, since those are read from the same (assumed immutable)
   * rule object.
   *
   * @param matches - Candidate ordered query matches.
   * @returns True when the last rebuild's records can be reused as-is.
   */
  #canReuseLastMatches(matches: TrackerQueryMatch[]): boolean {
    const lastMatches = this.#lastMatches;

    if (lastMatches === null || !Array.isArray(matches) || matches.length !== lastMatches.length) {
      return false;
    }

    for (let index = 0; index < lastMatches.length; index += 1) {
      const previousMatch = lastMatches[index];
      const currentMatch = matches[index];
      const isSameMatch =
        currentMatch != null &&
        currentMatch.element === previousMatch.element &&
        currentMatch.rule === previousMatch.rule &&
        currentMatch.ruleIndex === previousMatch.ruleIndex &&
        typeof currentMatch.rule.label !== 'function';

      if (!isSameMatch) {
        return false;
      }
    }

    return true;
  }

  /**
   * Rebuilds marker records from ordered query matches, without re-validating
   * that a candidate's owning rule selector still matches the candidate element.
   *
   * This is the cheap, unconditional path used whenever no rule among `matches`
   * has a function-valued `label`, since only a function `label` callback can
   * mutate selector-relevant DOM. A DOM element can produce at most one marker
   * record. If multiple rules match the same element, the first match in rule
   * order owns that element even when the configured record factory declines it
   * by returning null.
   *
   * @param matches - Ordered query matches.
   * @returns Next records and skipped count.
   */
  #rebuildWithoutSelectorRevalidation(matches: TrackerQueryMatch[]): {
    nextRecords: TrackerMarkerRecord[];
    skipped: number;
  } {
    const seenElements = new Set<Element>();
    const candidateRecords: TrackerMarkerRecord[] = [];
    let skipped = 0;

    if (Array.isArray(matches)) {
      matches.forEach((match) => {
        if (!match || !isElement(match.element)) {
          skipped += 1;
          return;
        }

        if (seenElements.has(match.element)) {
          skipped += 1;
          return;
        }

        seenElements.add(match.element);

        const record = this.#context.createRecord(match, {
          diagnostics: this.#context.diagnostics ?? undefined,
          getElementKey: (element) => this.#getElementKey(element),
        });

        if (record === null) {
          skipped += 1;
          return;
        }

        if (!this.#isRecordElementValid(record)) {
          skipped += 1;
          return;
        }

        candidateRecords.push(record);
      });
    }

    // A callback for a later candidate can relocate an already-accepted element
    // (e.g. outside the source root or into Tracker-owned internal DOM), so every
    // candidate is revalidated once more after all callbacks have run, immediately
    // before the collection is committed.
    const nextRecords = candidateRecords.filter((record) => {
      if (this.#isRecordElementValid(record)) {
        return true;
      }

      skipped += 1;
      return false;
    });

    return { nextRecords, skipped };
  }

  /**
   * Rebuilds marker records from ordered query matches, re-validating each
   * candidate's owning rule selector immediately before commit.
   *
   * Used only when at least one rule among `matches` has a function-valued
   * `label`, since that is the only way a resolver callback can mutate
   * selector-relevant DOM during this pass. Candidates are grouped by element,
   * preserving each element's originally-matched rule-priority order. Pass 1
   * tries each element's originally-matched rules in that order, stopping at
   * the first rule whose record factory does not decline (an explicit `null`
   * ends the attempt for that element, matching the existing decline contract)
   * and whose selector still matches after the factory ran. Pass 2 re-validates
   * every pass-1-accepted record once more (a later element's callback can
   * invalidate an earlier one), allowing at most one bounded fallback to that
   * record's next originally-matched rule. No rule is ever attempted more than
   * once for a given element across both passes, and elements absent from
   * `matches` are never queried, so this cannot loop or re-run a callback to
   * chase a moving fixed point.
   *
   * @param matches - Ordered query matches.
   * @param sourceRoot - Authoritative query root for selector revalidation.
   * @returns Next records and skipped count.
   */
  #rebuildWithSelectorRevalidation(
    matches: TrackerQueryMatch[],
    sourceRoot: TrackerSourceRoot,
  ): { nextRecords: TrackerMarkerRecord[]; skipped: number } {
    let skipped = 0;

    const elementOrder: Element[] = [];
    const matchesByElement = new Map<Element, TrackerQueryMatch[]>();

    matches.forEach((match) => {
      if (!match || !isElement(match.element)) {
        skipped += 1;
        return;
      }

      const grouped = matchesByElement.get(match.element);

      if (grouped) {
        grouped.push(match);
        return;
      }

      matchesByElement.set(match.element, [match]);
      elementOrder.push(match.element);
    });

    interface Accepted {
      record: TrackerMarkerRecord;
      rule: TrackerNormalizedRule;
      element: Element;
      remainingMatches: TrackerQueryMatch[];
    }

    const accepted: Accepted[] = [];

    elementOrder.forEach((element) => {
      const elementMatches = matchesByElement.get(element) ?? [];
      let attemptIndex = 0;

      while (attemptIndex < elementMatches.length) {
        const match = elementMatches[attemptIndex];
        attemptIndex += 1;

        const record = this.#context.createRecord(match, {
          diagnostics: this.#context.diagnostics ?? undefined,
          getElementKey: (candidateElement) => this.#getElementKey(candidateElement),
        });

        if (record === null) {
          skipped += 1;
          break;
        }

        if (
          !this.#isRecordElementValid(record) ||
          !this.#isElementCurrentlyMatchedByRule(element, match.rule, sourceRoot)
        ) {
          skipped += 1;
          continue;
        }

        accepted.push({
          record,
          rule: match.rule,
          element,
          remainingMatches: elementMatches.slice(attemptIndex),
        });
        break;
      }
    });

    const nextRecords: TrackerMarkerRecord[] = [];

    accepted.forEach(({ record, rule, element, remainingMatches }) => {
      if (this.#isRecordElementValid(record) && this.#isElementCurrentlyMatchedByRule(element, rule, sourceRoot)) {
        nextRecords.push(record);
        return;
      }

      skipped += 1;

      const fallbackMatch = remainingMatches[0];

      if (!fallbackMatch) {
        return;
      }

      const fallbackRecord = this.#context.createRecord(fallbackMatch, {
        diagnostics: this.#context.diagnostics ?? undefined,
        getElementKey: (candidateElement) => this.#getElementKey(candidateElement),
      });

      if (fallbackRecord === null) {
        skipped += 1;
        return;
      }

      if (
        this.#isRecordElementValid(fallbackRecord) &&
        this.#isElementCurrentlyMatchedByRule(element, fallbackMatch.rule, sourceRoot)
      ) {
        nextRecords.push(fallbackRecord);
        return;
      }

      skipped += 1;
    });

    return { nextRecords, skipped };
  }

  /**
   * Rebuilds marker records from ordered query matches.
   *
   * A DOM element can produce at most one marker record. If multiple rules match
   * the same element, the first match in rule order owns that element even when
   * the configured record factory declines it by returning null.
   *
   * When `matches` is semantically identical to the last rebuild's input (see
   * `#canReuseLastMatches`), the previous records are reused without invoking the
   * record factory or re-validating element membership again.
   *
   * Otherwise, immediately before commit, ownership is re-validated against the
   * rule selector whenever a resolver callback could plausibly have invalidated
   * it (see `#rebuildWithSelectorRevalidation`); when no rule in this pass has a
   * function `label`, the cheaper `#rebuildWithoutSelectorRevalidation` path runs
   * unchanged.
   *
   * @param matches - Ordered query matches.
   * @returns Rebuild result.
   */
  rebuild(matches: TrackerQueryMatch[]): TrackerMarkerStoreRebuildResult {
    if (this.#canReuseLastMatches(matches)) {
      this.#context.diagnostics?.setCurrentRenderCounts?.({
        markers: this.#records.length,
        clusters: 0,
      });

      return {
        changed: false,
        records: this.getAll(),
        created: 0,
        removed: 0,
        skipped: this.#lastSkipped,
      };
    }

    const previousRecords = this.#records;
    const sourceRoot = this.#context.sourceRoot;
    const hasFunctionLabelRule =
      sourceRoot !== null &&
      Array.isArray(matches) &&
      matches.some((match) => typeof match?.rule?.label === 'function');

    const { nextRecords, skipped } = hasFunctionLabelRule
      ? this.#rebuildWithSelectorRevalidation(matches, sourceRoot)
      : this.#rebuildWithoutSelectorRevalidation(matches);

    const changed = hasMarkerRecordsChanged(previousRecords, nextRecords);
    const { created, removed } = countRecordChanges(previousRecords, nextRecords);

    this.#records = nextRecords;

    if (created > 0) {
      this.#context.diagnostics?.recordMarker?.('created', created);
    }

    if (removed > 0) {
      this.#context.diagnostics?.recordMarker?.('removed', removed);
    }

    this.#context.diagnostics?.setCurrentRenderCounts?.({
      markers: nextRecords.length,
      clusters: 0,
    });

    this.#lastMatches = Array.isArray(matches) ? [...matches] : [];
    this.#lastSkipped = skipped;

    return {
      changed,
      records: this.getAll(),
      created,
      removed,
      skipped,
    };
  }

  /**
   * Updates store context used by future rebuild operations.
   *
   * Existing records are not re-created by this method. The reuse cache is always
   * invalidated, since a `createRecord`/`sourceRoot` change can alter the output of
   * the next rebuild even when its query matches are unchanged.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<MarkerStoreContext> = {}): void {
    this.#context = {
      ...this.#context,
      ...context,
      diagnostics: 'diagnostics' in context ? context.diagnostics || null : this.#context.diagnostics,
      createRecord: typeof context.createRecord === 'function' ? context.createRecord : this.#context.createRecord,
      sourceRoot: 'sourceRoot' in context ? (context.sourceRoot ?? null) : this.#context.sourceRoot,
    };

    this.#lastMatches = null;
    this.#lastSkipped = 0;
  }
}

export { MarkerStore };
export type { MarkerStoreContext, MarkerStoreDiagnostics };
