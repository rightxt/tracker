import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';

import { Tracker } from '@rightxt/tracker-vue';

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
} from './shared.js';

import type { App } from 'vue';
import type { TrackerHandle } from '@rightxt/tracker-vue';
import type { TrackerOptions, TrackerRule } from '@rightxt/tracker-core';
import type { AdapterBenchmarkDom, AdapterBenchmarkVariant, AdapterSettleResult, AdapterWorkKind } from './shared.js';

declare global {
  interface Window {
    __rxtAdapterBenchmark?: Record<string, AdapterBenchmarkVariant>;
  }
}

/**
 * Vue-specific settle evidence: the render function's execution count during the triggered
 * work, or `null` outside the instrumented pass, where the counter is not maintained at all.
 */
interface VueAdapterSettleResult extends AdapterSettleResult {
  readonly vueRenderFunctionCallCount: number | null;
}

/**
 * Flushes Vue's reactive-update scheduler and pending Core microtasks, mirroring the
 * `flush()` helper already proven in `packages/vue/src/__tests__/Tracker.test.ts`.
 *
 * @returns Promise resolved once Vue and Core have both settled.
 */
async function flush(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

/**
 * Creates the single Vue adapter-benchmark variant. Vue has no `forced`/`unforced` split
 * (unlike React's `flushSync`, Vue's scheduler exposes no synchronous-commit escape hatch),
 * so every reactive prop update settles through `flush()` / `sync:end`, whichever applies
 * to the triggered work kind.
 *
 * A fresh DOM scaffold and Vue app are built on every `prepare()`/`mount()` pair, since one
 * variant instance is mounted, exercised, and destroyed once per workload size: reusing the
 * DOM scaffold across cycles would mount the next `app` into a node the prior `cleanup()`
 * already detached from the document.
 *
 * @param variantId - Unique id used to namespace this variant's DOM scaffold.
 * @returns Benchmark variant.
 */
function createVueVariant(variantId: string): AdapterBenchmarkVariant {
  let dom: AdapterBenchmarkDom | null = null;
  const options = shallowRef<Partial<TrackerOptions>>(createAdapterBenchmarkOptions());
  const rules = shallowRef<readonly TrackerRule[]>(createAdapterBenchmarkRules());
  const trackerHandle = shallowRef<TrackerHandle | null>(null);
  let app: App | null = null;
  let currentSize = 0;
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
  let pendingSyncEndResolve: (() => void) | null = null;

  const BenchmarkHost = defineComponent({
    name: 'AdapterBenchmarkHost',
    setup: () => () => {
      if (dom === null) {
        throw new Error('AdapterBenchmarkHost rendered before mount().');
      }

      if (instrumented) {
        renderCount += 1;
      }

      return h(Tracker, {
        ref: trackerHandle,
        options: options.value,
        rules: rules.value,
        scrollRoot: dom.scrollRoot,
        sourceRoot: dom.sourceRoot,
        onSyncEnd: () => {
          pendingSyncEndResolve?.();
          pendingSyncEndResolve = null;
        },
      });
    },
  });

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

      renderCount = 0;
      app = createApp(BenchmarkHost);
      app.mount(dom.appHost);
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
      rendersCompletedBefore = trackerHandle.value?.getStats()?.renders.completed ?? null;
      mutationCounter?.disconnect();
      mutationCounter = instrumented ? createMutationCounter(activeAppHost) : null;

      if (kind === 'marker-presentation') {
        markerTitleToggle = !markerTitleToggle;

        const nextOptions = { ...options.value, marker: { ...options.value.marker, title: markerTitleToggle } };
        const syncEndPromise = armSyncEndWait();

        pendingTrigger = () => {
          options.value = nextOptions;
        };
        settleTask = async () => {
          await syncEndPromise;
          await flush();
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
        const keysBefore = readRenderedItemKeys(activeAppHost);
        const changedCount = replaceSourceElements(activeDom.sourceRoot, currentSize);
        const syncEndPromise = armSyncEndWait();

        pendingTrigger = () => {
          trackerHandle.value?.refresh();
        };
        settleTask = async () => {
          await syncEndPromise;
          await flush();
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
        // Core applies the selection through `interactionController.commitSelectionRequest()`
        // from its own native keyboard listener, outside Vue's reactive-update scheduler. Vue's
        // scheduler still flushes the resulting DOM update asynchronously (one microtask
        // suffices empirically), so the DOM has not necessarily updated yet by the time the
        // trigger returns - wait a microtask before reading the settled state.
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

    readSettleResult(): VueAdapterSettleResult {
      const activeDom = dom;

      if (activeDom === null) {
        throw new Error('readSettleResult() called before mount().');
      }

      const mutationCount = mutationCounter?.read() ?? null;

      mutationCounter?.disconnect();
      mutationCounter = null;

      assertWork?.();
      assertWork = null;

      const stats = trackerHandle.value?.getStats() ?? null;
      const rendersCompletedAfter = stats?.renders.completed ?? null;

      return {
        coreDurationMs: lastWorkKind === 'selection-only' ? null : (stats?.lastRender?.duration ?? null),
        mutationCount,
        renderedItemCount: countRenderedItems(activeDom.appHost),
        rendersCompletedDelta:
          rendersCompletedBefore === null || rendersCompletedAfter === null
            ? null
            : rendersCompletedAfter - rendersCompletedBefore,
        vueRenderFunctionCallCount: instrumented ? renderCount : null,
      };
    },

    getStats() {
      return trackerHandle.value?.getStats() ?? null;
    },

    destroy() {
      mutationCounter?.disconnect();
      mutationCounter = null;
      app?.unmount();
      app = null;
    },

    cleanup() {
      dom?.teardown();
      dom = null;
    },
  };
}

window.__rxtAdapterBenchmark = {
  default: createVueVariant('vue-default'),
};

export {};
