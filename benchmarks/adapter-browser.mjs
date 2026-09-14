/* eslint-disable no-console -- Command-line benchmark reports its progress and output paths. */

import process from 'node:process';
import { chromium } from 'playwright';
import { parseBenchmarkArguments } from './lib/cli.mjs';
import { collectBenchmarkEnvironment } from './lib/environment.mjs';
import { writeBenchmarkReports } from './lib/reporting.mjs';
import { median, summarizeDurations } from './lib/statistics.mjs';
import { startStaticServer } from './lib/static-server.mjs';
import { getBenchmarkProfile } from './profiles.mjs';

/** Parsed command-line options for this benchmark invocation. */
const arguments_ = parseBenchmarkArguments(process.argv.slice(2));

/** Canonical profile metadata used for report provenance. */
const profile = getBenchmarkProfile('adapter-browser');

/**
 * Representative source-element workload sizes. Intentionally smaller than
 * the other browser benchmarks: bootstrapping a framework runtime (in
 * particular an Angular `Application`) per cell is comparatively expensive.
 */
const WORKLOAD_SIZES = Object.freeze(arguments_.smoke ? [25] : [1000, 10000]);

/** Update work kinds exercised against every mounted variant. */
const WORK_KINDS = Object.freeze(['marker-presentation', 'viewport-only', 'selection-only', 'structural-update']);

/** Timed repetitions per (variant, size, work kind); even, so reversible work balances both directions. */
const SAMPLE_COUNT = arguments_.smoke ? 2 : 4;

/** Discarded repetitions preceding the timed ones, leaving the work in the phase the first sample expects. */
const WARMUP_COUNT = arguments_.smoke ? 0 : 1;

/**
 * Bumped from 4 to 5 for every case: `selection-only` now always runs at least one untimed
 * preconditioning repetition, so its smoke-mode samples are node-to-node transitions like every
 * other sample instead of starting from an empty selection.
 *
 * Version 4 changed the measurement as follows. Benchmark-owned preparation (source-element replacement,
 * "before" state capture, arming the settle wait) moved out of the timed span into
 * `prepareWork()`, so a sample now times only the production trigger and the wait for it to
 * settle. Benchmark instrumentation (the DOM mutation observer and the React/Vue render-call
 * counters) left the timed samples entirely and runs in one separate repetition afterwards.
 * Each work kind is now repeated and published as a duration summary instead of a single
 * sample, and the `mount` and `destroy` metrics were removed: `mount` timed framework
 * bootstrap rather than inserting a Tracker component into a running application, and the raw
 * `destroy` duration was not a meaningful comparison number on its own.
 */
const ADAPTER_BROWSER_MEASUREMENT_VERSION = 5;

/** Viewport used for repeatable headless measurements. */
const VIEWPORT = Object.freeze({ height: 720, width: 1280 });

/**
 * Built `benchmarks/adapters/dist/*.js` bridges exposing `window.__rxtAdapterBenchmark`,
 * each with one or more independently mounted variant keys.
 */
const FRAMEWORK_ENTRIES = Object.freeze([
  { entry: 'react', framework: 'react', variantKeys: ['forced', 'unforced'] },
  { entry: 'vue', framework: 'vue', variantKeys: ['default'] },
  { entry: 'angular', framework: 'angular', variantKeys: ['zoneful', 'zoneless'] },
]);

/**
 * Exercises every work kind against one already-installed
 * `window.__rxtAdapterBenchmark` variant, mounted once.
 *
 * The framework runtime is bootstrapped a single time and every repetition runs against it:
 * re-bootstrapping per sample would dominate the measurement. Each repetition restores an
 * equivalent precondition outside the timer instead - `marker-presentation` and
 * `viewport-only` alternate reversibly, `selection-only` moves the selection one node further
 * (it always runs at least one untimed preconditioning repetition, including in smoke mode, so
 * every timed sample is a node-to-node transition), and `structural-update` always replaces the
 * same fraction of a constant-size source population.
 *
 * Self-contained by necessity: Playwright serializes this function and
 * executes it in the browser realm, so it cannot close over anything from
 * the Node-side module scope.
 *
 * @param {{ variantKey: string, size: number, sampleCount: number, warmupCount: number }} args - Variant key, workload size, and sampling counts.
 * @returns {Promise<Record<string, unknown>>} Per-work-kind samples and instrumented evidence.
 */
