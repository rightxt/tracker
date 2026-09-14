// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { RuleStore } from '../RuleStore.js';

/**
 * Creates a diagnostics stub with a recordRule spy for counter assertions.
 *
 * @returns Diagnostics stub.
 */
function createDiagnosticsStub() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    recordRule: vi.fn(),
  };
}

describe('RuleStore', () => {
  it('updates public source rules on a behaviorally equal replace without reporting a change', () => {
    const store = new RuleStore();

    store.replace([{ selector: '.target', scroll: { enabled: true } }]);

    const result = store.replace([{ selector: '.target', scroll: true }]);

    expect(result.changed).toBe(false);
    expect(store.getPublicRules()).toEqual([{ selector: '.target', scroll: true }]);
  });

  it('keeps stored rules when a replace repeats the same public input', () => {
    const store = new RuleStore();
    const rules = [{ selector: '.target', label: 'Target' }];

    store.replace(rules);

    const result = store.replace(rules);

    expect(result.changed).toBe(false);
    expect(store.getPublicRules()).toEqual(rules);
  });

  it('preserves normalized attribute tombstones across get-and-replace round trips', () => {
    const store = new RuleStore();

    store.replace([
      {
        marker: {
          attributes: {
            'DATA-State': null,
            Role: ' button ',
          },
          cssVariables: {
            '--app-accent': 'orange',
            '--rxtt-marker-bg': 'red',
          },
        },
        selector: '.target',
      },
    ]);

    const publicRules = store.getPublicRules();
    const result = store.replace(publicRules);

    expect(publicRules).toEqual([
      {
        marker: {
          attributes: {
            'data-state': null,
            role: 'button',
          },
          cssVariables: {
            '--app-accent': 'orange',
            '--rxtt-marker-bg': 'red',
          },
        },
        selector: '.target',
      },
    ]);
    expect(result.changed).toBe(false);
  });

  it('records added and removed counter deltas for a behavior-changing replace', () => {
    const diagnostics = createDiagnosticsStub();
    const store = new RuleStore({ diagnostics });

    store.replace([{ selector: '.first' }, { selector: '.second' }]);
    diagnostics.recordRule.mockClear();

    const result = store.replace([{ selector: '.second' }, { selector: '.third' }, { selector: '.fourth' }]);

    expect(result.changed).toBe(true);
    expect(diagnostics.recordRule).toHaveBeenCalledWith('added', 2);
    expect(diagnostics.recordRule).toHaveBeenCalledWith('removed', 1);
  });

  it('does not record added or removed counters for a source-only replace', () => {
    const diagnostics = createDiagnosticsStub();
    const store = new RuleStore({ diagnostics });

    store.replace([{ selector: '.target', focus: { enabled: false } }]);
    diagnostics.recordRule.mockClear();

    const result = store.replace([{ selector: '.target', focus: false }]);

    expect(result.changed).toBe(false);
    expect(diagnostics.recordRule).not.toHaveBeenCalled();
  });

  it('rejects labels outside the public string-or-function contract', () => {
    const diagnostics = createDiagnosticsStub();
    const store = new RuleStore({ diagnostics });

    expect(() => store.replace([{ selector: '.target', label: 42 } as never])).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );

    expect(store.getPublicRules()).toEqual([]);
    expect(diagnostics.error).not.toHaveBeenCalled();
  });

  it('rejects an unknown rule option key instead of silently ignoring the typo', () => {
    const diagnostics = createDiagnosticsStub();
    const store = new RuleStore({ diagnostics });

    expect(() => store.add({ mrker: {}, selector: '.target' } as never)).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );

    expect(store.getAll()).toEqual([]);
  });

  it('reindexes rules restored from a snapshot captured before a removal', () => {
    const store = new RuleStore();

    store.replace([{ selector: '.first' }, { selector: '.second' }]);

    const snapshot = store.getAll();

    store.removeByIndex(0);
    store.restoreSnapshot(snapshot);

    expect(store.getAll().map((rule) => rule.index)).toEqual([0, 1]);
  });

  it('keeps removal behavior consistent for index and selector lookups', () => {
    const diagnostics = createDiagnosticsStub();
    const store = new RuleStore({ diagnostics });

    store.replace([{ selector: '.first' }, { selector: '.second' }, { selector: '.third' }]);
    diagnostics.recordRule.mockClear();

    const byIndex = store.removeByIndex(1);
    const bySelector = store.removeBySelector('.first');

    expect(byIndex).toMatchObject({ changed: true, rule: { index: 1, selector: '.second' } });
    expect(bySelector).toMatchObject({ changed: true, rule: { index: 0, selector: '.first' } });
    expect(store.getAll().map((rule) => ({ index: rule.index, selector: rule.selector }))).toEqual([
      { index: 0, selector: '.third' },
    ]);
    expect(diagnostics.recordRule).toHaveBeenCalledTimes(2);
    expect(diagnostics.recordRule).toHaveBeenNthCalledWith(1, 'removed');
    expect(diagnostics.recordRule).toHaveBeenNthCalledWith(2, 'removed');
  });

  it('validateCandidate() rejects a selector already staged in a pending selector set', () => {
    const store = new RuleStore();

    expect(() => store.validateCandidate({ selector: '.pending' }, undefined, new Set(['.pending']))).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });

  it('validateCandidate() allows a committed selector omitted from the pending selector set', () => {
    const store = new RuleStore();

    store.replace([{ selector: '.committed' }]);

    expect(() => store.validateCandidate({ selector: '.committed' }, undefined, new Set())).not.toThrow();
  });

  it('validateCandidate() still rejects a duplicate of an already-committed selector without a pending selector set', () => {
    const store = new RuleStore();

    store.replace([{ selector: '.committed' }]);

    expect(() => store.validateCandidate({ selector: '.committed' })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
  });
});
