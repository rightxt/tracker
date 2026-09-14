// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTrackerIntegrationInstance } from '../integrationRegistry.js';
import { createTrackerProjectionIntegration } from '../projectionIntegration.js';

/** Removes connected test roots and restores spies after every runtime scenario. */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Creates connected source and framework-owned render roots. */
function createRoots(): { renderRoot: HTMLElement; sourceRoot: HTMLElement } {
  const sourceRoot = document.createElement('main');
  const target = document.createElement('div');
  const renderRoot = document.createElement('aside');

  target.className = 'projection-integration-target';
  sourceRoot.append(target);
  document.body.append(sourceRoot, renderRoot);

  return { renderRoot, sourceRoot };
}

describe('projection integration', () => {
  it('keeps Core authorities opaque while registering the Projection facade for privileged diagnostics', () => {
    const runtime = createTrackerProjectionIntegration();

    expect(runtime).not.toHaveProperty('instance');
    expect(runtime).not.toHaveProperty('renderer');
    expect(getTrackerIntegrationInstance(runtime)).not.toBeNull();
    expect(runtime.getState()).toBe('unmounted');
    expect(runtime.getProjection()).toMatchObject({ generation: 0, revision: 0 });

    runtime.destroy();
  });

  it('defaults an omitted configuration but does not mask null', () => {
    const omitted = createTrackerProjectionIntegration();

    expect(omitted.getState()).toBe('unmounted');
    omitted.destroy();

    // @ts-expect-error - an explicit whole-configuration null is rejected, not defaulted like an omitted argument.
    expect(() => createTrackerProjectionIntegration(null)).toThrow(TypeError);
  });

  it('publishes the coherent Projection commit before matching sync:start and sync:end observers', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration({
      options: {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.projection-integration-target' }],
    });
    const publications: string[] = [];

    runtime.on('sync:start', () => publications.push('sync:start'));
    runtime.on('sync:end', () => publications.push('sync:end'));
    runtime.subscribeProjection(() => publications.push('projection'));

    runtime.mount({ renderRoot, sourceRoot });

    expect(publications).toEqual(['projection', 'sync:start', 'sync:end']);
    expect(runtime.getProjection().items).toHaveLength(1);
    expect(runtime.getState()).toBe('mounted');

    runtime.destroy();
  });

  it('orders a queued Projection adapter transaction before later Core work in the shared FIFO', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration({
      options: {
        clustering: { enabled: false },
        placement: 'right',
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.projection-integration-target' }],
    });
    const sequence: string[] = [];
    let handled = false;

    runtime.mount({ renderRoot, sourceRoot });
    runtime.on('sync:end', () => {
      if (handled) {
        return;
      }

      handled = true;
      sequence.push('listener:start');
      // Observe only the work that is queued behind this listener: the adapter
      // transaction and the render it defers must both settle before the next
      // coherent Projection commit publishes.
      runtime.subscribeProjection(() => sequence.push('projection'));
      runtime.coordinateAdapterTransaction({
        name: 'test adapter transaction',
        run: () => {
          sequence.push('transaction:start');
          runtime.replaceConfiguration(
            {
              options: {
                clustering: { enabled: false },
                placement: 'left',
                updates: {
                  interval: { enabled: false },
                  mutation: { enabled: false },
                  resize: { enabled: false },
                  scroll: { enabled: false },
                },
              },
              rules: [{ selector: '.projection-integration-target' }],
            },
            { render: false },
          );
          sequence.push('transaction:end');
        },
        settle: () => sequence.push('transaction:settle'),
      });
      runtime.render();
      sequence.push('listener:end');
    });

    runtime.render();

    expect(sequence).toEqual([
      'listener:start',
      'listener:end',
      'transaction:start',
      'transaction:end',
      'transaction:settle',
      'projection',
    ]);
    expect(runtime.getProjection().chrome.root.attributes['data-rxtt-placement']).toBe('left');
    runtime.destroy();
  });

  it('exposes Snapshot observation for the same Core generation as Projection commits', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration({
      options: {
        clustering: { enabled: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ selector: '.projection-integration-target' }],
    });
    const snapshots: Array<ReturnType<typeof runtime.getSnapshot>> = [];
    const unsubscribe = runtime.subscribeSnapshot((snapshot) => snapshots.push(snapshot));

    expect(runtime.getSnapshot()).toMatchObject({ mounted: false });

    runtime.mount({ renderRoot, sourceRoot });

    expect(runtime.getSnapshot()).toMatchObject({ mounted: true });
    expect(runtime.getSnapshot().items).toHaveLength(1);
    expect(snapshots.at(-1)).toBe(runtime.getSnapshot());
    expect(snapshots.at(-1)?.items[0]?.key).toBe(runtime.getProjection().items[0]?.key);

    unsubscribe();
    runtime.destroy();
  });

  it('publishes one terminal Projection generation and makes post-destroy subscriptions inert', async () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration();
    const generations: number[] = [];

    runtime.subscribeProjection((commit) => generations.push(commit.state.generation));
    runtime.mount({ renderRoot, sourceRoot });

    expect(generations).toEqual([1]);

    const destroyed = runtime.whenDestroyed();

    runtime.destroy();

    await expect(destroyed).resolves.toBeUndefined();
    expect(generations).toEqual([1, 2]);
    expect(runtime.getState()).toBe('destroyed');
    expect(runtime.getProjection().mount.mounted).toBe(false);
    expect(runtime.getSnapshot().lifecycle.destroyed).toBe(true);

    let lateProjectionCalls = 0;
    const unsubscribeProjection = runtime.subscribeProjection(() => {
      lateProjectionCalls += 1;
    });

    expect(() => {
      unsubscribeProjection();
      unsubscribeProjection();
    }).not.toThrow();
    expect(lateProjectionCalls).toBe(0);

    const lateSnapshotListener = vi.fn();
    const unsubscribeSnapshot = runtime.subscribeSnapshot(lateSnapshotListener);

    expect(() => {
      unsubscribeSnapshot();
      unsubscribeSnapshot();
    }).not.toThrow();
    expect(lateSnapshotListener).not.toHaveBeenCalled();
  });

  it('resolves a whenDestroyed() promise captured before destroy() even when the renderer destroy hook fails', async () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration();

    runtime.mount({ renderRoot, sourceRoot });

    const destroyed = runtime.whenDestroyed();
    const instance = getTrackerIntegrationInstance(runtime)!;

    vi.spyOn(instance.renderer, 'destroy').mockImplementationOnce(() => {
      throw new Error('Expected destroy failure.');
    });

    expect(() => runtime.destroy()).toThrow('Expected destroy failure.');

    await expect(destroyed).resolves.toBeUndefined();
    await expect(runtime.whenDestroyed()).resolves.toBeUndefined();
    expect(runtime.getState()).toBe('destroyed');
    expect(runtime.isDestroyed()).toBe(true);
  });

  it('deduplicates repeated listener owners without letting stale unsubscribe handles retire a later registration', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration();
    const listener = vi.fn();

    runtime.mount({ renderRoot, sourceRoot });

    const unsubscribeA = runtime.subscribeProjection(listener);
    const unsubscribeB = runtime.subscribeProjection(listener);

    runtime.replaceConfiguration({ options: { placement: 'right' }, rules: [] });
    runtime.flushRender();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribeA();
    unsubscribeA();

    runtime.replaceConfiguration({ options: { placement: 'left' }, rules: [] });
    runtime.flushRender();

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribeB();

    const unsubscribeC = runtime.subscribeProjection(listener);

    unsubscribeA();
    unsubscribeB();

    runtime.replaceConfiguration({ options: { placement: 'right' }, rules: [] });
    runtime.flushRender();

    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribeC();
    runtime.destroy();
  });

  it('uses first-live-registration order and a start-of-publication listener snapshot', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration();
    const publications: string[] = [];
    const lateListener = (): void => {
      publications.push('late');
    };
    const secondListener = (): void => {
      publications.push('second');
    };
    let unsubscribeSecond = (): void => {};
    let lateSubscribed = false;

    runtime.mount({ renderRoot, sourceRoot });
    runtime.subscribeProjection(() => {
      publications.push('first');
      unsubscribeSecond();

      if (!lateSubscribed) {
        lateSubscribed = true;
        runtime.subscribeProjection(lateListener);
      }
    });
    unsubscribeSecond = runtime.subscribeProjection(secondListener);

    runtime.replaceConfiguration({ options: { placement: 'right' }, rules: [] });
    runtime.flushRender();

    expect(publications).toEqual(['first', 'second']);

    publications.length = 0;
    runtime.replaceConfiguration({ options: { placement: 'left' }, rules: [] });
    runtime.flushRender();

    expect(publications).toEqual(['first', 'late']);

    runtime.destroy();
  });

  it('flushes a pending narrow render target without widening it to a full render', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration();
    const changedDomains: string[][] = [];

    runtime.mount({ renderRoot, sourceRoot });
    runtime.subscribeProjection((commit) => changedDomains.push([...commit.changed]));
    runtime.replaceConfiguration({ options: { placement: 'right' }, rules: [] });

    expect(changedDomains).toEqual([]);

    runtime.flushRender();

    expect(changedDomains).toEqual([['chrome', 'viewport']]);
    expect(runtime.getProjection().chrome.root.attributes['data-rxtt-placement']).toBe('right');

    runtime.destroy();
  });

  it('publishes configuration-driven marker presentation atomically in the items domain', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration({
      options: {
        clustering: { enabled: false },
        marker: { className: 'marker-before', title: true },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ label: 'Projected title', selector: '.projection-integration-target' }],
    });
    const changedDomains: string[][] = [];

    runtime.mount({ renderRoot, sourceRoot });
    const previous = runtime.getProjection();

    runtime.subscribeProjection((commit) => changedDomains.push([...commit.changed]));
    runtime.replaceConfiguration({
      options: {
        clustering: { enabled: false },
        marker: { className: 'marker-after', title: false },
        updates: {
          interval: { enabled: false },
          mutation: { enabled: false },
          resize: { enabled: false },
          scroll: { enabled: false },
        },
      },
      rules: [{ label: 'Projected title', selector: '.projection-integration-target' }],
    });
    runtime.flushRender();

    const next = runtime.getProjection();

    expect(changedDomains).toEqual([['items']]);
    expect(next.items).not.toBe(previous.items);
    expect(next.items[0]?.className).toContain('marker-after');
    expect(next.items[0]?.attributes).not.toHaveProperty('title');
    expect(next.chrome).toBe(previous.chrome);
    expect(next.mount).toBe(previous.mount);
    expect(next.selection).toBe(previous.selection);
    expect(next.viewport).toBe(previous.viewport);

    runtime.destroy();
  });

  it('does not bypass render-false batching', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration();
    const changedDomains: string[][] = [];

    runtime.mount({ renderRoot, sourceRoot });
    runtime.subscribeProjection((commit) => changedDomains.push([...commit.changed]));
    const mountedRevision = runtime.getProjection().revision;

    runtime.replaceConfiguration({ options: { placement: 'right' }, rules: [] }, { render: false });
    runtime.flushRender();

    expect(runtime.getProjection().revision).toBe(mountedRevision);
    expect(runtime.getProjection().chrome.root.attributes['data-rxtt-placement']).not.toBe('right');
    expect(changedDomains).toEqual([]);

    runtime.render();

    expect(runtime.getProjection().chrome.root.attributes['data-rxtt-placement']).toBe('right');
    expect(changedDomains).toEqual([['chrome', 'items', 'viewport']]);

    runtime.destroy();
  });

  it('contains a synchronous Projection listener failure and full-resynchronizes the next successful commit', () => {
    const { renderRoot, sourceRoot } = createRoots();
    const runtime = createTrackerProjectionIntegration();
    const successfulCommits: string[][] = [];
    const unsubscribeFailingListener = runtime.subscribeProjection(() => {
      throw new Error('Expected projection sink failure.');
    });

    runtime.mount({ renderRoot, sourceRoot });

    expect(runtime.getStats().errors.total).toBe(1);
    expect(runtime.getStats().errors.last?.code).toBe('projection-listener-error');

    unsubscribeFailingListener();
    runtime.subscribeProjection((commit) => successfulCommits.push([...commit.changed]));
    runtime.replaceConfiguration({ options: { placement: 'right' }, rules: [] });
    runtime.flushRender();

    expect(successfulCommits).toEqual([['chrome', 'items', 'mount', 'selection', 'viewport']]);
    expect(runtime.getProjection().chrome.root.attributes['data-rxtt-placement']).toBe('right');

    runtime.destroy();
  });

  it('refreshes retained diagnostic views once a delayed projection listener rejection settles while the runtime stays alive', async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const { renderRoot, sourceRoot } = createRoots();
      const diagnosticError = vi.fn();
      const runtime = createTrackerProjectionIntegration({
        options: { diagnostics: { output: { error: diagnosticError } } },
      });
      let rejectPendingListener: ((reason: unknown) => void) | null = null;
      const unsubscribeFailingListener = runtime.subscribeProjection(
        () =>
          new Promise((_resolve, reject) => {
            rejectPendingListener = reject;
          }),
      );

      runtime.mount({ renderRoot, sourceRoot });

      // The commit that triggered the listener is already published; the
      // rejection has not settled yet, so retained diagnostics are untouched.
      expect(rejectPendingListener).not.toBeNull();
      expect(runtime.getStats().errors.total).toBe(0);
      expect(runtime.getSnapshot().diagnostics.errors.total).toBe(0);

      rejectPendingListener!(new Error('Expected delayed projection listener failure.'));

      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(unhandledRejections).toHaveLength(0);
      expect(runtime.getStats().errors.last?.code).toBe('projection-listener-error');
      expect(runtime.getSnapshot().diagnostics.errors.last?.code).toBe('projection-listener-error');
      expect(runtime.getState()).toBe('mounted');
      expect(diagnosticError).toHaveBeenCalledTimes(1);
      expect(diagnosticError).toHaveBeenCalledWith(
        'projection-listener-error',
        'Tracker projection listener failed.',
        expect.objectContaining({ error: 'Expected delayed projection listener failure.' }),
      );

      unsubscribeFailingListener();
      const successfulCommits: string[][] = [];

      runtime.subscribeProjection((commit) => successfulCommits.push([...commit.changed]));
      runtime.replaceConfiguration({ options: { placement: 'right' }, rules: [] });
      runtime.flushRender();

      // Full resynchronization triggered by the earlier failure is preserved.
      expect(successfulCommits).toEqual([['chrome', 'items', 'mount', 'selection', 'viewport']]);

      runtime.destroy();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('recaptures terminal diagnostic views when the terminal Projection listener Promise rejects after destroy', async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const { renderRoot, sourceRoot } = createRoots();
      const runtime = createTrackerProjectionIntegration();
      const rejectors: Array<(reason: unknown) => void> = [];

      runtime.subscribeProjection(
        () =>
          new Promise((_resolve, reject) => {
            rejectors.push(reject);
          }),
      );

      runtime.mount({ renderRoot, sourceRoot });

      expect(rejectors).toHaveLength(1);

      const destroyed = runtime.whenDestroyed();

      runtime.destroy();

      expect(runtime.getState()).toBe('destroyed');
      expect(runtime.getStats().errors.total).toBe(0);
      expect(rejectors).toHaveLength(2);

      const generationAfterDestroy = runtime.getProjection().generation;

      rejectors[rejectors.length - 1]!(new Error('Expected delayed projection listener failure after destroy.'));

      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(unhandledRejections).toHaveLength(0);
      expect(runtime.getStats().errors.last?.code).toBe('projection-listener-error');
      expect(runtime.getSnapshot().diagnostics.errors.last?.code).toBe('projection-listener-error');
      expect(runtime.getState()).toBe('destroyed');
      expect(runtime.getProjection().generation).toBe(generationAfterDestroy);
      await expect(destroyed).resolves.toBeUndefined();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
