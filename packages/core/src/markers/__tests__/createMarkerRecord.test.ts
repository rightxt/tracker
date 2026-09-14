// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { normalizeRule } from '../../rules/normalizeRule.js';
import { validateNormalizedRule } from '../../rules/validateRule.js';
import type { TrackerNormalizedRule, TrackerQueryMatch, TrackerRule } from '../../types.js';
import { createMarkerRecord } from '../createMarkerRecord.js';

/**
 * Creates a query match with a normalized rule stub.
 *
 * @param rule - Normalized rule overrides.
 * @param ruleIndex - Match rule index.
 * @returns Query match.
 */
function createMatch(rule: Record<string, unknown> = {}, ruleIndex = 0): TrackerQueryMatch {
  return {
    element: document.createElement('div'),
    rule: { selector: '.target', ...rule } as unknown as TrackerNormalizedRule,
    ruleIndex,
  };
}

/** Creates a query match backed by the real public-rule normalization path. */
function createValidatedMatch(rule: TrackerRule): TrackerQueryMatch {
  const candidate = normalizeRule(rule, { index: 0 });
  const result = validateNormalizedRule(candidate, { selectorRoot: document });

  if (result.rule === null) {
    throw new Error('Expected marker-record test rule to be valid.');
  }

  return {
    element: document.createElement('div'),
    rule: result.rule,
    ruleIndex: result.rule.index,
  };
}

describe('core marker record factory', () => {
  it('builds keys from the rule by default and from the context key provider when given', () => {
    const match = createMatch({ index: 2 }, 2);

    expect(createMarkerRecord(match)?.key).toBe('2:.target');
    expect(createMarkerRecord(match, { getElementKey: () => 'custom-key' })?.key).toBe('custom-key');
    expect(createMarkerRecord(createMatch())?.key).toBe('0:.target');
    expect(createMarkerRecord(createMatch({ index: 0 }, 5))?.key).toBe('0:.target');
    expect(createMarkerRecord(createMatch({ index: undefined }, 5))?.key).toBe('5:.target');
  });

  it('resolves the rule index from the match with rule fallbacks', () => {
    expect(createMarkerRecord(createMatch({}, 3))?.ruleIndex).toBe(3);
    expect(createMarkerRecord({ ...createMatch({ index: 4 }), ruleIndex: undefined as never })?.ruleIndex).toBe(4);
  });

  it('resolves static and computed labels', () => {
    expect(createMarkerRecord(createMatch({ label: 'Static' }))?.label).toBe('Static');
    expect(createMarkerRecord(createMatch({ label: (element: Element) => element.tagName }))?.label).toBe('DIV');
    expect(createMarkerRecord(createMatch({ label: () => '' }))?.label).toBe('');
    expect(createMarkerRecord(createMatch({ label: () => 42 as never }))?.label).toBeNull();
    expect(createMarkerRecord(createMatch())?.label).toBeNull();
  });

  it('retains canonical rule presentation without copying resolved fields', () => {
    const match = createMatch({
      marker: {
        attributes: { values: { 'data-extra': 'yes' }, removals: new Set<string>() },
        className: 'custom',
        cssVariables: { '--rxtt-marker-bg': 'red' },
        title: false,
      },
    });
    const record = createMarkerRecord(match);

    expect(record?.rule).toBe(match.rule);
    expect(record).not.toHaveProperty('className');
    expect(record).not.toHaveProperty('attributes');
    expect(record).not.toHaveProperty('title');
    expect(record).not.toHaveProperty('cssVariables');
  });

  it('reports a computed-label failure while retaining normalized presentation', () => {
    const diagnostics = { error: vi.fn() };
    const match = createValidatedMatch({
      label: () => {
        throw new Error('label failed');
      },
      marker: {
        attributes: { 'data-test': '1' },
        className: ' custom-marker ',
        cssVariables: { '--rxtt-marker-opacity': '0.8' },
        title: true,
      },
      selector: '.source',
    });

    const record = createMarkerRecord(match, {
      diagnostics,
      getElementKey: () => 'stable-key',
    });

    expect(record).toMatchObject({ key: 'stable-key', label: null });
    expect(record?.rule.marker).toMatchObject({
      className: 'custom-marker',
      cssVariables: { '--rxtt-marker-opacity': '0.8' },
      title: true,
    });
    expect(diagnostics.error).toHaveBeenCalledWith(
      'rule-label-error',
      'Rule label function failed for selector ".source".',
      expect.objectContaining({ error: 'label failed', selector: '.source' }),
    );
  });
});
