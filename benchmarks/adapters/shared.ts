import type { TrackerOptions, TrackerRule } from '@rightxt/tracker-core';

/**
 * Shared scaffolding for the three framework adapter-benchmark entries
 * (`react.ts`, `vue.ts`, `angular.ts`). Only framework-agnostic DOM setup and
 * measurement primitives live here; each entry owns its own framework-specific
 * mount/update/commit/destroy logic so per-framework completion boundaries
 * are not forced into one shared abstraction.
 */

/** Kind of update `triggerWork()` performs against a mounted variant. */
type AdapterWorkKind = 'marker-presentation' | 'viewport-only' | 'selection-only' | 'structural-update';

/** Measurement read after a `triggerWork()` call has fully settled. */
interface AdapterSettleResult {
  /**
   * Core's own `sync:end` duration for the render this work triggered, or
   * `null` when the work kind never reaches Core's render pipeline
   * (`selection-only`, which Core applies via `interactionController` without
   * a render pass) or metrics were unavailable.
   */
  readonly coreDurationMs: number | null;
  /**
   * Total DOM mutation records observed on the render host during the work, or
   * `null` outside the instrumented pass: the observer is a benchmark-owned
   * cost and never runs while a timed sample is in flight.
   */
  readonly mutationCount: number | null;
  /** Rendered item nodes present once the work settled. */
  readonly renderedItemCount: number;
  /**
   * How far `stats.renders.completed` advanced across the work, or `null` when
   * stats were unavailable on either side. Work volume, not an invariant.
   */
  readonly rendersCompletedDelta: number | null;
}

/**
 * Uniform per-framework/per-mode benchmark hook installed on `window.__rxtAdapterBenchmark`.
 *
 * The contract exists to keep exactly one thing inside the timed span: the production
 * trigger and the wait for it to settle.
 *
 * - `prepare(size)` builds the benchmark-owned scaffold and populates the source root.
 * - `mount()` attaches the framework runtime. It is a preparation step, not a measurement:
 *   what it actually performs is framework bootstrap (root/application creation plus the
 *   initial commit), which is not the cost of inserting a Tracker component into a running
 *   application.
 * - `setInstrumented(instrumented)` turns benchmark-owned observers and counters on or off.
 *   Timed samples always run uninstrumented; a single trailing instrumented repetition
 *   collects the evidence instead.
 * - `prepareWork(kind)` performs every benchmark-owned step the work needs before the timer
 *   starts: source-element replacement, capturing "before" state, and arming the settle wait.
 *   The source mutation observer is disabled for every variant, so pre-timer DOM edits start
 *   no work.
 * - `triggerWork(kind)` performs only the production trigger prepared for that kind.
 * - `waitSettled()` waits for the framework and Core to settle and does nothing else.
 * - `readSettleResult()` reads counters and stats and runs the semantic checks, after the
 *   timer has already stopped.
 * - `destroy()` detaches the framework runtime and `cleanup()` removes the scaffold.
 *
 * `mount` may return a `Promise`: most frameworks mount synchronously, but Angular's
 * `Application` bootstrap is inherently asynchronous, and every variant must support being
 * prepared, mounted, exercised, and destroyed repeatedly (once per workload size) rather than
 * only once.
 */
interface AdapterBenchmarkVariant {
  prepare(size: number): void;
  mount(): void | Promise<void>;
  setInstrumented(instrumented: boolean): void;
  prepareWork(kind: AdapterWorkKind): void;
  triggerWork(kind: AdapterWorkKind): void;
  waitSettled(): Promise<void>;
  readSettleResult(): AdapterSettleResult;
  getStats(): unknown;
  destroy(): void;
  cleanup(): void;
}

/** CSS class every generated probe element carries; matched by the shared benchmark rule. */
const ADAPTER_BENCHMARK_PROBE_SELECTOR = '.adapter-benchmark-probe';

/**
 * Fraction of the source-element population replaced by `structural-update` work, matching
 * `benchmarks/core-render-pipeline.mjs`'s `source-add-small` / `source-remove-small` scenarios
 * (also 0.1) so the two measurements stay comparable in shape.
 */
const STRUCTURAL_UPDATE_FRACTION = 0.1;

/**
 * Isolated benchmark options shared by every variant: metrics enabled so
 * `getStats().lastRender.duration` reflects Core's own render pass, clustering
 * disabled to keep the pipeline shape simple, only the scroll observer
 * enabled so `viewport-only` triggers naturally while `marker-presentation`
 * and `selection-only` (driven directly, not through an observer) stay unaffected,
 * and keyboard accessibility enabled so `selection-only` can dispatch the real
 * production keyboard-selection trigger (`InteractionController` only commits a
 * keyboard selection request when `a11y.keyboard` is turned on).
 */
function createAdapterBenchmarkOptions(): Partial<TrackerOptions> {
  return {
    a11y: { enabled: true, keyboard: true },
    clustering: { enabled: false },
    diagnostics: { metrics: true },
    updates: {
      interval: { enabled: false },
      mutation: { enabled: false },
      resize: { enabled: false },
      scroll: { enabled: true },
    },
  };
}

