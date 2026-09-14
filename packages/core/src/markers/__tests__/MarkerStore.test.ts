// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeRule } from '../../rules/normalizeRule.js';
import { validateNormalizedRule } from '../../rules/validateRule.js';
import { getInternalDomRegistry } from '../../dom/internalDomRegistry.js';
import { createMarkerRecord } from '../createMarkerRecord.js';
import { MarkerStore } from '../MarkerStore.js';
import type { TrackerNormalizedRule, TrackerQueryMatch, TrackerRule } from '../../types.js';

/**
 * Creates a validated normalized rule for marker tests.
 *
 * @param rule - Public rule input.
 * @param index - Rule index.
 * @returns Validated normalized rule.
 */
function createValidatedRule(rule: TrackerRule, index = 0): TrackerNormalizedRule {
  const candidate = normalizeRule(rule, {
    index,
  });
  const result = validateNormalizedRule(candidate, {
    selectorRoot: document,
  });

  if (result.rule === null) {
    throw new Error('Expected test rule to be valid.');
  }

  return result.rule;
}

/**
 * Creates a query match for marker store tests.
 *
 * @param element - Source element.
 * @param rule - Normalized rule.
 * @returns Query match.
 */
function createMatch(element: Element, rule: TrackerNormalizedRule): TrackerQueryMatch {
  return {
    element,
    rule,
    ruleIndex: rule.index,
  };
}

