// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnectedElement } from '../../__tests__/support/connectedElement.js';
import { createTrackerStateIntegration } from '../../__tests__/testIntegration.js';

/** Restores the DOM and spies after each scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * Every reentrant operation below is issued from inside a `sync:end`
 * listener, so `coordinateTrackerOperation()` defers its execution until the
 * dispatch that produced it unwinds. Mutating the caller-owned argument
 * object immediately after the call returns, but still inside the same
 * listener, exercises the window between "call accepted a candidate" and
 * "candidate actually applied", which is unsafe under reentrancy.
 */
describe('Reentrant deferred operations snapshot their arguments at call time', () => {
  it('commits the call-time rule shape when the caller mutates the rule object after addRule returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });

    runtime.on('sync:end', () => {
      const rule = { selector: '.call-time' };

      runtime.addRule(rule, { render: false });
      rule.selector = '.mutated-after-return';
    });

    runtime.mount({ renderRoot });

    expect(runtime.getRules()).toEqual([{ selector: '.call-time' }]);

    runtime.destroy();
  });

  it('commits the call-time insertion index when the caller mutates params after addRule returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      rules: [{ selector: '.a' }, { selector: '.b' }],
    });

    runtime.on('sync:end', () => {
      const params: { index: number; render: boolean } = { index: 0, render: false };

      runtime.addRule({ selector: '.c' }, params);
      params.index = 1;
    });

    runtime.mount({ renderRoot });

    expect(runtime.getRules()).toEqual([{ selector: '.c' }, { selector: '.a' }, { selector: '.b' }]);

    runtime.destroy();
  });

  it('commits the call-time options snapshot when the caller mutates the options object after patchOptions returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });

    runtime.on('sync:end', () => {
      const options: { orientation: 'horizontal' | 'vertical' } = { orientation: 'horizontal' };

      runtime.patchOptions(options, { render: false });
      options.orientation = 'vertical';
    });

    runtime.mount({ renderRoot });

    expect(runtime.getOptions().orientation).toBe('horizontal');

    runtime.destroy();
  });

  it('commits the call-time options snapshot when the caller mutates the options object after replaceOptions returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });

    runtime.on('sync:end', () => {
      const options: { orientation: 'horizontal' | 'vertical' } = { orientation: 'horizontal' };

      runtime.replaceOptions(options, { render: false });
      options.orientation = 'vertical';
    });

    runtime.mount({ renderRoot });

    expect(runtime.getOptions().orientation).toBe('horizontal');

    runtime.destroy();
  });

  it('commits the call-time options and rules when the caller mutates configuration after replaceConfiguration returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });

    runtime.on('sync:end', () => {
      const configuration: { options: { orientation: 'horizontal' | 'vertical' }; rules: { selector: string }[] } = {
        options: { orientation: 'horizontal' },
        rules: [{ selector: '.call-time' }],
      };

      runtime.replaceConfiguration(configuration, { render: false });
      configuration.options.orientation = 'vertical';
      configuration.rules.push({ selector: '.mutated-after-return' });
    });

    runtime.mount({ renderRoot });

    expect(runtime.getOptions().orientation).toBe('horizontal');
    expect(runtime.getRules()).toEqual([{ selector: '.call-time' }]);

    runtime.destroy();
  });

  it('commits the call-time rule list when the caller mutates the rules array after replaceRules returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [{ selector: '.a' }] });

    runtime.on('sync:end', () => {
      const rules = [{ selector: '.call-time' }];

      runtime.replaceRules(rules, { render: false });
      rules.push({ selector: '.mutated-after-return' });
    });

    runtime.mount({ renderRoot });

    expect(runtime.getRules()).toEqual([{ selector: '.call-time' }]);

    runtime.destroy();
  });

  it('commits the call-time nested marker attributes when the caller mutates them on the rule object after addRule returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });

    runtime.on('sync:end', () => {
      const rule = { marker: { attributes: { 'data-state': 'call-time' } }, selector: '.call-time' };

      runtime.addRule(rule, { render: false });
      rule.marker.attributes['data-state'] = 'mutated-after-return';
    });

    runtime.mount({ renderRoot });

    expect(runtime.getRules()[0]?.marker?.attributes).toEqual({ 'data-state': 'call-time' });

    runtime.destroy();
  });

  it('commits the call-time nested marker attributes when the caller mutates them on the options object after patchOptions returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });

    runtime.on('sync:end', () => {
      const options = { marker: { attributes: { 'data-state': 'call-time' } } };

      runtime.patchOptions(options, { render: false });
      options.marker.attributes['data-state'] = 'mutated-after-return';
    });

    runtime.mount({ renderRoot });

    expect(runtime.getOptions().marker?.attributes).toEqual({ 'data-state': 'call-time' });

    runtime.destroy();
  });

  it('preserves diagnostics.output identity across the options snapshot used for a reentrant patchOptions call', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });
    const diagnosticsOutput = { error: vi.fn(), warn: vi.fn() };

    runtime.on('sync:end', () => {
      runtime.patchOptions({ diagnostics: { output: diagnosticsOutput } }, { render: false });
    });

    runtime.mount({ renderRoot });

    expect(runtime.getOptions().diagnostics.output).toBe(diagnosticsOutput);

    runtime.destroy();
  });

  it('does not surface a deferred validation failure when params become invalid after patchOptions returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });
    const deferredErrors: unknown[] = [];

    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });

    runtime.on('sync:end', () => {
      const params: { render: boolean } = { render: false };

      runtime.patchOptions({ orientation: 'horizontal' }, params);
      (params as { render: unknown }).render = 'not-a-boolean';
    });

    runtime.mount({ renderRoot });

    expect(deferredErrors).toEqual([]);
    expect(runtime.getOptions().orientation).toBe('horizontal');

    runtime.destroy();
  });

  it('does not surface a deferred validation failure when addRule params become invalid after the call returns', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });
    const deferredErrors: unknown[] = [];

    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });

    runtime.on('sync:end', () => {
      const params: { render: boolean; index: number } = { render: false, index: 0 };

      runtime.addRule({ selector: '.call-time' }, params);
      (params as { render: unknown; index: number }).render = 'not-a-boolean';
      params.index = -5;
    });

    runtime.mount({ renderRoot });

    expect(deferredErrors).toEqual([]);
    expect(runtime.getRules()).toEqual([{ selector: '.call-time' }]);

    runtime.destroy();
  });
});