/** Rule set matching every generated probe element. */
function createAdapterBenchmarkRules(): TrackerRule[] {
  return [{ selector: ADAPTER_BENCHMARK_PROBE_SELECTOR }];
}

/** DOM scaffold owned by one mounted variant. */
interface AdapterBenchmarkDom {
  /** Query root containing generated probe elements. */
  readonly sourceRoot: HTMLElement;
  /** Scrollable wrapper representing the viewport, containing both other elements. */
  readonly scrollRoot: HTMLElement;
  /**
   * Element the framework mounts its component tree into. For the vanilla/Element
   * flows this doubles as the direct render target; framework adapters render
   * their own internal root DOM inside it instead.
   */
  readonly appHost: HTMLElement;
  teardown(): void;
}

/**
 * Builds a variant-scoped, element-scroll DOM scaffold appended to the page body.
 *
 * Each variant gets its own namespaced subtree so several variants (e.g. React's
 * `forced`/`unforced`) can coexist mounted on the same page without colliding.
 *
 * @param variantId - Unique id used to namespace the scaffold's root element.
 * @returns Scaffold references and a teardown callback.
 */
function buildAdapterBenchmarkDom(variantId: string): AdapterBenchmarkDom {
  const existing = document.getElementById(`adapter-benchmark-${variantId}`);

  existing?.remove();

  const root = document.createElement('div');

  root.id = `adapter-benchmark-${variantId}`;
  root.style.cssText = 'position: relative; height: 300px; overflow-y: auto;';

  const sourceRoot = document.createElement('main');
  const appHost = document.createElement('div');

  root.append(sourceRoot, appHost);
  document.body.append(root);

  return {
    sourceRoot,
    scrollRoot: root,
    appHost,
    teardown: () => {
      root.remove();
    },
  };
}

/**
 * Replaces a source root's probe elements with a fresh, real-layout set.
 *
 * @param sourceRoot - Source root to populate.
 * @param size - Probe element count.
 */
function populateProbeElements(sourceRoot: HTMLElement, size: number): void {
  sourceRoot.replaceChildren();

  const fragment = document.createDocumentFragment();

  for (let index = 0; index < size; index += 1) {
    const element = document.createElement('div');

    element.className = 'adapter-benchmark-probe';
    element.dataset.benchmarkIndex = String(index);
    element.style.cssText = 'height: 12px; margin-block-end: 6px;';
    fragment.append(element);
  }

  sourceRoot.append(fragment);
}

/**
 * Replaces a fraction of a source root's existing probe elements with brand-new ones, keeping
 * the total probe count unchanged: removes the first `removeCount` probes (by document order)
 * and appends `removeCount` freshly created ones. Exercises removal and insertion together
 * without changing overall list size, isolating keyed-reconciliation cost from any confound
 * with total DOM size.
 *
 * @param sourceRoot - Source root whose probe elements get replaced.
 * @param currentSize - Current probe element count (as populated by `populateProbeElements`).
 * @returns Number of probe elements removed and re-inserted.
 */
function replaceSourceElements(sourceRoot: HTMLElement, currentSize: number): number {
  const removeCount = Math.max(1, Math.min(currentSize, Math.round(currentSize * STRUCTURAL_UPDATE_FRACTION)));
  const existingProbes = sourceRoot.querySelectorAll<HTMLElement>(ADAPTER_BENCHMARK_PROBE_SELECTOR);

  for (let index = 0; index < removeCount; index += 1) {
    existingProbes[index]?.remove();
  }

  const fragment = document.createDocumentFragment();

  for (let index = 0; index < removeCount; index += 1) {
    const element = document.createElement('div');

    element.className = 'adapter-benchmark-probe';
    element.dataset.benchmarkIndex = String(currentSize + index);
    element.style.cssText = 'height: 12px; margin-block-end: 6px;';
    fragment.append(element);
  }

  sourceRoot.append(fragment);

  return removeCount;
}

/** Live DOM-mutation counter used to measure adapter completion side effects. */
interface MutationCounter {
  read(): number;
  disconnect(): void;
}

/**
 * Starts counting mutation records observed on a target subtree.
 *
 * @param target - Subtree root to observe.
 * @returns Counter handle.
 */
function createMutationCounter(target: Node): MutationCounter {
  let count = 0;
  const observer = new MutationObserver((records) => {
    count += records.length;
  });

  observer.observe(target, { attributes: true, characterData: true, childList: true, subtree: true });

  return {
    read: () => count + observer.takeRecords().length,
    disconnect: () => {
      observer.disconnect();
    },
  };
}

/**
 * Dispatches the real production keyboard-selection trigger for `selection-only` work: a
 * bubbling `ArrowDown` `keydown` `KeyboardEvent` on the Tracker root element.
 *
 * `InteractionController.connect()` attaches its keyboard listener directly to that root node
 * (see `packages/core/src/tracker/lifecycle.ts`), independent of which framework rendered it,
 * so this reaches Core's real `commitSelectionRequest()` path identically for every adapter.
 * Keyboard accessibility must be enabled (`createAdapterBenchmarkOptions()` sets
 * `a11y: { enabled: true, keyboard: true }`) or the listener never commits a selection.
 *
 * @param renderHost - Root element the framework mounted its Tracker instance into.
 * @returns The Tracker root element the event was dispatched on.
 * @throws If no `.rxtt` Tracker root is found inside `renderHost`.
 */