describe('MarkerStore', () => {
  afterEach(() => {
    // Several source-root exclusion cases attach their fixtures to the live
    // document and register internal DOM roots; clearing the body keeps a
    // leaked `.source`/`.first` node from being picked up by a sibling case's
    // root-scoped selector revalidation.
    document.body.replaceChildren();
  });

  it('keeps stable element keys and reports lifecycle counters across rebuilds', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const diagnostics = {
      recordMarker: vi.fn(),
      setCurrentRenderCounts: vi.fn(),
    };
    const store = new MarkerStore({
      diagnostics,
    });

    const firstResult = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(firstResult).toMatchObject({
      changed: true,
      created: 2,
      removed: 0,
      skipped: 0,
    });
    expect(firstResult.records.map((record) => record.key)).toEqual(['m1', 'm2']);

    const secondResult = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(secondResult).toMatchObject({
      changed: false,
      created: 0,
      removed: 0,
      skipped: 0,
    });

    const thirdResult = store.rebuild([createMatch(second, secondRule)]);

    expect(thirdResult).toMatchObject({
      changed: true,
      created: 0,
      removed: 1,
      skipped: 0,
    });
    expect(thirdResult.records[0]?.key).toBe('m2');
    expect(diagnostics.recordMarker.mock.calls).toEqual([
      ['created', 2],
      ['removed', 1],
    ]);
    expect(diagnostics.setCurrentRenderCounts).toHaveBeenLastCalledWith({
      markers: 1,
      clusters: 0,
    });
  });

  it('deduplicates matches by element with first rule winning', () => {
    const source = document.createElement('div');
    const firstRule = createValidatedRule(
      {
        label: 'first',
        selector: '.first',
      },
      0,
    );
    const secondRule = createValidatedRule(
      {
        label: 'second',
        selector: '.second',
      },
      1,
    );
    const store = new MarkerStore();
    const result = store.rebuild([createMatch(source, firstRule), createMatch(source, secondRule), null as never]);

    expect(result).toMatchObject({
      changed: true,
      created: 1,
      removed: 0,
      skipped: 2,
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      element: source,
      label: 'first',
      ruleIndex: 0,
      selector: '.first',
    });
  });

  it('detects render-relevant rule changes without lifecycle churn', () => {
    const source = document.createElement('div');
    const rule = createValidatedRule({
      label: 'Source',
      marker: {
        className: 'initial',
      },
      selector: '.source',
    });
    const nextRule = createValidatedRule({
      label: 'Updated',
      marker: {
        className: 'updated',
      },
      selector: '.source',
    });
    const store = new MarkerStore();

    store.rebuild([createMatch(source, rule)]);

    const result = store.rebuild([createMatch(source, nextRule)]);

    expect(result).toMatchObject({
      changed: true,
      created: 0,
      removed: 0,
      skipped: 0,
    });
    expect(result.records[0]).toMatchObject({
      key: 'm1',
      label: 'Updated',
    });
    expect(result.records[0]?.rule.marker.className).toBe('updated');
  });

  it('excludes records whose element is moved outside the configured source root', () => {
    const container = document.createElement('div');
    const outside = document.createElement('div');
    const source = document.createElement('div');

    source.classList.add('source');
    container.appendChild(source);
    document.body.append(container, outside);

    const rule = createValidatedRule(
      {
        selector: '.source',
        label: (element) => {
          outside.appendChild(element);

          return 'Label';
        },
      },
      0,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: container });

    const result = store.rebuild([createMatch(source, rule)]);

    expect(result).toMatchObject({
      changed: false,
      created: 0,
      removed: 0,
      skipped: 1,
    });
    expect(result.records).toEqual([]);
  });

  it('excludes an earlier accepted record when a later callback relocates it outside the source root', () => {
    const container = document.createElement('div');
    const outside = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');

    first.classList.add('first');
    second.classList.add('second');
    container.append(first, second);
    document.body.append(container, outside);

    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule(
      {
        selector: '.second',
        label: () => {
          outside.appendChild(first);

          return 'Second';
        },
      },
      1,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: container });

    const result = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(result.records.map((record) => record.element)).toEqual([second]);
    expect(result).toMatchObject({ created: 1, removed: 0, skipped: 1 });
  });

  it('excludes an earlier accepted record when a later callback relocates it into internal DOM', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const internalRoot = document.createElement('div');

    first.classList.add('first');
    second.classList.add('second');
    document.body.append(first, second, internalRoot);
    getInternalDomRegistry(document).register(internalRoot, 'render');

    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule(
      {
        selector: '.second',
        label: () => {
          internalRoot.appendChild(first);

          return 'Second';
        },
      },
      1,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: document });

    const result = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(result.records.map((record) => record.element)).toEqual([second]);
    expect(result).toMatchObject({ created: 1, removed: 0, skipped: 1 });

    getInternalDomRegistry(document).release(internalRoot);
  });

  it('excludes an earlier accepted record when a later callback disconnects it from the document', () => {
    const container = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');

    first.classList.add('first');
    second.classList.add('second');
    container.append(first, second);
    document.body.appendChild(container);

    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule(
      {
        selector: '.second',
        label: () => {
          first.remove();

          return 'Second';
        },
      },
      1,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: container });

    const result = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(result.records.map((record) => record.element)).toEqual([second]);
    expect(result).toMatchObject({ created: 1, removed: 0, skipped: 1 });
  });

  it('excludes records relocated into the tracker instance own internal DOM root', () => {
    const source = document.createElement('div');
    const internalRoot = document.createElement('div');

    source.classList.add('source');
    document.body.append(source, internalRoot);
    getInternalDomRegistry(document).register(internalRoot, 'render');

    const rule = createValidatedRule(
      {
        selector: '.source',
        label: (element) => {
          internalRoot.appendChild(element);

          return 'Label';
        },
      },
      0,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: document });

    const result = store.rebuild([createMatch(source, rule)]);

    expect(result).toMatchObject({
      changed: false,
      created: 0,
      removed: 0,
      skipped: 1,
    });
    expect(result.records).toEqual([]);

    getInternalDomRegistry(document).release(internalRoot);
  });
});

/**
 * Correctness coverage for the semantic-input reuse fast path: rebuild()
 * skips constructing new marker records when the ordered match array is
 * semantically identical to the previous rebuild (same element/rule/ruleIndex
 * at every position), and falls back to a full rebuild otherwise. Reuse is
 * proven through record-factory call counts and result shape.
 */
