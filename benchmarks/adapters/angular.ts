import 'zone.js';
import '@angular/compiler';

import { NgZone, provideZoneChangeDetection, provideZonelessChangeDetection } from '@angular/core';
import { createApplication } from '@angular/platform-browser';

import { TrackerComponent } from '@rightxt/tracker-angular';

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

import type { ApplicationRef, ComponentRef, EnvironmentProviders, Provider } from '@angular/core';
import type { TrackerOptions } from '@rightxt/tracker-core';
import type { AdapterBenchmarkDom, AdapterBenchmarkVariant, AdapterSettleResult, AdapterWorkKind } from './shared.js';

declare global {
  interface Window {
    __rxtAdapterBenchmark?: Record<string, AdapterBenchmarkVariant>;
  }
}

/**
 * Creates one Angular adapter-benchmark variant. `mount()` bootstraps a fresh, isolated
 * `Application` on every call (`zoneless` via `provideZonelessChangeDetection()`, `zoneful`
 * via `provideZoneChangeDetection()`, matching the split already established by
 * `TrackerComponent.test.ts` / `TrackerComponent.zoneful.test.ts`) rather than once at
 * variant-creation time: one variant instance is prepared, mounted, exercised, and destroyed
 * once per workload size, and `destroy()` permanently destroys its `Application` —
 * `componentRef.setInput` on a destroyed application's component throws, matching how a
 * `createRoot` root cannot be reused after `unmount()` in React. `createApplication`'s
 * bootstrap is inherently asynchronous, so `mount()` is async here even though the other
 * frameworks mount synchronously. Every settle point uses the exact
 * `tick(); await Promise.resolve(); tick();` sequence proven by those tests' `mountTracker()`
 * helper and interaction assertions.
 *
 * This variant reports the base `AdapterSettleResult` shape unchanged: `TrackerComponent` is
 * bootstrapped directly (not wrapped in an instrumentable host component) and uses `OnPush`
 * change detection, so its own render-execution count is not honestly observable without risky
 * subclassing — a documented scoping decision, not a limitation specific to zoneless mode, and
 * not a value worth reporting as `null` evidence alongside frameworks that report a real count.
 *
 * @param variantId - Unique id used to namespace this variant's DOM scaffold.
 * @param providers - Change-detection provider(s) for this variant's `Application`.
 * @returns Benchmark variant.
 */
