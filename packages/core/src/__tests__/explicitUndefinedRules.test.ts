// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { TrackerConfigurationError, createTrackerStateIntegration } from './testIntegration.js';
import { ALLOWED_RULE_SHAPE } from '../rules/ruleSchema.js';
import { setPath } from '../utils/path.js';
import { collectSchemaLeafPaths } from './support/schemaLeafPaths.js';

/** Every fixed rule field declared in ALLOWED_RULE_SHAPE, as a dot-separated path. */
const RULE_LEAF_PATHS = collectSchemaLeafPaths(ALLOWED_RULE_SHAPE);

/**
 * Builds a rule candidate with a valid selector and a single own `undefined`
 * leaf at the given dot-separated path.
 *
 * @param path - Dot-separated rule field path.
 * @returns Rule candidate with one own-`undefined` leaf.
 */
function buildOwnUndefinedRule(path: string): Record<string, unknown> {
  const input: Record<string, unknown> = { selector: '.target' };

  setPath(input, path, undefined);

  return input;
}

describe('rule field own-undefined rejection', () => {
  it('rejects an own undefined leaf at every declared rule field path in the initial rule list and through replaceRules()', () => {
    const failures: string[] = [];
    const isExpectedRejection = (error: unknown): boolean =>
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'ERR_TRACKER_INVALID_CONFIGURATION';

    RULE_LEAF_PATHS.forEach((path) => {
      const rule = buildOwnUndefinedRule(path);

      try {
        createTrackerStateIntegration({ options: {}, rules: [rule as never] });
        failures.push(`initial rule list at "${path}": no rejection was thrown`);
      } catch (error) {
        if (!isExpectedRejection(error)) {
          failures.push(`initial rule list at "${path}": unexpected rejection (${String(error)})`);
        }
      }

      const runtime = createTrackerStateIntegration({ options: {}, rules: [] });

      try {
        runtime.replaceRules([rule as never]);
        failures.push(`replaceRules() at "${path}": no rejection was thrown`);
      } catch (error) {
        if (!isExpectedRejection(error)) {
          failures.push(`replaceRules() at "${path}": unexpected rejection (${String(error)})`);
        }
      } finally {
        runtime.destroy();
      }
    });

    expect(failures).toEqual([]);
  });

  it('does not partially commit a rule list when a later rule is invalid', () => {
    const runtime = createTrackerStateIntegration({
      options: {},
      rules: [{ selector: '.already-valid' }],
    });

    expect(() =>
      runtime.replaceRules([{ selector: '.new-valid' }, { selector: '.broken', label: undefined as never }]),
    ).toThrow(TrackerConfigurationError);

    expect(runtime.getRules().map((rule) => rule.selector)).toEqual(['.already-valid']);

    runtime.destroy();
  });
});

describe('rule marker attribute value matrix', () => {
  it('accepts string, finite-number, and boolean attribute values', () => {
    const runtime = createTrackerStateIntegration({
      options: {},
      rules: [
        {
          marker: { attributes: { 'aria-hidden': true, 'aria-label': 'Marker', 'data-count': 3 } },
          selector: '.target',
        },
      ],
    });

    expect(runtime.getRules()[0]?.marker?.attributes).toEqual({
      'aria-hidden': 'true',
      'aria-label': 'Marker',
      'data-count': '3',
    });

    runtime.destroy();
  });

  it('treats a null attribute value as a removal tombstone rather than a rejected value', () => {
    const runtime = createTrackerStateIntegration({
      options: {},
      rules: [{ marker: { attributes: { 'aria-label': null } }, selector: '.target' }],
    });

    expect(runtime.getRules()[0]?.marker?.attributes).toEqual({ 'aria-label': null });

    runtime.destroy();
  });

  it('rejects an own undefined attribute value', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: {},
        rules: [{ marker: { attributes: { 'aria-label': undefined as never } }, selector: '.target' }],
      }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects an attribute value of an unsupported type', () => {
    expect(() =>
      createTrackerStateIntegration({
        options: {},
        rules: [{ marker: { attributes: { 'aria-label': { nested: true } as never } }, selector: '.target' }],
      }),
    ).toThrow(TrackerConfigurationError);
  });
});

describe('rule list array own-undefined element and sparse-hole matrix', () => {
  it('rejects an explicit undefined element inside the rule list', () => {
    expect(() =>
      createTrackerStateIntegration({ options: {}, rules: [{ selector: '.target' }, undefined as never] }),
    ).toThrow(TrackerConfigurationError);
  });

  it('rejects a sparse hole inside the rule list', () => {
    const rules = new Array<unknown>(2);

    rules[0] = { selector: '.target' };

    expect(() => createTrackerStateIntegration({ options: {}, rules: rules as never })).toThrow(
      TrackerConfigurationError,
    );
  });
});

describe('addRule() and rule-removal operation params', () => {
  it('rejects addRule() with an own undefined params.index', () => {
    const runtime = createTrackerStateIntegration({ options: {}, rules: [] });

    expect(() => runtime.addRule({ selector: '.target' }, { index: undefined as never })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );

    runtime.destroy();
  });

  it('rejects addRule() with an own undefined params.render', () => {
    const runtime = createTrackerStateIntegration({ options: {}, rules: [] });

    expect(() => runtime.addRule({ selector: '.target' }, { render: undefined as never })).toThrow(
      TrackerConfigurationError,
    );

    runtime.destroy();
  });

  it('accepts addRule() when params is entirely omitted', () => {
    const runtime = createTrackerStateIntegration({ options: {}, rules: [] });

    expect(() => runtime.addRule({ selector: '.target' })).not.toThrow();
    expect(runtime.getRules()).toHaveLength(1);

    runtime.destroy();
  });

  it('rejects removeRuleByIndex() with an own undefined params.render', () => {
    const runtime = createTrackerStateIntegration({ options: {}, rules: [{ selector: '.target' }] });

    expect(() => runtime.removeRuleByIndex(0, { render: undefined as never })).toThrow(TrackerConfigurationError);

    runtime.destroy();
  });
});