describe('MarkerStore semantic-input reuse', () => {
  afterEach(() => {
    // §8.6/§8.8/§8.9 attach their fixtures to the live document so the match
    // input mirrors what QueryEngine actually produces; clearing the body keeps
    // a leaked container from being observed by a sibling case.
    document.body.replaceChildren();
  });

  it('a second rebuild with semantically identical input does not call the record factory and returns identical records', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const diagnostics = { setCurrentRenderCounts: vi.fn() };
    const store = new MarkerStore({ createRecord, diagnostics });

    const firstResult = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(2);

    // A fresh array of fresh match objects, matching how QueryEngine's full-query
    // path always allocates on every call, even on scroll renders with no actual
    // content change.
    const secondResult = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(2);
    expect(secondResult).toMatchObject({ changed: false, created: 0, removed: 0, skipped: 0 });
    expect(secondResult.records[0]).toBe(firstResult.records[0]);
    expect(secondResult.records[1]).toBe(firstResult.records[1]);
    expect(diagnostics.setCurrentRenderCounts).toHaveBeenLastCalledWith({ markers: 2, clusters: 0 });
  });

  it('any changed element identity at any position forces a full rebuild', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const replacement = document.createElement('div');
    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);
    expect(createRecord).toHaveBeenCalledTimes(2);

    // Same length, same rules/order, but the element at index 1 is a different node.
    const result = store.rebuild([createMatch(first, firstRule), createMatch(replacement, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(4);
    expect(result.records.map((record) => record.element)).toEqual([first, replacement]);
  });

  it('same elements/rules in a different order forces a full rebuild', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);
    expect(createRecord).toHaveBeenCalledTimes(2);

    const result = store.rebuild([createMatch(second, secondRule), createMatch(first, firstRule)]);

    expect(createRecord).toHaveBeenCalledTimes(4);
    expect(result.records.map((record) => record.element)).toEqual([second, first]);
  });

  it('does not reuse across a rule replacement even when the matched element stays the same', () => {
    const source = document.createElement('div');
    const rule = createValidatedRule({ label: 'first', selector: '.source' }, 0);
    const replacementRule = createValidatedRule({ label: 'second', selector: '.source' }, 0);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.rebuild([createMatch(source, rule)]);

    expect(createRecord).toHaveBeenCalledTimes(1);

    const result = store.rebuild([createMatch(source, replacementRule)]);

    expect(createRecord).toHaveBeenCalledTimes(2);
    expect(result.records[0]).toMatchObject({ label: 'second' });
  });

  it('a ruleIndex change at the same position forces a full rebuild', () => {
    const source = document.createElement('div');
    const rule = createValidatedRule({ selector: '.source' }, 0);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.rebuild([createMatch(source, rule)]);
    expect(createRecord).toHaveBeenCalledTimes(1);

    // Same rule object, but reassigned to a different ruleIndex (as if the rules
    // array were reordered upstream without replacing the rule object itself).
    // ruleIndex is itself render-relevant record state, so this is also a genuine
    // content change, not just a forced rebuild with an identical outcome.
    const relocatedMatch: TrackerQueryMatch = { element: source, rule, ruleIndex: 3 };
    const result = store.rebuild([relocatedMatch]);

    expect(createRecord).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ changed: true, created: 0, removed: 0 });
    expect(result.records[0]).toMatchObject({ ruleIndex: 3 });
  });

  it('does not reuse when the match count changes after adding or removing a rule', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.rebuild([createMatch(first, firstRule)]);

    expect(createRecord).toHaveBeenCalledTimes(1);

    const addedResult = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    // The full-rebuild path has no per-match reuse: every match in a full rebuild
    // (triggered here by the match-count mismatch) calls createRecord, including
    // the already-seen `first` match, so the count jumps by 2, not 1.
    expect(createRecord).toHaveBeenCalledTimes(3);
    expect(addedResult).toMatchObject({ changed: true, created: 1, removed: 0 });

    const removedResult = store.rebuild([createMatch(second, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(4);
    expect(removedResult).toMatchObject({ changed: true, created: 0, removed: 1 });
  });

  it('never reuses when a matched rule has a computed (function) label, and the callback is re-evaluated every time', () => {
    const source = document.createElement('div');
    let callCount = 0;
    const rule = createValidatedRule(
      {
        label: () => {
          callCount += 1;
          return `computed-${callCount}`;
        },
        selector: '.source',
      },
      0,
    );
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    const first = store.rebuild([createMatch(source, rule)]);
    const second = store.rebuild([createMatch(source, rule)]);
    const third = store.rebuild([createMatch(source, rule)]);

    expect(createRecord).toHaveBeenCalledTimes(3);
    expect([first, second, third].map((result) => result.records[0]?.label)).toEqual([
      'computed-1',
      'computed-2',
      'computed-3',
    ]);
  });

  it('a rebuild immediately after restore() cannot reuse stale pre-rollback input', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const store = new MarkerStore();

    // Commit A: a single marker.
    const committedA = store.rebuild([createMatch(first, firstRule)]);

    expect(committedA.records.map((record) => record.element)).toEqual([first]);

    // Full rebuild B: a strictly larger match set, so B's cached last-matches
    // snapshot does not describe A's records.
    const rebuiltB = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(rebuiltB.records.map((record) => record.element)).toEqual([first, second]);

    // A failed render rolls back to the committed A snapshot.
    store.restore(committedA.records);

    // Re-running B's exact semantic input: reusing the pre-rollback B cache here
    // would return the restored single-record A state and silently lose `second`.
    const result = store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);

    expect(result).toMatchObject({ changed: true, created: 1, removed: 0 });
    expect(result.records.map((record) => record.element)).toEqual([first, second]);
    expect(result.records[1]).not.toBe(rebuiltB.records[1]);
  });

  it('clear() invalidates the reuse cache and destroy() releases retained records', () => {
    const source = document.createElement('div');
    const rule = createValidatedRule({ selector: '.source' }, 0);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.rebuild([createMatch(source, rule)]);
    expect(createRecord).toHaveBeenCalledTimes(1);

    store.clear();

    // clear() drops the reuse cache, so the next identical rebuild reconstructs.
    const afterClear = store.rebuild([createMatch(source, rule)]);

    expect(createRecord).toHaveBeenCalledTimes(2);
    expect(afterClear).toMatchObject({ changed: true, created: 1, removed: 0 });

    const reused = store.rebuild([createMatch(source, rule)]);

    expect(createRecord).toHaveBeenCalledTimes(2);
    expect(reused).toMatchObject({ changed: false, created: 0, removed: 0 });

    // destroy() is a terminal lifecycle step: it releases every retained record.
    store.destroy();

    expect(store.size).toBe(0);
    expect(store.getAll()).toEqual([]);
  });

  it('an element leaving the valid query subtree is not hidden by reuse once the fresh query result shrinks', () => {
    const container = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');

    container.append(first, second);
    document.body.appendChild(container);

    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.updateContext({ sourceRoot: container });
    store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);
    expect(createRecord).toHaveBeenCalledTimes(2);

    // Emulates QueryEngine re-running a full query after `first` left the composed
    // subtree: the fresh ordered match array simply no longer contains it.
    first.remove();

    const result = store.rebuild([createMatch(second, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ changed: true, created: 0, removed: 1 });
    expect(result.records.map((record) => record.element)).toEqual([second]);
  });

  it('an internal-DOM exclusion change is followed once the fresh query result no longer contains the element', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const internalRoot = document.createElement('div');

    document.body.append(first, second, internalRoot);

    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.updateContext({ sourceRoot: document });
    store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]);
    expect(createRecord).toHaveBeenCalledTimes(2);

    // Emulates QueryEngine excluding `first` from the fresh match array after it
    // became Tracker-owned internal DOM.
    getInternalDomRegistry(document).register(internalRoot, 'render');
    internalRoot.appendChild(first);

    const result = store.rebuild([createMatch(second, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ changed: true, created: 0, removed: 1 });
    expect(result.records.map((record) => record.element)).toEqual([second]);

    getInternalDomRegistry(document).release(internalRoot);
  });

  it('keeps reusing correctly across more than two consecutive identical rebuilds, then detects a real change immediately after', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    const results = [
      store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]),
      store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]),
      store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]),
      store.rebuild([createMatch(first, firstRule), createMatch(second, secondRule)]),
    ];

    expect(createRecord).toHaveBeenCalledTimes(2);
    results.slice(1).forEach((result) => {
      expect(result.changed).toBe(false);
      expect(result.records[0]).toBe(results[0]?.records[0]);
      expect(result.records[1]).toBe(results[0]?.records[1]);
    });

    const afterRemovalResult = store.rebuild([createMatch(second, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(3);
    expect(afterRemovalResult).toMatchObject({ changed: true, created: 0, removed: 1 });
    expect(afterRemovalResult.records.map((record) => record.element)).toEqual([second]);
  });

  it('invalidates the reuse cache when sourceRoot changes via updateContext', () => {
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    const source = document.createElement('div');

    source.classList.add('source');
    containerA.appendChild(source);
    document.body.append(containerA, containerB);

    const rule = createValidatedRule({ selector: '.source' }, 0);
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: containerA });

    const inA = store.rebuild([createMatch(source, rule)]);

    expect(inA).toMatchObject({ changed: true, created: 1, removed: 0 });
    expect(inA.records.map((record) => record.element)).toEqual([source]);

    // A real transition: the element physically moves into container B and the
    // store is told its source root is now B.
    containerB.appendChild(source);
    store.updateContext({ sourceRoot: containerB });

    const inB = store.rebuild([createMatch(source, rule)]);

    expect(inB).toMatchObject({ changed: false, created: 0, removed: 0 });
    expect(inB.records.map((record) => record.element)).toEqual([source]);
    expect(inB.records[0]).not.toBe(inA.records[0]);
  });

  it('keeps first-rule-wins ownership and the skipped count under the reuse fast path', () => {
    const source = document.createElement('div');
    const firstRule = createValidatedRule({ selector: '.first' }, 0);
    const secondRule = createValidatedRule({ selector: '.second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.rebuild([createMatch(source, firstRule), createMatch(source, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(1);

    const result = store.rebuild([createMatch(source, firstRule), createMatch(source, secondRule)]);

    expect(createRecord).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ changed: false, created: 0, removed: 0, skipped: 1 });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ element: source, ruleIndex: 0 });
  });
});

