import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { Tracker } from '@rightxt/tracker-react';

import {
  assertSelectionOnlyEffect,
  assertStructuralUpdateEffect,
  buildAdapterBenchmarkDom,
  countRenderedItems,
  createAdapterBenchmarkOptions,
  createAdapterBenchmarkRules,
  createMutationCounter,
  dispatchSelectionNavigation,
  populateProbeElements,
  readRenderedItemKeys,
  readSelectedItemKey,
  replaceSourceElements,
  waitTwoAnimationFrames,
} from './shared.js';

import type { Root } from 'react-dom/client';
import type { TrackerHandle } from '@rightxt/tracker-react';
import type { TrackerOptions, TrackerRule } from '@rightxt/tracker-core';
import type { AdapterBenchmarkDom, AdapterBenchmarkVariant, AdapterSettleResult, AdapterWorkKind } from './shared.js';

declare global {
  interface Window {
    __rxtAdapterBenchmark?: Record<string, AdapterBenchmarkVariant>;
  }
}

/**
 * React-specific settle evidence: `root.render()` call count during the triggered work, or
 * `null` outside the instrumented pass, where the counter is not maintained at all.
 */
interface ReactAdapterSettleResult extends AdapterSettleResult {
  readonly reactRootRenderCallCount: number | null;
}

/**
 * Creates one React adapter-benchmark variant.
 *
 * `forced` wraps every React-driven update (mount, and the `marker-presentation`
 * work kind) in `flushSync`, matching the React playground's deliberate
 * synchronous-commit boundary. `unforced` lets React commit on its own schedule,
 * settling on two animation frames instead. `viewport-only` and `selection-only`
 * never go through a React commit at all (they mutate the DOM directly and let
 * Core's own scroll observer / interaction controller react), so the two variants
 * only actually differ for `marker-presentation`.
 *
 * A fresh DOM scaffold and React root are built on every `mount()` call, since one
 * variant instance is mounted, exercised, and destroyed once per workload size:
 * a `createRoot` root cannot be reused after `unmount()` (React 19 throws "Cannot
 * update an unmounted root"), and reusing the DOM scaffold across cycles would mount
 * into a node `destroy()` already detached from the document.
 *
 * @param variantId - Unique id used to namespace this variant's DOM scaffold.
 * @param forced - Whether React commits are forced synchronous via `flushSync`.
 * @returns Benchmark variant.
 */