async function runAdapterCycleInBrowser({ variantKey, size, sampleCount, warmupCount }) {
  const workKinds = ['marker-presentation', 'viewport-only', 'selection-only', 'structural-update'];
  const variant = window.__rxtAdapterBenchmark?.[variantKey];

  if (!variant) {
    throw new Error(`Adapter benchmark variant "${variantKey}" was not installed.`);
  }

  /**
   * Bounds a wait so a variant that never settles (e.g. a scroll/refresh event
   * that never fires) fails loudly instead of hanging the whole matrix.
   *
   * @param {Promise<unknown>} promise - Wait to bound.
   * @param {string} description - Included in the timeout error.
   * @returns {Promise<unknown>} Resolves or rejects with a timeout error.
   */
  function withTimeout(promise, description) {
    const timeoutMs = 15000;

    return Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for: ${description}`));
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * Runs one repetition of a work kind and returns its completion time and settle evidence.
   *
   * @param {string} kind - Work kind to exercise.
   * @returns {Promise<Record<string, unknown>>} Completion time plus the settle result.
   */
  async function runRepetition(kind) {
    variant.prepareWork(kind);

    const startedAt = performance.now();

    variant.triggerWork(kind);
    await withTimeout(variant.waitSettled(), `${variantKey}/${kind} waitSettled()`);

    const completionMs = performance.now() - startedAt;

    return { ...variant.readSettleResult(), completionMs };
  }

  variant.prepare(size);
  await variant.mount();

  const work = {};

  for (const kind of workKinds) {
    variant.setInstrumented(false);

    // `selection-only` is only equivalent sample to sample once something is already selected:
    // the first dispatch moves the selection from "none" to a node, every later one is a
    // node-to-node transition. It therefore always runs at least one untimed repetition, even
    // in smoke mode where the global warm-up count is zero.
    const kindWarmupCount = kind === 'selection-only' ? Math.max(warmupCount, 1) : warmupCount;

    for (let index = 0; index < kindWarmupCount; index += 1) {
      await runRepetition(kind);
    }

    const samples = [];

    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(await runRepetition(kind));
    }

    variant.setInstrumented(true);

    const instrumented = await runRepetition(kind);

    variant.setInstrumented(false);

    if (samples.some((sample) => sample.renderedItemCount !== samples[0].renderedItemCount)) {
      throw new Error(`Work kind "${kind}" rendered different item counts across its samples.`);
    }

    work[kind] = { instrumented, samples };
  }

  variant.destroy();
  variant.cleanup();

  return { work };
}

/**
 * Exercises the same work kinds against a hand-built `rxt-tracker` Custom Element.
 * Element has no adapter-benchmark bridge entry or shared `window.__rxtAdapterBenchmark`
 * hook, so it is driven entirely through its own imperative API, mirroring the framework
 * variants' sampling shape - untimed preparation, timed trigger plus settle, repeated
 * samples, and one separate instrumented repetition - by hand.
 *
 * Self-contained for the same reason as {@link runAdapterCycleInBrowser}.
 *
 * @param {{ size: number, sampleCount: number, warmupCount: number }} args - Workload size and sampling counts.
 * @returns {Promise<Record<string, unknown>>} Per-work-kind samples and instrumented evidence.
 */
async function runElementCycleInBrowser({ size, sampleCount, warmupCount }) {
  const workKinds = ['marker-presentation', 'viewport-only', 'selection-only', 'structural-update'];
  const structuralUpdateFraction = 0.1;

  /**
   * Appends real-layout probe elements to a source root.
   *
   * @param {HTMLElement} sourceRoot - Destination root.
   * @param {number} count - Element count.
   * @returns {void}
   */
  function populateProbeElements(sourceRoot, count) {
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < count; index += 1) {
      const probe = document.createElement('div');

      probe.className = 'adapter-benchmark-probe';
      probe.dataset.benchmarkIndex = String(index);
      probe.style.cssText = 'height: 12px; margin-block-end: 6px;';
      fragment.append(probe);
    }

    sourceRoot.append(fragment);
  }

  /**
   * Resolves once a target's next `sync:end` custom event fires.
   *
   * @param {EventTarget} target - Event target to observe.
   * @returns {Promise<void>} Resolves on render completion.
   */
  function waitForSyncEnd(target) {
    const timeoutMs = 15000;

    return Promise.race([
      new Promise((resolveWait) => {
        const handler = () => {
          target.removeEventListener('sync:end', handler);
          resolveWait();
        };

        target.addEventListener('sync:end', handler);
      }),
      new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for sync:end`));
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * Reads the key of the currently selected rendered item, or `null` when nothing is selected.
   *
   * @param {ParentNode} renderHost - Root element containing rendered item nodes.
   * @returns {string | null} The selected item's `data-rxtt-key` value, or `null`.
   */
  function readSelectedItemKey(renderHost) {
    return renderHost.querySelector('[data-rxtt-selected="true"]')?.dataset.rxttKey ?? null;
  }

  /**
   * Dispatches the real production keyboard-selection trigger for `selection-only` work: a
   * bubbling `ArrowDown` `keydown` `KeyboardEvent` on the Tracker root element, matching
   * `benchmarks/adapters/shared.ts`'s `dispatchSelectionNavigation()` used by the framework
   * adapter variants.
   *
   * @param {ParentNode} renderHost - Root element the Tracker instance was mounted into.
   * @returns {HTMLElement} The Tracker root element the event was dispatched on.
   * @throws If no `.rxtt` Tracker root is found inside `renderHost`.
   */
  function dispatchSelectionNavigation(renderHost) {
    const trackerRoot = renderHost.querySelector('.rxtt');

    if (trackerRoot === null) {
      throw new Error('dispatchSelectionNavigation() found no ".rxtt" Tracker root inside the render host.');
    }

    trackerRoot.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));
    return trackerRoot;
  }

  /**
   * Verifies that a `selection-only` work sample produced the real selection-commit effect
   * instead of silently measuring a no-op, matching `shared.ts`'s `assertSelectionOnlyEffect()`.
   *
   * Whether the selection commit stayed off the render path is work volume, not a semantic
   * outcome, so the `renders.completed` delta is published as diagnostics instead of throwing.
   *
   * @param {ParentNode} renderHost - Root element containing rendered item nodes.
   * @param {string | null} selectedKeyBefore - Selected item key captured immediately before dispatch.
   * @throws If the selected key did not change.
   */
  function assertSelectionOnlyEffect(renderHost, selectedKeyBefore) {
    const selectedKeyAfter = readSelectedItemKey(renderHost);

    if (selectedKeyAfter === selectedKeyBefore) {
      throw new Error(
        `selection-only work did not change the selected item key (stayed "${String(selectedKeyBefore)}").`,
      );
    }
  }

  /**
   * Counts the rendered item nodes currently present, matching
   * `benchmarks/adapters/shared.ts`'s `countRenderedItems()`.
   *
   * @param {ParentNode} renderHost - Root element containing rendered item nodes.
   * @returns {number} Number of nodes carrying a `data-rxtt-key`.
   */
  function countRenderedItems(renderHost) {
    return renderHost.querySelectorAll('[data-rxtt-key]').length;
  }

  /**
   * Reads the keys of every currently rendered item node, matching
   * `benchmarks/adapters/shared.ts`'s `readRenderedItemKeys()`.
   *
   * @param {ParentNode} renderHost - Root element containing rendered item nodes.
   * @returns {Set<string>} Set of `data-rxtt-key` values present in the DOM right now.
   */
  function readRenderedItemKeys(renderHost) {
    return new Set(Array.from(renderHost.querySelectorAll('[data-rxtt-key]'), (element) => element.dataset.rxttKey));
  }

  /**
   * Replaces a fraction of a source root's existing probe elements with brand-new ones, keeping
   * the total probe count unchanged, matching `benchmarks/adapters/shared.ts`'s
   * `replaceSourceElements()`.
   *
   * @param {HTMLElement} sourceRoot - Source root whose probe elements get replaced.
   * @param {number} currentSize - Current probe element count.
   * @returns {number} Number of probe elements removed and re-inserted.
   */
  function replaceSourceElements(sourceRoot, currentSize) {
    const removeCount = Math.max(1, Math.min(currentSize, Math.round(currentSize * structuralUpdateFraction)));
    const existingProbes = sourceRoot.querySelectorAll('.adapter-benchmark-probe');

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

  /**
   * Verifies that a `structural-update` work sample actually reconciled the replaced keys,
   * matching `benchmarks/adapters/shared.ts`'s `assertStructuralUpdateEffect()`.
   *
   * @param {ParentNode} renderHost - Root element containing rendered item nodes.
   * @param {Set<string>} keysBefore - Rendered item keys captured immediately before the source mutation.
   * @param {number} expectedItemCount - Total rendered item count expected after settling.
   * @param {number} expectedChangedCount - Number of probe elements replaced.
   * @throws If the rendered count changed, or the removed/added key counts don't match expectations.
   */
  function assertStructuralUpdateEffect(renderHost, keysBefore, expectedItemCount, expectedChangedCount) {
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
   * Starts counting mutation records observed on a target subtree.
   *
   * @param {Node} target - Subtree root to observe.
   * @returns {{ disconnect: () => void, read: () => number }} Counter handle.
   */
  function createMutationCounter(target) {
    let count = 0;
    const observer = new MutationObserver((records) => {
      count += records.length;
    });

    observer.observe(target, { attributes: true, characterData: true, childList: true, subtree: true });

    return {
      disconnect: () => {
        observer.disconnect();
      },
      read: () => count + observer.takeRecords().length,
    };
  }

  document.getElementById('adapter-benchmark-element')?.remove();

  const root = document.createElement('div');

  root.id = 'adapter-benchmark-element';
  root.style.cssText = 'position: relative; height: 300px; overflow-y: auto;';

  const sourceRoot = document.createElement('main');

  root.append(sourceRoot);
  document.body.append(root);
  populateProbeElements(sourceRoot, size);

  const trackerElement = document.createElement('rxt-tracker');

  trackerElement.replaceOptions({
    a11y: { enabled: true, keyboard: true },
    clustering: { enabled: false },
    diagnostics: { metrics: true },
    updates: {
      interval: { enabled: false },
      mutation: { enabled: false },
      resize: { enabled: false },
      scroll: { enabled: true },
    },
  });
  trackerElement.replaceRules([{ selector: '.adapter-benchmark-probe' }]);
  trackerElement.sourceRoot = sourceRoot;
  trackerElement.scrollRoot = root;
  // Upgrading and mounting the element is benchmark-owned preparation, not measured work.
  root.append(trackerElement);

  // Core's default `marker.title` is `true` (defaultOptions.ts); starting the
  // toggle at `true` makes the first flip land on `false`, which always
  // differs from the applied value, so diffOptions always sees a real change.
  let markerTitleToggle = true;

  /**
   * Runs one repetition of a work kind: untimed preparation, then a timed production trigger
   * plus its settle wait, then the correctness check and evidence read once the timer stopped.
   *
   * @param {string} kind - Work kind to exercise.
   * @param {boolean} instrumented - Whether to observe DOM mutations during this repetition.
   * @returns {Promise<Record<string, unknown>>} Completion time and settle evidence.
   */
  async function runRepetition(kind, instrumented) {
    const mutationCounter = instrumented ? createMutationCounter(trackerElement) : null;
    const rendersCompletedBefore = trackerElement.getStats()?.renders.completed ?? null;
    let trigger;
    let settle = () => Promise.resolve();
    let assertWork = null;

    if (kind === 'marker-presentation') {
      markerTitleToggle = !markerTitleToggle;

      const nextTitle = markerTitleToggle;
      const syncEndPromise = waitForSyncEnd(trackerElement);

      trigger = () => {
        trackerElement.patchOptions({ marker: { title: nextTitle } });
      };
      settle = () => syncEndPromise;
    } else if (kind === 'viewport-only') {
      const nextScrollTop = root.scrollTop === 0 ? 200 : 0;
      const syncEndPromise = waitForSyncEnd(trackerElement);

      trigger = () => {
        root.scrollTop = nextScrollTop;
      };
      settle = () => syncEndPromise;
    } else if (kind === 'structural-update') {
      const keysBefore = readRenderedItemKeys(trackerElement);
      const changedCount = replaceSourceElements(sourceRoot, size);
      const syncEndPromise = waitForSyncEnd(trackerElement);

      trigger = () => {
        trackerElement.render();
      };
      settle = () => syncEndPromise;
      assertWork = () => {
        assertStructuralUpdateEffect(trackerElement, keysBefore, size, changedCount);
      };
    } else {
      const selectedKeyBefore = readSelectedItemKey(trackerElement);

      trigger = () => {
        dispatchSelectionNavigation(trackerElement);
      };
      // Core applies the selection through `interactionController.commitSelectionRequest()`
      // from its own native keyboard listener, without a render pass, so the DOM already
      // reflects the new selection by the time dispatch returns - no wait belongs here.
      assertWork = () => {
        assertSelectionOnlyEffect(trackerElement, selectedKeyBefore);
      };
    }

    const startedAt = performance.now();

    trigger();
    await settle();

    const completionMs = performance.now() - startedAt;
    const mutationCount = mutationCounter?.read() ?? null;

    mutationCounter?.disconnect();
    assertWork?.();

    const stats = trackerElement.getStats();
    const rendersCompletedAfter = stats?.renders.completed ?? null;

    return {
      completionMs,
      coreDurationMs: kind === 'selection-only' ? null : (stats?.lastRender?.duration ?? null),
      mutationCount,
      renderedItemCount: countRenderedItems(trackerElement),
      rendersCompletedDelta:
        rendersCompletedBefore === null || rendersCompletedAfter === null
          ? null
          : rendersCompletedAfter - rendersCompletedBefore,
    };
  }

  const work = {};

  for (const kind of workKinds) {
    // Same preconditioning rule as the framework variants: `selection-only` always runs at
    // least one untimed repetition so no timed sample starts from an empty selection.
    const kindWarmupCount = kind === 'selection-only' ? Math.max(warmupCount, 1) : warmupCount;

    for (let index = 0; index < kindWarmupCount; index += 1) {
      await runRepetition(kind, false);
    }

    const samples = [];

    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(await runRepetition(kind, false));
    }

    const instrumented = await runRepetition(kind, true);

    if (samples.some((sample) => sample.renderedItemCount !== samples[0].renderedItemCount)) {
      throw new Error(`Work kind "${kind}" rendered different item counts across its samples.`);
    }

    work[kind] = { instrumented, samples };
  }

  trackerElement.remove();

  const leftoverMarkerCount = trackerElement.querySelectorAll('.rxtt__marker').length;

  root.remove();

  if (leftoverMarkerCount !== 0) {
    throw new Error(`Element destruction left ${String(leftoverMarkerCount)} marker node(s) attached.`);
  }

  return { work };
}