/**
 * A function-valued `rule.label` callback can
 * mutate DOM in a way that invalidates its own owning rule's selector match. These
 * tests pin the fix's immediately-before-commit selector revalidation, its bounded
 * one-rule-per-element fallback to the next originally-matched rule, and its
 * root-scoped (not `Element.prototype.matches()`-based) selector check. All test
 * elements are attached to `document.body` because the fix's revalidation reuses
 * QueryEngine's `toQueryElements`, which (like the real render pipeline) requires
 * `element.isConnected`.
 */
describe('MarkerStore selector revalidation after a selector-changing label() callback', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('drops a stale record when label() removes the class its own selector requires, with no fallback available', () => {
    const source = document.createElement('div');
    source.classList.add('tracked');
    document.body.appendChild(source);

    const rule = createValidatedRule(
      {
        selector: '.tracked',
        label: (element) => {
          element.classList.remove('tracked');
          return 'Label';
        },
      },
      0,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: document });

    const result = store.rebuild([createMatch(source, rule)]);

    expect(result).toMatchObject({ changed: false, created: 0, removed: 0, skipped: 1 });
    expect(result.records).toEqual([]);
    expect(source.classList.contains('tracked')).toBe(false);
  });

  it('drops a stale record when label() removes a non-class selector-relevant attribute, with no fallback available', () => {
    const source = document.createElement('div');
    source.setAttribute('data-tracked', '');
    document.body.appendChild(source);

    const rule = createValidatedRule(
      {
        selector: '[data-tracked]',
        label: (element) => {
          element.removeAttribute('data-tracked');
          return 'Label';
        },
      },
      0,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: document });

    const result = store.rebuild([createMatch(source, rule)]);

    expect(result).toMatchObject({ changed: false, created: 0, removed: 0, skipped: 1 });
    expect(result.records).toEqual([]);
    expect(source.hasAttribute('data-tracked')).toBe(false);
  });

  it('transfers ownership to the next originally-matched rule when the first rule label() invalidates its own selector', () => {
    const source = document.createElement('div');
    source.classList.add('first', 'second');
    document.body.appendChild(source);

    const firstRule = createValidatedRule(
      {
        selector: '.first',
        label: (element) => {
          element.classList.remove('first');
          return 'First';
        },
      },
      0,
    );
    const secondRule = createValidatedRule({ selector: '.second', label: 'Second' }, 1);
    const createRecord = vi.fn(createMarkerRecord);
    const store = new MarkerStore({ createRecord });

    store.updateContext({ sourceRoot: document });

    const result = store.rebuild([createMatch(source, firstRule), createMatch(source, secondRule)]);

    expect(result).toMatchObject({ changed: true, created: 1, removed: 0 });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ element: source, ruleIndex: 1, selector: '.second', label: 'Second' });
    expect(createRecord).toHaveBeenCalledTimes(2);
    expect(source.classList.contains('first')).toBe(false);
    expect(source.classList.contains('second')).toBe(true);
  });

  it('resolves a :scope-relative selector against sourceRoot, not against the element itself', () => {
    const container = document.createElement('div');
    const child = document.createElement('div');

    child.classList.add('tracked');
    container.appendChild(child);
    document.body.appendChild(container);

    const rule = createValidatedRule(
      {
        selector: ':scope > .tracked',
        label: () => 'Label',
      },
      0,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: container });

    // Documents the exact pitfall the fix avoids: Element.prototype.matches()
    // resolves `:scope` to the element it is called on, not to `sourceRoot`, so a
    // naive `element.matches(rule.selector)` revalidation would (incorrectly)
    // never match a rule whose selector is written relative to `sourceRoot`.
    expect(child.matches(rule.selector)).toBe(false);

    const result = store.rebuild([createMatch(child, rule)]);

    expect(result).toMatchObject({ changed: true, created: 1, removed: 0, skipped: 0 });
    expect(result.records[0]).toMatchObject({ element: child, label: 'Label' });
  });

  it('does not add a newly-matching element created as a callback side effect within the same pass, but includes it on the next render', () => {
    const source = document.createElement('div');
    const sibling = document.createElement('div');

    source.classList.add('tracked');
    document.body.append(source, sibling);

    const rule = createValidatedRule(
      {
        selector: '.tracked',
        label: (element) => {
          if (element === source) {
            sibling.classList.add('tracked');
          }

          return 'Label';
        },
      },
      0,
    );
    const store = new MarkerStore();

    store.updateContext({ sourceRoot: document });

    const firstResult = store.rebuild([createMatch(source, rule)]);

    expect(firstResult.records.map((record) => record.element)).toEqual([source]);
    expect(sibling.classList.contains('tracked')).toBe(true);

    const secondResult = store.rebuild([createMatch(source, rule), createMatch(sibling, rule)]);

    expect(secondResult.records.map((record) => record.element)).toEqual([source, sibling]);
  });
});
