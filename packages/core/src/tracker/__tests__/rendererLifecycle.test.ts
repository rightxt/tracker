// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInternalDomRegistry } from '../../dom/internalDomRegistry.js';
import { EVENT_NAMES } from '../../events/eventNames.js';
import {
  createTrackerIntegrationInstance,
  createTrackerIntegrationInstance as createDiagnosticTrackerIntegrationInstance,
  createTrackerStateIntegration,
  destroyTrackerInstance,
  getTrackerInstanceSnapshot,
  getTrackerInstanceStats,
  mountTrackerInstance,
  subscribeTrackerInstanceSnapshot,
  unmountTrackerInstance,
} from '../../__tests__/testIntegration.js';

/** Removes test-owned DOM after every renderer root lifecycle scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('renderer diagnostics, root ownership, and lifecycle cleanup', () => {
  it('refreshes live snapshot diagnostics after a renderer thenable rejects', async () => {
    const renderRoot = document.createElement('div');
    const diagnosticWarn = vi.fn();
    const renderError = new Error('late render failure');
    let rejectRender!: (reason?: unknown) => void;
    let instance: ReturnType<typeof createDiagnosticTrackerIntegrationInstance> | null = null;

    document.body.appendChild(renderRoot);
    instance = createDiagnosticTrackerIntegrationInstance(
      {
        options: {
          diagnostics: { output: { warn: diagnosticWarn } },
          updates: { interval: { enabled: false } },
        },
        rules: [],
      },
      {
        getInstance: () => instance,
        renderer: {
          destroy() {},
          mount: () => renderRoot,
          renderTrack: () =>
            new Promise<void>((_resolve, reject) => {
              rejectRender = reject;
            }),
        },
      },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root: renderRoot } });
    rejectRender(renderError);
    await Promise.resolve();

    expect(diagnosticWarn).toHaveBeenCalledWith(
      'renderer-hook-returned-thenable',
      expect.stringContaining('renderTrack'),
      { error: renderError.message },
    );
    expect(getTrackerInstanceStats(instance).warnings.byCode['renderer-hook-returned-thenable']).toBe(1);
    expect(getTrackerInstanceSnapshot(instance).diagnostics.warnings.byCode['renderer-hook-returned-thenable']).toBe(1);
    expect(instance.lifecycleState).toBe('mounted');

    destroyTrackerInstance(instance);
  });

  it('refreshes retained terminal diagnostics after a live renderer thenable rejects late', async () => {
    const renderRoot = document.createElement('div');
    let rejectRender!: (reason?: unknown) => void;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(renderRoot);
    instance = createTrackerIntegrationInstance(
      { options: { updates: { interval: { enabled: false } } }, rules: [] },
      {
        getInstance: () => instance,
        renderer: {
          destroy() {},
          mount: () => renderRoot,
          renderTrack: () =>
            new Promise<void>((_resolve, reject) => {
              rejectRender = reject;
            }),
        },
      },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root: renderRoot } });
    destroyTrackerInstance(instance);
    rejectRender(new Error('late post-destroy render failure'));
    await Promise.resolve();

    expect(getTrackerInstanceStats(instance).warnings.byCode['renderer-hook-returned-thenable']).toBe(1);
    expect(getTrackerInstanceSnapshot(instance).diagnostics.warnings.byCode['renderer-hook-returned-thenable']).toBe(1);
    expect(instance.lifecycleState).toBe('destroyed');
  });

  it('separates source and actual framework roots without excluding source content', () => {
    const sourceRoot = document.createElement('section');
    const source = document.createElement('div');
    const renderRoot = document.createElement('div');
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');

    source.className = 'renderer-source';
    renderRoot.className = 'rxtt';
    sourceRoot.appendChild(source);
    document.body.append(sourceRoot, renderRoot);

    const runtime = createTrackerStateIntegration({
      options: { clustering: { enabled: false } },
      rules: [{ selector: '.renderer-source' }],
    });

    runtime.mount({ renderRoot, sourceRoot });

    const registry = getInternalDomRegistry(document);

    expect(runtime.getRoot()).toBe(renderRoot);
    expect(runtime.getSnapshot().items).toHaveLength(1);
    expect(registry.isNodeExcluded(renderRoot)).toBe(true);
    expect(registry.isNodeExcluded(source)).toBe(false);
    expect(observe).toHaveBeenCalledWith(sourceRoot, expect.any(Object));

    runtime.unmount();

    expect(renderRoot.isConnected).toBe(true);
    expect(registry.isNodeExcluded(renderRoot)).toBe(false);
    expect(registry.activeCount).toBe(0);

    runtime.destroy();
  });

  it('permits a remount after using destroy() as the per-cycle cleanup fallback for a renderer without unmount()', () => {
    const host = document.createElement('div');
    const destroy = vi.fn();
    let root: HTMLElement | null = null;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(host);
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
          destroy,
          get root() {
            return root;
          },
          mount(context) {
            const target = context.target.kind === 'host' ? context.target.host : context.target.root;

            root = context.document.createElement('div');
            target.appendChild(root);

            return root;
          },
        },
      },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'host', host } });
    unmountTrackerInstance(instance);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(instance.mounted).toBe(false);

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'host', host } })).not.toThrow();
    expect(instance.mounted).toBe(true);

    unmountTrackerInstance(instance);

    expect(destroy).toHaveBeenCalledTimes(2);

    destroyTrackerInstance(instance);

    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('retries one quarantined renderer-owned root during final destroy', () => {
    const host = document.createElement('div');
    const removalError = new Error('initial fallback removal failed');
    const remove = vi.fn<() => void>();
    let root: HTMLElement | null = null;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(host);
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
          destroy() {},
          get root() {
            return root;
          },
          mount(context) {
            const target = context.target.kind === 'host' ? context.target.host : context.target.root;

            root = context.document.createElement('div');
            target.appendChild(root);

            const nativeRemove = root.remove.bind(root);

            remove.mockImplementation(() => {
              if (remove.mock.calls.length === 1) {
                throw removalError;
              }

              nativeRemove();
            });
            root.remove = remove;

            return root;
          },
        },
      },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'host', host } });

    expect(() => unmountTrackerInstance(instance!)).toThrow(AggregateError);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(getInternalDomRegistry(document).getRegistrationState(root!)).toBe('quarantined');
    expect(() => destroyTrackerInstance(instance!)).not.toThrow();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(root!.isConnected).toBe(false);
    expect(getInternalDomRegistry(document).activeCount).toBe(0);
  });

  it('publishes terminal destroy state even when renderer mount-cycle cleanup fails', () => {
    const renderRoot = document.createElement('div');
    const cleanupError = new Error('renderer mount-cycle cleanup failed');
    const sourceUnmount = vi.fn(() => {
      throw cleanupError;
    });
    const sourceDestroy = vi.fn();
    const order: string[] = [];
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(renderRoot);
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
          destroy: sourceDestroy,
          mount: () => renderRoot,
          unmount: sourceUnmount,
        },
      },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root: renderRoot } });

    const observerDestroy = vi.spyOn(instance.observerController, 'destroy');
    const interactionDestroy = vi.spyOn(instance.interactionController, 'destroy');
    const schedulerDestroy = vi.spyOn(instance.scheduler, 'destroy');
    const terminalSnapshot = vi.fn((_snapshot: ReturnType<typeof getTrackerInstanceSnapshot>) => {
      order.push('terminal-snapshot');
    });

    instance.events.on(EVENT_NAMES.DESTROY, () => {
      order.push('destroy-event');
    });
    subscribeTrackerInstanceSnapshot(instance, terminalSnapshot);

    // The per-cycle renderer cleanup (source unmount) throws while the instance
    // is still mounted; terminal teardown/publication must fully complete before
    // that failure is rethrown.
    expect(() => destroyTrackerInstance(instance!)).toThrow(cleanupError);

    expect(sourceUnmount).toHaveBeenCalledTimes(1);
    expect(sourceDestroy).toHaveBeenCalledTimes(1);
    expect(observerDestroy).toHaveBeenCalledOnce();
    expect(interactionDestroy).toHaveBeenCalledOnce();
    expect(schedulerDestroy).toHaveBeenCalledOnce();
    expect(instance.destroyed).toBe(true);
    expect(instance.lifecycleState).toBe('destroyed');
    expect(order).toEqual(['destroy-event', 'terminal-snapshot']);
    expect(terminalSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({ lifecycle: { destroyed: true } });
    expect(getTrackerInstanceStats(instance).warnings).toBeDefined();
    expect(getTrackerInstanceSnapshot(instance).lifecycle).toMatchObject({ destroyed: true });
    expect(() => destroyTrackerInstance(instance!)).not.toThrow();
  });

  it('clears a stale quarantine and allows a fresh mount once the root was disconnected externally', () => {
    const host = document.createElement('div');
    const removalError = new Error('fallback removal failed');
    const destroy = vi.fn();
    let mountCount = 0;
    let root: HTMLElement | null = null;
    let instance: ReturnType<typeof createTrackerIntegrationInstance> | null = null;

    document.body.appendChild(host);
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
          destroy,
          get root() {
            return root;
          },
          mount(context) {
            const target = context.target.kind === 'host' ? context.target.host : context.target.root;

            mountCount += 1;
            root = context.document.createElement('div');
            target.appendChild(root);

            // Only the first cycle's root ever fails to detach; the remount's
            // root behaves normally so the test's final cleanup does not
            // leave a second, unrelated root permanently quarantined.
            if (mountCount === 1) {
              root.remove = vi.fn(() => {
                throw removalError;
              });
            }

            return root;
          },
        },
      },
    );

    mountTrackerInstance(instance, { rendererTarget: { kind: 'host', host } });

    expect(() => unmountTrackerInstance(instance!)).toThrow(AggregateError);
    expect(instance.mounted).toBe(false);
    expect(getInternalDomRegistry(document).getRegistrationState(root!)).toBe('quarantined');

    // Disconnect the quarantined root through the host directly, bypassing the
    // renderer's own (failing) remove() — this is what makes the quarantine
    // entry stale by the time the next mount attempt validates it.
    host.removeChild(root!);

    expect(() => mountTrackerInstance(instance!, { rendererTarget: { kind: 'host', host } })).not.toThrow();
    expect(instance.mounted).toBe(true);
    expect(getInternalDomRegistry(document).getRegistrationState(root!)).toBe('active');

    destroyTrackerInstance(instance);
  });
});