function createAngularVariant(
  variantId: string,
  providers: readonly (Provider | EnvironmentProviders)[],
): AdapterBenchmarkVariant {
  let dom: AdapterBenchmarkDom | null = null;
  let application: ApplicationRef | null = null;
  let componentRef: ComponentRef<TrackerComponent> | null = null;
  let ngZone: NgZone | null = null;
  let currentSize = 0;
  let currentOptions: Partial<TrackerOptions> = createAdapterBenchmarkOptions();
  let lastWorkKind: AdapterWorkKind | null = null;
  let preparedKind: AdapterWorkKind | null = null;
  let pendingTrigger: (() => void) | null = null;
  let settleTask: (() => Promise<void>) | null = null;
  let assertWork: (() => void) | null = null;
  let mutationCounter: ReturnType<typeof createMutationCounter> | null = null;
  let instrumented = false;
  let rendersCompletedBefore: number | null = null;
  // Core's default `marker.title` is `true` (defaultOptions.ts); starting the
  // toggle at `true` makes the first flip land on `false`, which always
  // differs from the applied value, so diffOptions always sees a real change.
  let markerTitleToggle = true;

  /** Creates a promise resolved by the next `syncEnd` output emission. */
  function armSyncEndWait(): Promise<void> {
    return new Promise((resolve) => {
      if (componentRef === null) {
        throw new Error('armSyncEndWait() called before mount().');
      }

      const subscription = componentRef.instance.syncEnd.subscribe(() => {
        subscription.unsubscribe();
        resolve();
      });
    });
  }

  return {
    prepare(size) {
      dom = buildAdapterBenchmarkDom(variantId);
      populateProbeElements(dom.sourceRoot, size);
      currentSize = size;
    },

    async mount() {
      if (dom === null) {
        throw new Error('mount() called before prepare().');
      }

      application = await createApplication({ providers: [...providers] });
      ngZone = application.injector.get(NgZone);
      componentRef = application.bootstrap(TrackerComponent, dom.appHost);

      application.tick();
      await Promise.resolve();
      application.tick();

      currentOptions = createAdapterBenchmarkOptions();
      componentRef.setInput('options', currentOptions);
      componentRef.setInput('rules', createAdapterBenchmarkRules());
      componentRef.setInput('sourceRoot', dom.sourceRoot);
      componentRef.setInput('scrollRoot', dom.scrollRoot);
      application.tick();
    },

    setInstrumented(nextInstrumented) {
      instrumented = nextInstrumented;
    },

    prepareWork(kind) {
      if (dom === null || application === null || componentRef === null || ngZone === null) {
        throw new Error('prepareWork() called before mount().');
      }

      const activeDom = dom;
      const activeApplication = application;
      const activeComponentRef = componentRef;
      const activeNgZone = ngZone;
      const activeAppHost = activeDom.appHost;

      lastWorkKind = kind;
      preparedKind = kind;
      assertWork = null;
      rendersCompletedBefore = activeComponentRef.instance.getStats()?.renders.completed ?? null;
      mutationCounter?.disconnect();
      mutationCounter = instrumented
        ? activeNgZone.runOutsideAngular(() => createMutationCounter(activeAppHost))
        : null;

      if (kind === 'marker-presentation') {
        markerTitleToggle = !markerTitleToggle;

        const nextOptions = { ...currentOptions, marker: { ...currentOptions.marker, title: markerTitleToggle } };
        const syncEndPromise = armSyncEndWait();

        pendingTrigger = () => {
          currentOptions = nextOptions;
          activeComponentRef.setInput('options', currentOptions);
          activeApplication.tick();
        };
        settleTask = async () => {
          await syncEndPromise;
          await Promise.resolve();
          activeApplication.tick();
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
          await Promise.resolve();
          activeApplication.tick();
        };
        return;
      }

      if (kind === 'structural-update') {
        const keysBefore = readRenderedItemKeys(activeAppHost);
        const changedCount = replaceSourceElements(activeDom.sourceRoot, currentSize);
        const syncEndPromise = armSyncEndWait();

        pendingTrigger = () => {
          activeComponentRef.instance.refresh();
          activeApplication.tick();
        };
        settleTask = async () => {
          await syncEndPromise;
          await Promise.resolve();
          activeApplication.tick();
        };
        assertWork = () => {
          assertStructuralUpdateEffect(activeAppHost, keysBefore, currentSize, changedCount);
        };
        return;
      }

      const selectedKeyBefore = readSelectedItemKey(activeAppHost);

      pendingTrigger = () => {
        dispatchSelectionNavigation(activeAppHost);
      };
      settleTask = async () => {
        // Core applies the selection through `interactionController.commitSelectionRequest()`
        // from its own native keyboard listener. Under zoneful change detection, Zone.js's
        // `addEventListener` patch happens to force a synchronous-ish tick, but zoneless change
        // detection coalesces the resulting update onto a later task and needs an explicit
        // nudge - tick after a microtask the same way the marker-presentation branch above does
        // (a harmless no-op when a tick already happened synchronously).
        await Promise.resolve();
        activeApplication.tick();
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

    readSettleResult(): AdapterSettleResult {
      const activeDom = dom;

      if (activeDom === null) {
        throw new Error('readSettleResult() called before mount().');
      }

      const mutationCount = mutationCounter?.read() ?? null;

      mutationCounter?.disconnect();
      mutationCounter = null;

      assertWork?.();
      assertWork = null;

      const stats = componentRef?.instance.getStats() ?? null;
      const rendersCompletedAfter = stats?.renders.completed ?? null;

      return {
        coreDurationMs: lastWorkKind === 'selection-only' ? null : (stats?.lastRender?.duration ?? null),
        mutationCount,
        renderedItemCount: countRenderedItems(activeDom.appHost),
        rendersCompletedDelta:
          rendersCompletedBefore === null || rendersCompletedAfter === null
            ? null
            : rendersCompletedAfter - rendersCompletedBefore,
      };
    },

    getStats() {
      return componentRef?.instance.getStats() ?? null;
    },

    destroy() {
      mutationCounter?.disconnect();
      mutationCounter = null;
      application?.destroy();
      application = null;
      componentRef = null;
      ngZone = null;
    },

    cleanup() {
      dom?.teardown();
      dom = null;
    },
  };
}

window.__rxtAdapterBenchmark = {
  zoneful: await createAngularVariant('angular-zoneful', [provideZoneChangeDetection()]),
  zoneless: await createAngularVariant('angular-zoneless', [provideZonelessChangeDetection()]),
};

export {};
