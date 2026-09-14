// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { normalizeRule, validateRule, validateRules } from './testIntegration.js';
import { validateNormalizedRule } from '../rules/validateRule.js';

describe('core rules contract', () => {
  it('validates raw rule candidates without exposing normalized-shape assumptions', () => {
    const rawRule = {
      focus: true,
      marker: { className: ' marker-theme ', title: false },
      scroll: false,
      selector: '.target',
    };
    const directResult = validateRule(rawRule);
    const listResult = validateRules([rawRule]);

    expect(directResult.valid).toBe(true);
    expect(directResult.rule).toMatchObject({
      focus: { enabled: true, target: 'self' },
      marker: { className: 'marker-theme', title: false },
      scroll: { enabled: false, target: 'self' },
      selector: '.target',
    });
    expect(directResult.rule).toEqual(listResult.rules[0]);

    [null, undefined, false, 1, 'rule'].forEach((candidate) => {
      expect(() => validateRule(candidate)).not.toThrow();
      expect(validateRule(candidate).valid).toBe(false);
    });

    expect(validateRule({ selector: undefined }).errors.map((error) => error.code)).toContain(
      'invalid-rule-option-value',
    );
    expect(validateRule({ selector: '.target', unsupported: true }).warnings.map((warning) => warning.code)).toContain(
      'WARN_TRACKER_UNKNOWN_RULE_OPTION',
    );
  });

  it('validates complete lists without accepting duplicates or sparse entries', () => {
    const sparseRules = new Array(2);

    sparseRules[1] = { selector: '.target' };

    const duplicateResult = validateRules([{ selector: '.target' }, { selector: ' .target ' }]);
    const sparseResult = validateRules(sparseRules);

    expect(duplicateResult.valid).toBe(false);
    expect(duplicateResult.rules).toHaveLength(1);
    expect(duplicateResult.errors).toHaveLength(0);
    expect(duplicateResult.warnings.map((warning) => warning.code)).toContain('duplicate-rule-selector');
    expect(sparseResult.valid).toBe(false);
    expect(sparseResult.errors.map((error) => error.code)).toContain('invalid-rule');
  });

  it('keeps a rule list valid when every entry is accepted with safe fallbacks', () => {
    const result = validateRules([
      {
        marker: {
          className: 123,
        },
        selector: '.target',
      },
    ]);

    expect(result.valid).toBe(true);
    expect(result.rules).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.map((warning) => warning.code)).toContain('invalid-rule-marker-class-name');
  });

  it('normalizes selectors by trimming and preserves the normalized public source selector', () => {
    const normalizedRule = normalizeRule({
      selector: '  .target  ',
    });

    expect(normalizedRule.selector).toBe('.target');
    expect(normalizedRule.source.selector).toBe('.target');
  });

  it('isolates the public source snapshot from later input mutations', () => {
    const inputRule = {
      selector: '.target',
      marker: {
        attributes: {
          'aria-label': 'Before',
        },
      },
    };
    const normalizedRule = normalizeRule(inputRule);

    inputRule.marker.attributes['aria-label'] = 'After';

    expect((normalizedRule.source as typeof inputRule).marker.attributes['aria-label']).toBe('Before');
  });

  it('rejects duplicate selectors through validation context', () => {
    const normalizedRule = normalizeRule({
      selector: '.target',
    });
    const result = validateNormalizedRule(normalizedRule, {
      hasSelector: (selector) => selector === '.target',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.map((warning) => warning.code)).toContain('duplicate-rule-selector');
  });

  it('filters reserved marker attributes from valid rules', () => {
    const normalizedRule = normalizeRule({
      marker: {
        attributes: {
          'aria-label': 'Target',
          'data-rxtt-key': 'reserved',
        },
      },
      selector: '.target',
    });
    const result = validateNormalizedRule(normalizedRule);

    expect(result.valid).toBe(true);
    expect(result.rule?.marker.attributes).toEqual({
      removals: new Set(),
      values: {
        'aria-label': 'Target',
      },
    });
    expect(result.warnings.map((warning) => warning.code)).toContain('reserved-marker-attribute');
  });

  it('keeps only framework-neutral custom marker attributes', () => {
    const normalizedRule = normalizeRule({
      marker: {
        attributes: {
          'aria-label': 'Target',
          'data-severity': 'critical',
          children: 'unsupported',
          onclick: 'unsupported',
          role: 'button',
          title: 'unsupported',
        },
      },
      selector: '.target',
    });
    const result = validateNormalizedRule(normalizedRule);

    expect(result.valid).toBe(true);
    expect(result.rule?.marker.attributes).toEqual({
      removals: new Set(),
      values: {
        'aria-label': 'Target',
        'data-severity': 'critical',
        role: 'button',
      },
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['invalid-marker-attribute', 'reserved-marker-attribute']),
    );
  });

  it('rejects selector syntax errors when a selector root is provided', () => {
    const normalizedRule = normalizeRule({
      selector: '[',
    });
    const result = validateNormalizedRule(normalizedRule, {
      selectorRoot: document,
    });

    expect(result.valid).toBe(false);
    expect(result.rule).toBeNull();
    expect(result.errors.map((error) => error.code)).toContain('invalid-rule-selector');
  });

  it('sanitizes invalid marker options and custom properties', () => {
    const attributes = JSON.parse('{"__proto__":"preserved"}') as Record<string, unknown>;
    const normalizedRule = normalizeRule({
      marker: {
        attributes: {
          'bad name': 'ignored',
          'bad?name': 'ignored',
          label: { invalid: true },
          bigint: 1n,
          symbol: Symbol('value'),
          ...attributes,
        },
        className: 123,
        cssVariables: {
          '--rxtt-marker-bg': '',
          '--rxtt-track-bg': 'red',
        },
        title: 'yes',
      },
      selector: '.target',
    });
    const result = validateNormalizedRule(normalizedRule);

    expect(result.valid).toBe(true);
    expect(result.rule?.marker.className).toBe('');
    expect(result.rule?.marker.title).toBeUndefined();
    // Exact, not subset: invalid attribute names and the invalid rule-level
    // `--rxtt-track-bg` must be dropped entirely, while the valid shared
    // `--rxtt-marker-bg` keeps its valid empty-string value.
    expect(result.rule?.marker.attributes.values).toEqual({});
    expect(result.rule?.marker.attributes.removals).toEqual(new Set());
    expect(result.rule?.marker.cssVariables).toEqual({ '--rxtt-marker-bg': '' });
    expect(Object.hasOwn(result.rule?.marker.attributes.values ?? {}, '__proto__')).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'invalid-rule-marker-class-name',
        'invalid-rule-marker-title',
        'invalid-marker-attribute',
        'invalid-rule-css-variable-name',
      ]),
    );
  });

  it('applies scroll and focus fallbacks for invalid shorthand object values', () => {
    const normalizedRule = normalizeRule({
      focus: {
        enabled: 'yes',
        target: 123,
      },
      scroll: {
        behavior: 'instant',
        align: 'middle',
        enabled: 'yes',
        target: 123,
      },
      selector: '.target',
    });
    const result = validateNormalizedRule(normalizedRule);

    expect(result.valid).toBe(true);
    expect(result.rule?.scroll).toEqual({
      behavior: 'auto',
      align: 'start',
      enabled: true,
      target: 'self',
    });
    expect(result.rule?.focus).toEqual({
      enabled: false,
      target: 'self',
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'invalid-rule-scroll',
        'invalid-rule-scroll-target',
        'invalid-rule-scroll-behavior',
        'invalid-rule-scroll-align',
        'invalid-rule-focus',
        'invalid-rule-focus-target',
      ]),
    );
  });

  it('reports unknown rule option keys as warnings', () => {
    const result = validateRules([{ marker: {}, mrker: {}, selector: '.target' }]);

    expect(result.valid).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain('WARN_TRACKER_UNKNOWN_RULE_OPTION');
    expect(result.warnings.map((warning) => warning.details?.path)).toContain('mrker');
  });

  it('rejects a null marker container instead of silently applying defaults', () => {
    const normalizedRule = normalizeRule({
      marker: null,
      selector: '.target',
    });
    const result = validateNormalizedRule(normalizedRule);

    expect(result.valid).toBe(true);
    expect(result.rule?.marker.className).toBe('');
    expect(result.warnings.map((warning) => warning.code)).toContain('invalid-rule-marker-class-name');
  });
});
