// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnectedElement } from '../../__tests__/support/connectedElement.js';
import {
  createTrackerIntegrationInstance,
  createTrackerStateIntegration,
  destroyTrackerInstance,
  mountTrackerInstance,
  patchTrackerInstanceOptions,
  replaceTrackerInstanceOptions,
  subscribeTrackerInstanceSnapshot,
  unmountTrackerInstance,
} from '../../__tests__/testIntegration.js';
import { TrackerLifecycleError } from '../../errors.js';
import { renderTrackerInstance } from '../rendering.js';
import { emitTrackerInstanceSnapshot } from '../snapshotStore.js';

/** Restores the DOM and spies after each lifecycle scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lifecycle and publication contract', () => {
  it('keeps the initial publication batch indivisible before a reentrant destroy', () => {
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
    const sequence: string[] = [];

    runtime.on('sync:start', () => {
      sequence.push('sync:start');
      runtime.destroy();
    });
    runtime.on('sync:end', () => sequence.push('sync:end'));
    runtime.on('destroy', () => sequence.push('destroy'));
    runtime.subscribe((snapshot) => {
      sequence.push(snapshot.lifecycle.destroyed ? 'snapshot:destroyed' : 'snapshot:mounted');
    });

    runtime.mount({ renderRoot });

    expect(sequence).toEqual(['sync:start', 'sync:end', 'snapshot:mounted', 'destroy', 'snapshot:destroyed']);
    expect(runtime.isDestroyed()).toBe(true);
  });

  it('stops non-terminating render feedback and remains usable after unsubscribe', () => {
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
    const renderAgain = vi.fn(() => runtime.render());

    runtime.mount({ renderRoot });
    runtime.on('sync:end', renderAgain);

    expect(() => runtime.render()).toThrow(
      expect.objectContaining({
        code: 'ERR_TRACKER_REENTRANCY_LIMIT',
        name: TrackerLifecycleError.name,
      }),
    );
    // The feedback loop must actually have recursed for the guard to fire; the
    // exact internal batch cutoff is an implementation detail and is not asserted.
    expect(renderAgain).toHaveBeenCalled();
    expect(runtime.getStats().errors.byCode.ERR_TRACKER_REENTRANCY_LIMIT).toBe(1);

    runtime.off('sync:end', renderAgain);

    expect(() => runtime.render()).not.toThrow();

    runtime.destroy();
  });

  it('defers a terminal operation triggered from a transitional renderer callback', () => {
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
            unmountTrackerInstance(instance!);
            return renderRoot;
          },
          unmount: vi.fn(),
        },
      },
    );

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'root', root: renderRoot } })).not.toThrow();
    expect(instance.lifecycleState).toBe('unmounted');
    expect(instance.runtimeContext).toBeNull();

    destroyTrackerInstance(instance);
  });

  it('rejects a non-terminal direct operation from a transitional renderer callback', () => {
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
            replaceTrackerInstanceOptions(instance!, {});
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

    destroyTrackerInstance(instance);
  });

  it('contains a transition-rejected same-instance mutation from an initial label resolver without aborting mount', () => {
    // Cross-boundary sentinel: an initial mount is still in the `mounting`
    // lifecycle transition while the marker layer resolves rule labels, so a
    // same-instance `patchOptions` from a label resolver is transition-rejected.
    // The rejection stays contained by the marker-record resolver boundary: the
    // label falls back to `null`, the reentrant mutation is never committed, and
    // the mount completes. Direct owners (createMarkerRecord.test.ts,
    // resolveObserverTargets.test.ts) cover resolver failure and observer
    // resolver fallback, but never inside a real mount transition.
    const source = createConnectedElement();
    const renderRoot = createConnectedElement();

    source.className = 'resolver-mutation-source';
    const runtime = createTrackerStateIntegration({
      options: {
        diagnostics: { warnings: false },
        placement: 'right',
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [
        {
          label: () => {
            runtime.patchOptions({ placement: 'left' });

            return 'Mutated label';
          },
          selector: '.resolver-mutation-source',
        },
      ],
    });
    const diagnosticsError = vi.spyOn(runtime.instance.diagnostics, 'error');

    runtime.mount({ renderRoot, sourceRoot: document.body });

    expect(runtime.isMounted()).toBe(true);
    expect(runtime.getSnapshot().options.placement).toBe('right');
    expect(runtime.getSnapshot().markers[0]?.label).toBeNull();
    expect(runtime.getStats().errors.byCode['rule-label-error']).toBe(1);

    const labelErrorCalls = diagnosticsError.mock.calls.filter(([code]) => code === 'rule-label-error');

    expect(labelErrorCalls).toHaveLength(1);
    expect(labelErrorCalls[0]?.[2]).toEqual(
      expect.objectContaining({ error: expect.stringContaining('during a lifecycle transition') }),
    );

    runtime.destroy();
  });

  it('drains stable reentrant mutations before rethrowing the original render error', () => {
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
    const renderError = new Error('direct render failure');

    runtime.mount({ renderRoot });
    vi.spyOn(runtime.instance.renderer, 'renderTrack').mockImplementationOnce(() => {
      runtime.addRule({ selector: '.queued-rule' }, { render: false });
      throw renderError;
    });

    expect(() =>
      renderTrackerInstance(runtime.instance, 'all', { source: 'lifecycle-test' }, { throwErrors: true }),
    ).toThrow(renderError);
    expect(runtime.getRules()).toEqual([expect.objectContaining({ selector: '.queued-rule' })]);

    runtime.destroy();
  });

  it('synchronously rejects an invalid reentrant options update instead of only reporting it as a deferred-operation diagnostic', () => {
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
    const deferredErrors: unknown[] = [];
    let caught: unknown = null;

    runtime.mount({ renderRoot });
    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });
    runtime.on('sync:end', () => {
      try {
        runtime.patchOptions({ unsupportedOption: true } as never);
      } catch (error) {
        caught = error;
      }
    });

    expect(() => runtime.render()).not.toThrow();
    expect(caught).toEqual(expect.objectContaining({ code: 'ERR_TRACKER_INVALID_CONFIGURATION' }));
    expect(deferredErrors).toEqual([]);

    runtime.destroy();
  });

  it('revalidates live lifecycle when an accepted reentrant render is finally drained', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [{ selector: '.a' }] });
    const deferredErrors: Array<Record<string, unknown> | null | undefined> = [];

    runtime.mount({ renderRoot });
    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });
    runtime.on('sync:end', () => {
      // Both operations are queued while the instance is still mounted, so the
      // reentrant render is admissible at call time. The unmount drains first
      // (FIFO), so when the render is finally drained it re-checks the live
      // lifecycle, is now inadmissible, and is reported as a deferred-operation
      // error instead of running against a torn-down instance.
      runtime.unmount();
      runtime.render();
    });

    runtime.render();

    expect(deferredErrors).toEqual([
      expect.objectContaining({ operation: 'render', error: expect.stringContaining('before Tracker.mount()') }),
    ]);
    expect(runtime.isMounted()).toBe(false);
    expect(runtime.instance.dirtyRenderTarget).toBeNull();

    runtime.destroy();
  });

  it('lets a reentrant options update validate against an earlier queued update instead of the stale committed options', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        orientation: 'vertical',
        placement: 'right',
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [],
    });
    const deferredErrors: unknown[] = [];
    let secondUpdateThrew: unknown = null;

    runtime.mount({ renderRoot });
    vi.spyOn(runtime.instance.diagnostics, 'error').mockImplementation((code, _message, details) => {
      if (code === 'deferred-operation-error') {
        deferredErrors.push(details);
      }
    });
    runtime.on('sync:end', () => {
      runtime.patchOptions({ orientation: 'horizontal' });

      try {
        runtime.patchOptions({ placement: 'top' });
      } catch (error) {
        secondUpdateThrew = error;
      }
    });

    expect(() => runtime.render()).not.toThrow();
    expect(secondUpdateThrew).toBeNull();
    expect(deferredErrors).toEqual([]);
    expect(runtime.instance.options.orientation).toBe('horizontal');
    expect(runtime.instance.options.placement).toBe('top');

    runtime.destroy();
  });

  it('restores the previous options projection after a later transition-rejected update', () => {
    const renderRoot = createConnectedElement();
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;
    let replacementError: unknown = null;
    let dependentPatchError: unknown = null;

    instance = createTrackerIntegrationInstance(
      { rules: [] },
      {
        getInstance: () => instance,
        renderer: {
          mount: () => renderRoot,
          unmount() {
            try {
              replaceTrackerInstanceOptions(instance!, {});
            } catch (error) {
              replacementError = error;
            }

            try {
              patchTrackerInstanceOptions(instance!, { a11y: { keyboard: true } });
            } catch (error) {
              dependentPatchError = error;
            }
          },
        },
      },
    );
    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root: renderRoot } });
    let queued = false;

    subscribeTrackerInstanceSnapshot(instance, () => {
      if (queued) {
        return;
      }

      queued = true;
      unmountTrackerInstance(instance!);
      patchTrackerInstanceOptions(instance!, { a11y: { enabled: true } });
    });

    emitTrackerInstanceSnapshot(instance);

    expect(replacementError).toEqual(expect.objectContaining({ code: 'ERR_TRACKER_TRANSITION_IN_PROGRESS' }));
    expect(dependentPatchError).toEqual(expect.objectContaining({ code: 'ERR_TRACKER_TRANSITION_IN_PROGRESS' }));
    expect(instance.options.a11y).toMatchObject({ enabled: true });

    destroyTrackerInstance(instance);
  });

  it('reports the exact public configuration mutation source to render scheduling', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({ rules: [] });

    runtime.mount({ renderRoot });
    const request = vi.spyOn(runtime.instance.scheduler, 'request').mockImplementation(() => {});
    const expectLastSource = (source: string) => {
      expect(request.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ source }));
    };

    runtime.patchOptions({ marker: { className: 'patched' } });
    expectLastSource('patchOptions');

    runtime.replaceOptions({ marker: { className: 'replaced' } });
    expectLastSource('replaceOptions');

    runtime.replaceRules([{ selector: '.first' }]);
    expectLastSource('replaceRules');

    runtime.replaceConfiguration({
      options: { marker: { className: 'configured' } },
      rules: [{ selector: '.second' }],
    });
    expectLastSource('replaceConfiguration');

    runtime.destroy();
  });

  it('rolls back options, rules, diagnostics and observers after observer reconfiguration fails', () => {
    const renderRoot = createConnectedElement();
    const previousOutput = { warn: vi.fn() };
    const nextOutput = { warn: vi.fn() };
    const runtime = createTrackerStateIntegration({
      options: {
        diagnostics: { output: previousOutput },
        updates: {
          mutation: { enabled: false, debounce: 10 },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.previous-rule' }],
    });
    const updateError = new Error('observer update failed');

    runtime.mount({ renderRoot });
    const previousRuleCounters = runtime.getStats().rules;
    const observerUpdate = vi.spyOn(runtime.instance.observerController, 'update').mockImplementationOnce(() => {
      throw updateError;
    });

    expect(() =>
      runtime.replaceConfiguration({
        options: {
          diagnostics: { output: nextOutput },
          updates: { mutation: { enabled: false, debounce: 77 } },
        },
        rules: [{ selector: '.next-rule' }],
      }),
    ).toThrow(updateError);

    // Committed options, rules and rule counters are all restored to the
    // pre-transaction state.
    expect(runtime.instance.options.updates?.mutation?.debounce).toBe(10);
    expect(runtime.getRules()).toEqual([{ selector: '.previous-rule' }]);
    expect(runtime.getStats().rules).toEqual(previousRuleCounters);

    // The observer subsystem is re-synchronized with the previous options after
    // its forward update failed.
    expect(observerUpdate).toHaveBeenCalledTimes(2);
    expect(observerUpdate.mock.calls[1]?.[0]).toMatchObject({ updates: { mutation: { debounce: 10 } } });

    // A normal public path that emits a runtime warning now reaches the restored
    // diagnostics sink, never the abandoned replacement sink.
    runtime.patchOptions({
      updates: {
        mutation: {
          enabled: true,
          targets: () => {
            throw new Error('observer target resolver rejected');
          },
        },
      },
    });

    expect(previousOutput.warn).toHaveBeenCalledWith(
      'WARN_TRACKER_OBSERVER_RESOLVER_FAILED',
      expect.any(String),
      expect.any(Object),
    );
    expect(nextOutput.warn).not.toHaveBeenCalled();

    runtime.destroy();
  });

  it('rolls back interaction options after handler reconfiguration fails', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        interaction: { drag: true },
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [],
    });
    const updateError = new Error('interaction update failed');

    runtime.mount({ renderRoot });
    const interactionUpdate = vi.spyOn(runtime.instance.interactionController, 'update').mockImplementationOnce(() => {
      throw updateError;
    });

    expect(() => runtime.patchOptions({ interaction: { drag: false } })).toThrow(updateError);

    // The forward update failed and the rollback re-invokes the controller with
    // the previous options, so the committed interaction option is unchanged.
    expect(interactionUpdate).toHaveBeenCalledTimes(2);
    expect(interactionUpdate.mock.calls[1]?.[0]).toMatchObject({ interaction: { drag: true } });
    expect(runtime.instance.options.interaction?.drag).toBe(true);

    runtime.destroy();
  });

  it('rolls back a dedicated rule mutation when context synchronization fails', () => {
    const runtime = createTrackerStateIntegration({
      options: {
        diagnostics: { warnings: false },
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [{ selector: '.existing' }],
    });
    const contextError = new Error('rule context failure');
    const previousRules = runtime.getRules();
    const previousRuleCounters = runtime.getStats().rules;
    const updateContext = vi.spyOn(runtime.instance.renderer, 'updateContext').mockImplementationOnce(() => {
      throw contextError;
    });

    // `addRule` represents the shared dedicated-rule-mutation path: add, clear,
    // remove-by-index and remove-by-selector all converge on the same
    // snapshot -> mutate -> context-sync -> restore-on-failure branch.
    expect(() => runtime.addRule({ selector: '.added' }, { render: false })).toThrow(contextError);

    expect(runtime.getRules()).toEqual(previousRules);
    expect(runtime.getStats().rules).toEqual(previousRuleCounters);
    // The forward context synchronization threw and the rollback branch actually
    // re-attempts context synchronization a second time.
    expect(updateContext).toHaveBeenCalledTimes(2);

    runtime.destroy();
  });

  it('aggregates a rule synchronization error with a context rollback failure', () => {
    const runtime = createTrackerStateIntegration({
      options: {
        diagnostics: { warnings: false },
        updates: {
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [],
    });
    const updateError = new Error('rule context update failed');
    const rollbackError = new Error('rule context rollback failed');
    const previousRuleCounters = runtime.getStats().rules;

    vi.spyOn(runtime.instance.renderer, 'updateContext')
      .mockImplementationOnce(() => {
        throw updateError;
      })
      .mockImplementationOnce(() => {
        throw rollbackError;
      });

    let thrown: unknown;

    try {
      runtime.addRule({ selector: '.added' }, { render: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([updateError, rollbackError]);
    expect(runtime.getRules()).toEqual([]);
    expect(runtime.getStats().rules).toEqual(previousRuleCounters);

    runtime.destroy();
  });

  it('aggregates an options update error with a rollback failure', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {
        updates: {
          resize: { enabled: false, debounce: 10 },
          mutation: { enabled: false },
          scroll: { enabled: false },
          interval: { enabled: false },
        },
      },
      rules: [],
    });
    const updateError = new Error('observer update failed');
    const rollbackError = new Error('observer rollback failed');

    runtime.mount({ renderRoot });
    vi.spyOn(runtime.instance.observerController, 'update')
      .mockImplementationOnce(() => {
        throw updateError;
      })
      .mockImplementationOnce(() => {
        throw rollbackError;
      });

    let thrown: unknown;

    try {
      runtime.patchOptions({ updates: { resize: { debounce: 77 } } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([updateError, rollbackError]);
    expect(runtime.instance.options.updates?.resize?.debounce).toBe(10);

    runtime.destroy();
  });

  it('restores rules and counters when final mount context synchronization fails', () => {
    const renderRoot = createConnectedElement();
    const contextError = new Error('final mount context failure');
    let mountedContextUpdates = 0;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    instance = createTrackerIntegrationInstance(
      {
        options: {
          diagnostics: { warnings: false },
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [{ selector: '.mount-rule' }],
      },
      {
        getInstance: () => instance,
        renderer: {
          mount(context) {
            return context.target.kind === 'root' ? context.target.root : context.target.host;
          },
          updateContext(context) {
            if (context.document !== null) {
              mountedContextUpdates += 1;

              if (mountedContextUpdates === 3) {
                throw contextError;
              }
            }
          },
        },
      },
    );

    const previousRules = instance!.ruleStore.getPublicRules();
    const previousRuleCounters = instance!.diagnostics.getStats().rules;

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'root', root: renderRoot } })).toThrow(
      contextError,
    );
    expect(instance!.ruleStore.getPublicRules()).toEqual(previousRules);
    expect(instance!.diagnostics.getStats().rules).toEqual(previousRuleCounters);
    expect(instance!.lifecycleState).toBe('unmounted');
    expect(instance!.runtimeContext).toBeNull();

    destroyTrackerInstance(instance!);
  });

  it('never calls a custom renderer mount() when its first mount-time updateContext() throws', () => {
    const renderRoot = createConnectedElement();
    const contextError = new Error('first mount context failure');
    const mount = vi.fn((context: { target: { kind: 'host' | 'root'; root?: HTMLElement; host?: HTMLElement } }) =>
      context.target.kind === 'root' ? context.target.root! : context.target.host!,
    );
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    instance = createTrackerIntegrationInstance(
      {
        options: {
          diagnostics: { warnings: false },
          updates: {
            mutation: { enabled: false },
            resize: { enabled: false },
            scroll: { enabled: false },
            interval: { enabled: false },
          },
        },
        rules: [{ selector: '.mount-rule' }],
      },
      {
        getInstance: () => instance,
        renderer: {
          mount,
          updateContext(context) {
            if (context.document !== null) {
              throw contextError;
            }
          },
        },
      },
    );

    const previousRules = instance!.ruleStore.getPublicRules();
    const previousRuleCounters = instance!.diagnostics.getStats().rules;

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'root', root: renderRoot } })).toThrow(
      contextError,
    );

    // Core never attempts to invoke the renderer's own mount()/resource-creation
    // step once its first mount-time updateContext() has already failed: whatever
    // partial state that call left behind is the renderer's own responsibility.
    expect(mount).not.toHaveBeenCalled();
    expect(instance!.ruleStore.getPublicRules()).toEqual(previousRules);
    expect(instance!.diagnostics.getStats().rules).toEqual(previousRuleCounters);
    expect(instance!.lifecycleState).toBe('unmounted');
    expect(instance!.mounted).toBe(false);
    expect(instance!.runtimeContext).toBeNull();

    destroyTrackerInstance(instance!);
  });

  it('captures destroy-event diagnostics before the terminal snapshot while routing snapshot-listener failures to the host', () => {
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
    const sequence: string[] = [];
    const snapshotListenerError = new Error('terminal snapshot subscriber failed');
    const reportError = vi.fn();
    let destroyedSnapshotCalls = 0;

    vi.stubGlobal('reportError', reportError);
    runtime.mount({ renderRoot });
    runtime.on('destroy', () => {
      sequence.push('destroy');
      expect(runtime.getSnapshot().lifecycle.destroyed).toBe(true);
      throw new Error('destroy subscriber failed');
    });
    runtime.subscribe((snapshot) => {
      if (!snapshot.lifecycle.destroyed) {
        return;
      }

      destroyedSnapshotCalls += 1;
      sequence.push('snapshot:destroyed');
      throw snapshotListenerError;
    });

    expect(() => runtime.destroy()).not.toThrow();

    expect(sequence).toEqual(['destroy', 'snapshot:destroyed']);
    expect(destroyedSnapshotCalls).toBe(1);
    expect(runtime.getStats().errors.byCode['integration-event-handler-error']).toBe(1);
    expect(reportError).toHaveBeenCalledWith(snapshotListenerError);
    expect(runtime.getStats().errors.total).toBe(1);
    expect(runtime.getSnapshot().diagnostics.errors.total).toBe(1);
  });

  it('exposes committed window-mode mount state through snapshot and snapshot props', () => {
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

    runtime.mount({ renderRoot });

    expect(runtime.getSnapshot()).toMatchObject({
      mounted: true,
      scrollMode: 'window',
      geometryAvailable: true,
      lifecycle: { mounted: true, destroyed: false, hasRenderRoot: true },
    });
    expect(runtime.getSnapshotProps()).toMatchObject({
      mounted: true,
      scrollMode: 'window',
      geometryAvailable: true,
      root: { scrollMode: 'window', geometryAvailable: true },
      markersLayer: { hidden: false },
    });

    runtime.destroy();
  });
});

describe('no-op configuration updates do not publish snapshots', () => {
  it('does not publish a snapshot for a no-diff patchOptions call', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: { marker: { className: 'kept' } },
      rules: [],
    });

    runtime.mount({ renderRoot });
    const listener = vi.fn();

    runtime.subscribe(listener);
    runtime.patchOptions({ marker: { className: 'kept' } });

    expect(listener).not.toHaveBeenCalled();

    runtime.destroy();
  });

  it('does not publish a snapshot for an equivalent replaceRules call', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: {},
      rules: [{ selector: '.kept' }],
    });

    runtime.mount({ renderRoot });
    const listener = vi.fn();

    runtime.subscribe(listener);
    runtime.replaceRules([{ selector: '.kept' }]);

    expect(listener).not.toHaveBeenCalled();

    runtime.destroy();
  });

  it('still publishes a snapshot when patchOptions produces a genuine change', () => {
    const renderRoot = createConnectedElement();
    const runtime = createTrackerStateIntegration({
      options: { marker: { className: 'before' } },
      rules: [],
    });

    runtime.mount({ renderRoot });
    const listener = vi.fn();

    runtime.subscribe(listener);
    runtime.patchOptions({ marker: { className: 'after' } });

    expect(listener).toHaveBeenCalledTimes(1);

    runtime.destroy();
  });
});