function dispatchSelectionNavigation(renderHost: HTMLElement): HTMLElement {
  const trackerRoot = renderHost.querySelector<HTMLElement>('.rxtt');

  if (trackerRoot === null) {
    throw new Error('dispatchSelectionNavigation() found no ".rxtt" Tracker root inside the render host.');
  }

  trackerRoot.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));
  return trackerRoot;
}

/**
 * Reads the key of the currently selected rendered item, or `null` when nothing is selected.
 *
 * @param renderHost - Root element containing rendered item nodes.
 * @returns The selected item's `data-rxtt-key` value, or `null`.
 */
function readSelectedItemKey(renderHost: HTMLElement): string | null {
  return renderHost.querySelector<HTMLElement>('[data-rxtt-selected="true"]')?.dataset.rxttKey ?? null;
}

/**
 * Verifies that a `selection-only` work sample produced the real selection-commit effect
 * instead of silently measuring a no-op: the selected item key must have actually changed.
 *
 * Whether Core's render pipeline advanced is deliberately not checked here. That is a work
 * count, and gating on it would turn a change in how much work a selection performs into an
 * incomparable sample; the `renders.completed` delta is published as `diagnostics` instead.
 *
 * @param renderHost - Root element containing rendered item nodes.
 * @param selectedKeyBefore - Selected item key captured immediately before dispatch.
 * @throws If the selected key did not change.
 */
function assertSelectionOnlyEffect(renderHost: HTMLElement, selectedKeyBefore: string | null): void {
  const selectedKeyAfter = readSelectedItemKey(renderHost);

  if (selectedKeyAfter === selectedKeyBefore) {
    throw new Error(
      `selection-only work did not change the selected item key (stayed "${String(selectedKeyBefore)}").`,
    );
  }
}

/**
 * Reads the keys of every currently rendered item node.
 *
 * @param renderHost - Root element containing rendered item nodes.
 * @returns Set of `data-rxtt-key` values present in the DOM right now.
 */
function readRenderedItemKeys(renderHost: HTMLElement): Set<string> {
  return new Set(
    Array.from(renderHost.querySelectorAll<HTMLElement>('[data-rxtt-key]'), (element) => element.dataset.rxttKey ?? ''),
  );
}

/**
 * Verifies that a `structural-update` work sample actually reconciled the replaced keys instead
 * of silently measuring a no-op: the rendered item count must stay unchanged (total source size
 * never changes), and exactly `expectedChangedCount` keys must have disappeared while exactly
 * `expectedChangedCount` different keys appeared, proving real removal + insertion occurred.
 *
 * @param renderHost - Root element containing rendered item nodes.
 * @param keysBefore - Rendered item keys captured immediately before the source mutation.
 * @param expectedItemCount - Total rendered item count expected after settling (unchanged from before).
 * @param expectedChangedCount - Number of probe elements replaced.
 * @throws If the rendered count changed, or the removed/added key counts don't match expectations.
 */
function assertStructuralUpdateEffect(
  renderHost: HTMLElement,
  keysBefore: ReadonlySet<string>,
  expectedItemCount: number,
  expectedChangedCount: number,
): void {
  const keysAfter = readRenderedItemKeys(renderHost);

  if (keysAfter.size !== expectedItemCount) {
    throw new Error(
      `structural-update work left ${String(keysAfter.size)} rendered item(s), expected ${String(expectedItemCount)}.`,
    );
  }

  const removedKeys = Array.from(keysBefore).filter((key) => !keysAfter.has(key));
  const addedKeys = Array.from(keysAfter).filter((key) => !keysBefore.has(key));

  if (removedKeys.length !== expectedChangedCount || addedKeys.length !== expectedChangedCount) {
    throw new Error(
      `structural-update work reconciled ${String(removedKeys.length)} removed / ${String(addedKeys.length)} added key(s), expected ${String(expectedChangedCount)} of each.`,
    );
  }
}

/**
 * Counts the rendered item nodes currently present.
 *
 * @param renderHost - Root element containing rendered item nodes.
 * @returns Number of `[data-rxtt-key]` nodes.
 */
function countRenderedItems(renderHost: HTMLElement): number {
  return renderHost.querySelectorAll('[data-rxtt-key]').length;
}

/**
 * Resolves after two animation frames, the "unforced" React completion
 * boundary: React's own scheduler (faster than `requestAnimationFrame`) is
 * guaranteed to have flushed by the first frame, and the second frame confirms
 * the resulting DOM write has been painted.
 *
 * @returns Promise resolved after two animation frames.
 */
function waitTwoAnimationFrames(): Promise<void> {
  return new Promise((resolveFrames) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolveFrames();
      });
    });
  });
}

export {
  ADAPTER_BENCHMARK_PROBE_SELECTOR,
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
};
export type { AdapterBenchmarkDom, AdapterBenchmarkVariant, AdapterSettleResult, AdapterWorkKind };