function createReactVariant(variantId: string, forced: boolean): AdapterBenchmarkVariant {
  let dom: AdapterBenchmarkDom | null = null;
  let root: Root | null = null;
  let trackerHandle: TrackerHandle | null = null;
  let currentSize = 0;
  let options: Partial<TrackerOptions> = createAdapterBenchmarkOptions();
  const rules: TrackerRule[] = createAdapterBenchmarkRules();
  let pendingSyncEndResolve: (() => void) | null = null;
  let lastWorkKind: AdapterWorkKind | null = null;
  let preparedKind: AdapterWorkKind | null = null;
  let pendingTrigger: (() => void) | null = null;
  let settleTask: (() => Promise<void>) | null = null;
  let assertWork: (() => void) | null = null;
  let mutationCounter: ReturnType<typeof createMutationCounter> | null = null;
  let instrumented = false;
  let rendersCompletedBefore: number | null = null;
  let renderCount = 0;
  // Core's default `marker.title` is `true` (defaultOptions.ts); starting the
  // toggle at `true` makes the first flip land on `false`, which always
  // differs from the applied value, so diffOptions always sees a real change.
  let markerTitleToggle = true;

  /**
   * Renders Tracker with current props through a wrapper whose execution React
   * re-runs per commit.
   *
   * Never wraps itself in `flushSync` — nesting `flushSync` inside another
   * active `flushSync` call throws in React 19. Callers that need a
   * synchronous commit (mount, and the `forced` variant's marker-presentation
   * update) wrap this function in `flushSync` themselves instead.
   */
  function commitTree(): void {
    const activeDom = dom;

    if (activeDom === null || root === null) {
      throw new Error('commitTree() called before mount().');
    }

    const tree = createElement(Tracker, {
      ref: (handle: TrackerHandle | null) => {
        trackerHandle = handle;
      },
      options,
      rules,
      scrollRoot: activeDom.scrollRoot,
      sourceRoot: activeDom.sourceRoot,
      onSyncEnd: () => {
        pendingSyncEndResolve?.();
        pendingSyncEndResolve = null;
      },
    });

    if (instrumented) {
      renderCount += 1;
    }

    root.render(tree);
  }

  /** Creates a promise resolved by the next `onSyncEnd` firing. */
  function armSyncEndWait(): Promise<void> {
    return new Promise((resolve) => {
      pendingSyncEndResolve = resolve;
    });
  }

  return {
    prepare(size) {
      dom = buildAdapterBenchmarkDom(variantId);
      populateProbeElements(dom.sourceRoot, size);
      currentSize = size;
    },

    mount() {
      if (dom === null) {
        throw new Error('mount() called before prepare().');
      }

      root = createRoot(dom.appHost);
      renderCount = 0;
      flushSync(commitTree);
    },

    setInstrumented(nextInstrumented) {
      instrumented = nextInstrumented;
    },

    prepareWork(kind) {
      const activeDom = dom;

      if (activeDom === null) {
        throw new Error('prepareWork() called before mount().');
      }

      const activeAppHost = activeDom.appHost;

      lastWorkKind = kind;
      preparedKind = kind;
      assertWork = null;
      renderCount = 0;
      rendersCompletedBefore = trackerHandle?.getStats()?.renders.completed ?? null;
      mutationCounter?.disconnect();
      mutationCounter = instrumented ? createMutationCounter(activeAppHost) : null;

      if (kind === 'marker-presentation') {
        markerTitleToggle = !markerTitleToggle;

        const nextOptions = { ...options, marker: { ...options.marker, title: markerTitleToggle } };
        const syncEndPromise = armSyncEndWait();

        pendingTrigger = () => {
          options = nextOptions;

          if (forced) {
            flushSync(commitTree);
          } else {
            commitTree();
          }
        };
        settleTask = async () => {
          await syncEndPromise;
          if (!forced) {
            await waitTwoAnimationFrames();
          }
        };
        return;
      }

      if (kind === 'viewport-only') {
        const nextScrollTop = activeDom.scrollRoot.scrollTop === 0 ? 200 : 0;
        const syncEndPromise = armSyncEndWait();

        pendingTrigger = () => {
          activeDom.scrollRoot.scrollTop = nextScrollTop;
        };
        settleTask = async () => {
          await syncEndPromise;
        };
        return;
      }

      if (kind === 'structural-update') {
        const activeTrackerHandle = trackerHandle;
        const keysBefore = readRenderedItemKeys(activeAppHost);
        const changedCount = replaceSourceElements(activeDom.sourceRoot, currentSize);
        const syncEndPromise = armSyncEndWait();

        pendingTrigger = () => {
          activeTrackerHandle?.refresh();
        };
        settleTask = async () => {
          await syncEndPromise;
        };
        assertWork = () => {
          assertStructuralUpdateEffect(activeAppHost, keysBefore, currentSize, changedCount);
        };
        return;
      }

      pendingSyncEndResolve = null;

      const selectedKeyBefore = readSelectedItemKey(activeAppHost);

      pendingTrigger = () => {
        dispatchSelectionNavigation(activeAppHost);
      };
      settleTask = async () => {
        // The per-item `useSyncExternalStore` subscription driving selection is notified from
        // Core's own native `keydown` listener, which sits outside React's synthetic-event
        // batching. React 18+ still schedules the resulting re-render asynchronously (one
        // microtask suffices empirically), so the DOM has not necessarily updated yet by the
        // time the trigger returns - wait a microtask before reading the settled state.
        await Promise.resolve();
      };
      assertWork = () => {
        assertSelectionOnlyEffect(activeAppHost, selectedKeyBefore);
      };
    },

    triggerWork(kind) {
      const trigger = pendingTrigger;

      if (preparedKind !== kind || trigger === null) {
        throw new Error(`triggerWork("${kind}") ran without a matching prepareWork() call.`);
      }

      pendingTrigger = null;
      trigger();
    },

    async waitSettled(): Promise<void> {
      const task = settleTask;

      settleTask = null;

      if (task !== null) {
        await task();
      }
    },

    readSettleResult(): ReactAdapterSettleResult {
      const activeDom = dom;

      if (activeDom === null) {
        throw new Error('readSettleResult() called before mount().');
      }

      const mutationCount = mutationCounter?.read() ?? null;

      mutationCounter?.disconnect();
      mutationCounter = null;

      assertWork?.();
      assertWork = null;

      const stats = trackerHandle?.getStats() ?? null;
      const rendersCompletedAfter = stats?.renders.completed ?? null;

      return {
        coreDurationMs: lastWorkKind === 'selection-only' ? null : (stats?.lastRender?.duration ?? null),
        mutationCount,
        reactRootRenderCallCount: instrumented ? renderCount : null,
        renderedItemCount: countRenderedItems(activeDom.appHost),
        rendersCompletedDelta:
          rendersCompletedBefore === null || rendersCompletedAfter === null
            ? null
            : rendersCompletedAfter - rendersCompletedBefore,
      };
    },

    getStats() {
      return trackerHandle?.getStats() ?? null;
    },

    destroy() {
      mutationCounter?.disconnect();
      mutationCounter = null;
      root?.unmount();
      root = null;
    },

    cleanup() {
      dom?.teardown();
      dom = null;
    },
  };
}

window.__rxtAdapterBenchmark = {
  forced: createReactVariant('react-forced', true),
  unforced: createReactVariant('react-unforced', false),
};

export {};