/**
 * Fields of an instrumented repetition that repeat what the timed samples already publish;
 * only the instrumentation-only evidence belongs in `diagnostics`.
 */
const INSTRUMENTED_PASS_MEASUREMENT_KEYS = Object.freeze(['completionMs', 'coreDurationMs', 'renderedItemCount']);

/**
 * Keeps only the instrumentation evidence of an instrumented repetition.
 *
 * @param {Record<string, unknown>} instrumented - One instrumented repetition's result.
 * @returns {Record<string, unknown>} Instrumentation counters only.
 */
function createInstrumentedEvidence(instrumented) {
  return Object.fromEntries(
    Object.entries(instrumented).filter(([key]) => !INSTRUMENTED_PASS_MEASUREMENT_KEYS.includes(key)),
  );
}

/**
 * Converts one adapter cell into duration summaries, semantic assertions, and evidence.
 *
 * @param {Record<string, unknown>} result - One collected (framework, variant, size) cell.
 * @returns {Record<string, unknown>} One schema-version-2 report result.
 */
function createReportResult(result) {
  const workMetrics = {};
  const workAssertions = {};
  const workDiagnostics = {};

  Object.entries(result.cycle.work).forEach(([kind, { instrumented, samples }]) => {
    const coreDurations = samples.map((sample) => sample.coreDurationMs).filter((value) => value !== null);

    workMetrics[kind] = {
      completionMs: summarizeDurations(samples.map((sample) => sample.completionMs)),
      coreDurationMs: coreDurations.length === 0 ? null : summarizeDurations(coreDurations),
    };
    // Rendered topology is the semantic outcome of the work; every counter below is work volume.
    workAssertions[kind] = { renderedItemCount: samples[0].renderedItemCount };
    workDiagnostics[kind] = {
      instrumentedPass: createInstrumentedEvidence(instrumented),
      sampleCompletionMs: samples.map((sample) => sample.completionMs),
      sampleRendersCompletedDelta: samples.map((sample) => sample.rendersCompletedDelta),
    };
  });

  return {
    assertions: {
      work: workAssertions,
    },
    caseId: `${result.framework}/${result.variant}/${String(result.itemCount)}`,
    diagnostics: {
      work: workDiagnostics,
    },
    dimensions: {
      framework: result.framework,
      itemCount: result.itemCount,
      variant: result.variant,
    },
    measurementVersion: ADAPTER_BROWSER_MEASUREMENT_VERSION,
    metrics: {
      work: workMetrics,
    },
  };
}

