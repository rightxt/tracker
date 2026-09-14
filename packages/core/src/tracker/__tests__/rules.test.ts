// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnectedElement } from '../../__tests__/support/connectedElement.js';
import {
  createTrackerIntegrationInstance,
  createTrackerStateIntegration,
  destroyTrackerInstance,
  mountTrackerInstance,
} from '../../__tests__/testIntegration.js';
import { TrackerConfigurationError, TrackerLifecycleError } from '../../errors.js';
import { addTrackerInstanceRule, clearTrackerInstanceRules } from '../rules.js';

/** Restores the DOM and spies after each rule-mutation scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Reentrant rule mutation coordination', () => {
  it('rejects a reentrant addRule call for an already-pending selector as a duplicate', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [],
    });
    let duplicateError: unknown = null;

    runtime.mount({ renderRoot });
    vi.spyOn(runtime.instance.renderer, 'renderTrack').mockImplementationOnce(() => {
      runtime.addRule({ selector: '.reentrant-rule' }, { render: false });

      try {
        runtime.addRule({ selector: '.reentrant-rule' }, { render: false });
      } catch (error) {
        duplicateError = error;
      }
    });

    runtime.render();

    expect(duplicateError).toEqual(
      expect.objectContaining({
        code: 'ERR_TRACKER_INVALID_CONFIGURATION',
        name: TrackerConfigurationError.name,
      }),
    );
    expect(runtime.getRules().filter((rule) => rule.selector === '.reentrant-rule')).toHaveLength(1);

    runtime.destroy();
  });

  it('releases a reserved pending selector when a reentrant addRule is rejected as a transition-in-progress error', () => {
    const renderRoot = createConnectedElement();
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    instance = createTrackerIntegrationInstance(
      {
        options: {
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [],
      },
      {
        getInstance: () => instance,
        renderer: {
          mount() {
            addTrackerInstanceRule(instance!, { selector: '.ghost' });
            return renderRoot;
          },
          unmount: vi.fn(),
        },
      },
    );

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'root', root: renderRoot } })).toThrow(
      expect.objectContaining({
        code: 'ERR_TRACKER_TRANSITION_IN_PROGRESS',
        name: TrackerLifecycleError.name,
      }),
    );
    expect(instance.lifecycleState).toBe('unmounted');
    expect(instance.ruleStore.getPublicRules()).toEqual([]);

    expect(() => addTrackerInstanceRule(instance!, { selector: '.ghost' })).not.toThrow();
    expect(instance.ruleStore.getPublicRules()).toEqual([{ selector: '.ghost' }]);

    destroyTrackerInstance(instance);
  });

  it('allows a reentrant addRule to reuse a selector removed earlier in the same deferred batch', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.existing' }],
    });
    let reentrantError: unknown = null;

    runtime.on('sync:end', () => {
      try {
        runtime.removeRuleBySelector('.existing', { render: false });
        runtime.addRule({ selector: '.existing' }, { render: false });
      } catch (error) {
        reentrantError = error;
      }
    });

    runtime.mount({ renderRoot });

    expect(reentrantError).toBeNull();
    expect(runtime.getRules()).toEqual([{ selector: '.existing' }]);

    runtime.destroy();
  });

  it('allows a reentrant addRule to reuse an existing selector after a reentrant clearRules in the same deferred batch', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.existing' }],
    });
    let reentrantError: unknown = null;

    runtime.on('sync:end', () => {
      try {
        runtime.replaceRules([], { render: false });
        runtime.addRule({ selector: '.existing' }, { render: false });
      } catch (error) {
        reentrantError = error;
      }
    });

    runtime.mount({ renderRoot });

    expect(reentrantError).toBeNull();
    expect(runtime.getRules()).toEqual([{ selector: '.existing' }]);

    runtime.destroy();
  });
});

describe('ordered pending rule-operation projection', () => {
  it('accepts an indexed add against projected growth in the same deferred batch', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });
    const deferredErrors: unknown[] = [];
    let caught: unknown = null;

    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });
    runtime.on('sync:end', () => {
      runtime.addRule({ selector: '.a' }, { render: false });

      try {
        runtime.addRule({ selector: '.b' }, { index: 1, render: false });
      } catch (error) {
        caught = error;
      }
    });

    runtime.mount({ renderRoot });

    expect(caught).toBeNull();
    expect(deferredErrors).toEqual([]);
    expect(runtime.getRules()).toEqual([{ selector: '.a' }, { selector: '.b' }]);

    runtime.destroy();
  });

  it('rejects an indexed add synchronously against projected shrink', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [{ selector: '.a' }] });
    let caught: unknown = null;

    runtime.on('sync:end', () => {
      runtime.replaceRules([], { render: false });

      try {
        runtime.addRule({ selector: '.b' }, { index: 1, render: false });
      } catch (error) {
        caught = error;
      }
    });

    runtime.mount({ renderRoot });

    expect(caught).toEqual(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }));
    expect(runtime.getRules()).toEqual([]);

    runtime.destroy();
  });

  it('projects rules from a queued atomic configuration replacement into a later reentrant add', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [{ selector: '.a' }] });
    const deferredErrors: unknown[] = [];
    let addError: unknown = null;

    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });

    runtime.on('sync:end', () => {
      runtime.replaceConfiguration({ options: {}, rules: [{ selector: '.b' }] }, { render: false });

      try {
        runtime.addRule({ selector: '.b' }, { render: false });
      } catch (error) {
        addError = error;
      }
    });

    runtime.mount({ renderRoot });

    expect(addError).toEqual(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION', name: TrackerConfigurationError.name }),
    );
    expect(deferredErrors).toEqual([]);
    expect(runtime.getRules()).toEqual([{ selector: '.b' }]);

    runtime.destroy();
  });

  it('synchronously rejects a reentrant duplicate add validated after an intervening indexed remove in the same batch', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.a' }],
    });
    const deferredErrors: unknown[] = [];
    let thirdCallError: unknown = null;

    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });

    runtime.on('sync:end', () => {
      runtime.addRule({ selector: '.b' }, { index: 0, render: false });
      runtime.removeRuleByIndex(0, { render: false });

      try {
        runtime.addRule({ selector: '.a' }, { render: false });
      } catch (error) {
        thirdCallError = error;
      }
    });

    runtime.mount({ renderRoot });

    expect(thirdCallError).toEqual(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION', name: TrackerConfigurationError.name }),
    );
    expect(deferredErrors).toEqual([]);
    expect(runtime.getRules()).toEqual([{ selector: '.a' }]);

    runtime.destroy();
  });

  it('accepts a reentrant addRule validated against an earlier queued full rule-list replacement in the same batch', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.a' }],
    });
    const deferredErrors: unknown[] = [];
    let addError: unknown = null;

    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });

    runtime.on('sync:end', () => {
      runtime.replaceRules([{ selector: '.b' }], { render: false });

      try {
        runtime.addRule({ selector: '.a' }, { render: false });
      } catch (error) {
        addError = error;
      }
    });

    runtime.mount({ renderRoot });

    expect(addError).toBeNull();
    expect(deferredErrors).toEqual([]);
    expect(runtime.getRules()).toEqual([{ selector: '.b' }, { selector: '.a' }]);

    runtime.destroy();
  });

  it('keeps a still-pending duplicate-selector removal reservation intact after an earlier one for the same selector settles', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.a' }],
    });
    const deferredErrors: unknown[] = [];
    let reAddError: unknown = null;

    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });

    runtime.on('sync:end', () => {
      runtime.removeRuleBySelector('.a', { render: false });
      runtime.removeRuleBySelector('.a', { render: false });

      try {
        runtime.addRule({ selector: '.a' }, { render: false });
      } catch (error) {
        reAddError = error;
      }
    });

    runtime.mount({ renderRoot });

    expect(reAddError).toBeNull();
    expect(deferredErrors).toEqual([]);
    expect(runtime.getRules()).toEqual([{ selector: '.a' }]);

    runtime.destroy();
  });

  it('projects a mixed batch of full-list replacement, indexed insertion/removal and clearRules in call order', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.a' }, { selector: '.b' }],
    });
    const deferredErrors: unknown[] = [];
    const caughtErrors: unknown[] = [];

    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });

    runtime.on('sync:end', () => {
      try {
        runtime.replaceRules([{ selector: '.x' }, { selector: '.y' }], { render: false });
        runtime.addRule({ selector: '.z' }, { index: 0, render: false });
        runtime.removeRuleByIndex(0, { render: false });
        runtime.replaceRules([], { render: false });
        runtime.addRule({ selector: '.w' }, { render: false });
      } catch (error) {
        caughtErrors.push(error);
      }
    });

    runtime.mount({ renderRoot });

    expect(caughtErrors).toEqual([]);
    expect(deferredErrors).toEqual([]);
    expect(runtime.getRules()).toEqual([{ selector: '.w' }]);

    runtime.destroy();
  });
});

describe('strict rule-index validation', () => {
  it('rejects fractional insertion indexes without changing rules', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.a' }, { selector: '.b' }],
    });
    runtime.mount({ renderRoot });

    expect(() => runtime.addRule({ selector: '.c' }, { index: 0.5, render: false })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );
    expect(runtime.getRules()).toEqual([{ selector: '.a' }, { selector: '.b' }]);

    runtime.destroy();
  });

  it.each([
    ['Number.NaN', Number.NaN],
    ['a negative index', -1],
    ['a fractional index', 1.5],
    ['an out-of-range index', 2],
  ])('rejects removeRuleByIndex() with %s as a fully side-effect-free operation', (_label, index) => {
    const renderRoot = createConnectedElement();
    const output = { warn: vi.fn(), error: vi.fn() };
    const runtime = createTrackerStateIntegration({
      options: {
        diagnostics: { output },
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.a' }, { selector: '.b' }],
    });
    runtime.mount({ renderRoot });

    const warningListener = vi.fn();

    runtime.on('warning', warningListener);

    const optionsBefore = runtime.getOptions();
    const statsBefore = runtime.getStats();
    const snapshotDiagnosticsBefore = runtime.getSnapshot().diagnostics;

    expect(() => runtime.removeRuleByIndex(index, { render: false })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );

    expect(runtime.getRules()).toEqual([{ selector: '.a' }, { selector: '.b' }]);
    expect(runtime.getOptions()).toEqual(optionsBefore);
    expect(runtime.getStats().warnings).toEqual(statsBefore.warnings);
    expect(runtime.getStats().renders.requested).toBe(statsBefore.renders.requested);
    expect(runtime.getSnapshot().diagnostics).toEqual(snapshotDiagnosticsBefore);
    expect(output.warn).not.toHaveBeenCalled();
    expect(warningListener).not.toHaveBeenCalled();

    runtime.destroy();
  });

  it('does not let a warning listener reentrantly mutate Tracker state before an invalid removeRuleByIndex() rejection', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.a' }],
    });
    runtime.mount({ renderRoot });

    const warningListener = vi.fn(() => {
      runtime.patchOptions({ placement: 'right' }, { render: false });
    });

    runtime.on('warning', warningListener);

    expect(runtime.getOptions().placement).toBe('left');

    expect(() => runtime.removeRuleByIndex(Number.NaN, { render: false })).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }),
    );

    expect(warningListener).not.toHaveBeenCalled();
    expect(runtime.getOptions().placement).toBe('left');
    expect(runtime.getRules()).toEqual([{ selector: '.a' }]);

    runtime.destroy();
  });
});

describe('replaceRules strict input', () => {
  it('rejects undefined without changing rules', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.existing' }],
    });
    runtime.mount({ renderRoot });

    expect(() => runtime.replaceRules(undefined as never, { render: false })).toThrow(TypeError);
    expect(runtime.getRules()).toEqual([{ selector: '.existing' }]);

    runtime.destroy();
  });

  it('throws TypeError when replaceRules is called with null', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.existing' }],
    });

    runtime.mount({ renderRoot });

    expect(() => runtime.replaceRules(null as never, { render: false })).toThrow(TypeError);
    expect(runtime.getRules()).toEqual([{ selector: '.existing' }]);

    runtime.destroy();
  });
});

describe('no-op rule mutations do not publish a snapshot', () => {
  it('does not publish a snapshot for removeRuleBySelector with a non-existent selector', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ options: {}, rules: [{ selector: '.existing' }] });

    runtime.mount({ renderRoot });
    const listener = vi.fn();

    runtime.subscribe(listener);

    runtime.removeRuleBySelector('.missing');

    expect(runtime.getRules()).toEqual([{ selector: '.existing' }]);
    expect(listener).not.toHaveBeenCalled();

    runtime.destroy();
  });

  it('does not publish a snapshot for clearRules on an already-empty rule list', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ options: {}, rules: [] });

    runtime.mount({ renderRoot });
    const listener = vi.fn();

    runtime.subscribe(listener);
    clearTrackerInstanceRules(runtime.instance);

    expect(listener).not.toHaveBeenCalled();

    runtime.destroy();
  });

  it('still publishes a snapshot when addRule genuinely changes the rule list', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ options: {}, rules: [] });

    runtime.mount({ renderRoot });
    const listener = vi.fn();

    runtime.subscribe(listener);
    runtime.addRule({ selector: '.new-rule' });

    expect(listener).toHaveBeenCalledTimes(1);

    runtime.destroy();
  });
});