console.log('Running adapter-browser...');

/** Local server exposing the built adapter-benchmark bridge bundles and the Element package. */
const server = await startStaticServer();

/** Headless browser used for real DOM, layout, and scheduler measurements. */
const browser = await chromium.launch({ headless: true });

try {
  const results = [];

  for (const { entry, framework, variantKeys } of FRAMEWORK_ENTRIES) {
    for (const size of WORKLOAD_SIZES) {
      for (const variantKey of variantKeys) {
        // Each (framework, size, variant) cell gets its own fresh page rather than reusing one
        // page across a whole framework entry. This isn't just isolation hygiene: bootstrapping a
        // second zone.js-backed Angular `Application` in the same page after the first was
        // destroyed was found to reliably hang the second Application's marker-presentation update
        // (waitSettled() never resolves) - a JS-realm-level fragility, not a Core or TrackerComponent
        // defect, since production Angular apps never bootstrap more than one Application per realm.
        // A fresh page per cell sidesteps that entirely and, as a side effect, also equalizes
        // measurement conditions (no cell benefits from another cell's JIT/script warm-up).
        const page = await browser.newPage({ viewport: VIEWPORT });

        await page.goto(`${server.origin}/benchmark.html`);
        await page.addScriptTag({ type: 'module', url: `${server.origin}/benchmarks/adapters/dist/${entry}.js` });

        const cycle = await page.evaluate(runAdapterCycleInBrowser, {
          sampleCount: SAMPLE_COUNT,
          size,
          variantKey,
          warmupCount: WARMUP_COUNT,
        });

        results.push({
          cycle,
          framework,
          itemCount: size,
          scenario: `${framework}/${variantKey}`,
          variant: variantKey,
        });

        await page.close();
      }
    }
  }

  {
    const page = await browser.newPage({ viewport: VIEWPORT });

    await page.goto(`${server.origin}/benchmark.html`);
    await page.addScriptTag({ url: `${server.origin}/packages/element/dist/rxt-tracker-element.js` });

    for (const size of WORKLOAD_SIZES) {
      const cycle = await page.evaluate(runElementCycleInBrowser, {
        sampleCount: SAMPLE_COUNT,
        size,
        warmupCount: WARMUP_COUNT,
      });

      results.push({ cycle, framework: 'element', itemCount: size, scenario: 'element/default', variant: 'default' });
    }

    await page.close();
  }

  const report = {
    environment: await collectBenchmarkEnvironment({
      browser: {
        engine: 'chromium',
        headless: true,
        version: browser.version(),
        viewport: VIEWPORT,
      },
      buildTarget: profile.buildTarget,
      provenance: profile.provenance,
    }),
    methodology: {
      cycleScope:
        'Each (framework, variant, itemCount) cell bootstraps its runtime once, on its own fresh browser page (a second zone.js-backed Angular Application bootstrapped into a page that already hosted one was found to hang - production Angular apps never bootstrap more than one Application per JS realm, so each cell gets an isolated realm instead). prepare(), mount(), destroy(), and cleanup() are benchmark-owned preparation and teardown and are not timed: mount() measures framework bootstrap (createRoot/createApp/bootstrapApplication, or Custom Element upgrade) rather than inserting a Tracker into a running application, and a raw destroy duration is not a meaningful comparison number on its own, so neither is published as a metric. Every published number therefore comes from repeated update work against one already-mounted runtime.',
      coreDurationScope:
        'coreDurationMs reads getStats().lastRender.duration (diagnostics.metrics enabled for every variant) after each timed sample and is summarized across samples. It is always null for selection-only work: Core applies selection through interactionController.commitSelectionRequest() without a render pass, so sync:end never fires and lastRender is never updated for that update.',
      instrumentationScope:
        'Benchmark instrumentation - the DOM MutationObserver and the React/Vue render-call counters - is disabled for warm-up and timed samples and enabled for exactly one extra repetition run after them, so no timed sample pays for observation. Its counters, together with the per-sample completion times and renders.completed deltas, are published under diagnostics and gate nothing.',
      renderCallCountScope:
        "React reports reactRootRenderCallCount and Vue reports vueRenderFunctionCallCount, each counting that framework's own wrapper component/render-function execution during the instrumented repetition only; they are null everywhere else. Angular and Element report no equivalent field: TrackerComponent is bootstrapped directly with OnPush change detection, making its own render-execution count impractical to observe honestly, and a Custom Element has no framework render-execution concept to count.",
      samplingScope: `Per work kind: ${String(WARMUP_COUNT)} discarded warm-up repetition(s) - at least one for selection-only regardless of that count - then ${String(SAMPLE_COUNT)} timed samples, then one instrumented repetition. A timed sample spans only the production trigger (patchOptions / scrollTop assignment / keydown dispatch / refresh()) and the wait for it to settle; source-element replacement, before-state capture, arming the settle wait, correctness assertions, and counter reads all happen outside that span. Every sample starts from an equivalent precondition rather than repeating a trigger on progressively mutated state: marker-presentation and viewport-only alternate reversibly (an even sample count balances both directions), selection-only always runs at least one untimed preconditioning repetition - including in smoke mode, where the global warm-up count is zero - so every timed selection-only sample is a node-to-node transition rather than a first selection, and structural-update always replaces the same constant fraction of a constant-size source population. Reported durations are summarized with the shared median/min/max helper.`,
      selectionOnlyTriggerScope:
        'selection-only work dispatches a bubbling ArrowDown keydown KeyboardEvent on the mounted Tracker root (the real production keyboard-selection trigger; a11y.keyboard is enabled for every variant), then asserts the selected item key changed, instead of trusting a fixed settle delay after a synthetic marker click. Whether the commit stayed off the render path is work volume rather than a semantic outcome, so the renders.completed delta is published as diagnostics instead of failing the sample.',
      structuralUpdateTriggerScope:
        "structural-update work replaces a fixed 10% fraction of the source root probe elements (removal and insertion, keeping the total item count constant) and calls the framework-adapter's public refresh()/render() API (updates.mutation is disabled for every variant, so this is the only way the adapter observes the change), exercising the keyed-list reconciliation path (per-item component/DOM-node create+destroy) that marker-presentation, viewport-only, and selection-only never trigger because none of them change the projection item key set after mount. It then asserts via a before/after data-rxtt-key set diff that exactly the replaced count of keys were removed and the same count were added, proving genuine reconciliation occurred rather than a no-op.",
      smoke: arguments_.smoke,
      variants: {
        angular:
          'zoneful (provideZoneChangeDetection) and zoneless (provideZonelessChangeDetection), each its own bootstrapped Application.',
        element:
          'Single variant, driven entirely via the Custom Element imperative API (no example entry, no window.__rxtAdapterBenchmark hook).',
        react:
          'forced (every commit wrapped in flushSync) and unforced (React commits on its own schedule, settled via two animation frames). The two variants only actually differ for marker-presentation: viewport-only and selection-only never go through a React commit.',
        vue: 'Single variant; Vue exposes no synchronous-commit escape hatch equivalent to flushSync.',
      },
      workloadSizes: WORKLOAD_SIZES,
    },
    results: results.map(createReportResult),
  };
  const savedReport = await writeBenchmarkReports('adapter-browser', report, arguments_);

  results.forEach((result) => {
    const workSummary = WORK_KINDS.map((kind) => {
      const medianMs = median(result.cycle.work[kind].samples.map((sample) => sample.completionMs));

      return `${kind} ${medianMs.toFixed(2)}ms`;
    }).join(', ');

    console.log(`${result.scenario}, ${result.itemCount.toLocaleString('en-US')} elements: ${workSummary}`);
  });
  console.log(`Report: ${savedReport.json}`);
  console.log(`Report: ${savedReport.csv}`);
} finally {
  await browser.close();
  await server.close();
}
