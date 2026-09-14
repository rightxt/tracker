/* eslint-disable no-console -- Command-line benchmark reports its progress and output paths. */

import process from 'node:process';
import { chromium } from 'playwright';
import { parseBenchmarkArguments } from './lib/cli.mjs';
import { collectBenchmarkEnvironment } from './lib/environment.mjs';
import { writeBenchmarkReports } from './lib/reporting.mjs';
import { startStaticServer } from './lib/static-server.mjs';
import { median, summarizeDurations } from './lib/statistics.mjs';
import { getBenchmarkProfile } from './profiles.mjs';

/** Parsed command-line options for this benchmark invocation. */
const arguments_ = parseBenchmarkArguments(process.argv.slice(2));

/** Canonical profile metadata used for report provenance. */
const profile = getBenchmarkProfile('core-render-browser');

/** Representative source-element workload sizes. */
const WORKLOAD_SIZES = Object.freeze(arguments_.smoke ? [50] : [1000, 5000, 10000]);

/** Timed samples retained for each scenario/size cell after warm-up. */
const SAMPLE_COUNT = arguments_.smoke ? 1 : 3;

/** Untimed samples used to warm the page's JIT and layout caches. */
const WARMUP_COUNT = arguments_.smoke ? 0 : 1;

/** Rapid trigger count used by every coalescing-burst scenario. */
const BURST_TRIGGER_COUNT = 20;

/** Settle delay past Core's default 100ms mutation debounce. */
const MUTATION_SETTLE_MS = 250;

/** Settle delay past Core's default 50ms resize debounce. */
const RESIZE_SETTLE_MS = 200;

/** Settle delay for scroll coalescing, which has no fixed debounce default. */
const SCROLL_SETTLE_MS = 250;

/** Settle delay for `requestRender()` coalescing, which runs on the scheduler alone. */
const REQUEST_RENDER_SETTLE_MS = 150;

/** Viewport used for repeatable headless measurements. */
const VIEWPORT = Object.freeze({ height: 720, width: 1280 });

/**
 * Scenarios whose only meaningful signal is coalescing evidence: their
 * `durationMs` would otherwise report the fixed post-burst settle wait
 * (a synchronization mechanism) rather than Tracker processing time.
 */
const BURST_SCENARIOS = new Set(['mutation-burst', 'resize-burst', 'scroll-burst', 'request-render-burst']);

/**
 * Scenarios where benchmark-owned source mutation (element creation/removal,
 * style writes) used to run inside the timed boundary alongside Tracker's own
 * processing.
 */
const SOURCE_MUTATION_SCENARIOS = new Set([
  'source-add-small',
  'source-add-large',
  'source-remove-small',
  'source-remove-large',
  'geometry-change',
]);

/** Cases whose measured boundary was unchanged by the earlier pass; see {@link getMeasurementVersion}. */
const BASELINE_MEASUREMENT_VERSION = 2;

/** Cases whose measured boundary already changed once before; see {@link getMeasurementVersion}. */
const REVISED_MEASUREMENT_VERSION = 3;

/**
 * Returns the measurement version for a case, so before/after reports whose
 * measured boundary changed are never treated as directly comparable.
 *
 * Both tiers were bumped by one in the current pass, because every case in
 * this profile changed what it publishes: durations are now aggregated with
 * the shared min/median/max summary instead of a bespoke min/mean/max object,
 * the coalescing ratio is the median across the timed samples instead of the
 * last sample's value, and the render and coalescing counters left
 * `assertions` for `diagnostics`, so comparability itself now means something
 * different. The two tiers are kept apart because they still describe
 * different histories: `REVISED_MEASUREMENT_VERSION` marks the cases whose
 * timed boundary had already been narrowed in the earlier pass (source
 * mutation moved out of the timer; burst scenarios stopped reporting the
 * settle wait as processing time).
 *
 * @param {string} scenario - Scenario name.
 * @returns {number} Positive integer measurement version.
 */
function getMeasurementVersion(scenario) {
  return BURST_SCENARIOS.has(scenario) || SOURCE_MUTATION_SCENARIOS.has(scenario)
    ? REVISED_MEASUREMENT_VERSION
    : BASELINE_MEASUREMENT_VERSION;
}

/** Every scenario measured across the full workload matrix. */
const SCENARIOS = Object.freeze([
  'initial-mount',
  'repeated-render',
  'source-add-small',
  'source-add-large',
  'source-remove-small',
  'source-remove-large',
  'geometry-change',
  'scroll-element',
  'scroll-page',
  'presentation-only-update',
  'mutation-burst',
  'resize-burst',
  'scroll-burst',
  'request-render-burst',
]);

/**
 * Runs one scenario against a fresh Tracker instance inside the page.
 *
 * Self-contained by necessity: Playwright serializes this function and
 * executes it in the browser realm, so it cannot close over anything from
 * the Node-side module scope.
 *
 * @param {{ scenario: string, size: number }} args - Scenario name and source-element workload size.
 * @returns {Promise<Record<string, unknown>>} Scenario measurement.
 */
async function runScenarioInBrowser({ scenario, size }) {
  const BURST_COUNT = 20;
  const MUTATION_WAIT_MS = 250;
  const RESIZE_WAIT_MS = 200;
  const SCROLL_WAIT_MS = 250;
  const REQUEST_RENDER_WAIT_MS = 150;

  /**
   * Waits until Core publishes exactly its next `sync:end` event.
   *
   * @param {InstanceType<typeof window.RXTTracker>} tracker - Active Tracker.
   * @returns {Promise<void>} Resolves on the next render completion.
   */
  function waitForSyncEnd(tracker) {
    return new Promise((resolveWait) => {
      const unsubscribe = tracker.on('sync:end', () => {
        unsubscribe();
        resolveWait();
      });
    });
  }

  /**
   * Times a synchronous action, optionally awaiting the render it triggers.
   *
   * @param {() => void} action - Action to time.
   * @param {InstanceType<typeof window.RXTTracker>|null} tracker - Tracker whose `sync:end` to await, or `null`.
   * @returns {Promise<number>} Duration in milliseconds.
   */
  async function measureAction(action, tracker) {
    const syncCompletion = tracker === null ? null : waitForSyncEnd(tracker);
    const startedAt = performance.now();

    action();
    if (syncCompletion !== null) {
      await syncCompletion;
    }

    return performance.now() - startedAt;
  }

  /**
   * Appends normal-flow probe elements, letting real layout determine geometry.
   *
   * @param {HTMLElement} root - Destination root.
   * @param {number} count - Element count.
   * @param {number} [offset] - Index offset used for `data-benchmark-index`.
   * @returns {HTMLElement[]} Created elements.
   */
  function createSourceElements(root, count, offset = 0) {
    const elements = [];

    for (let index = 0; index < count; index += 1) {
      const element = document.createElement('div');

      element.className = 'core-browser-probe';
      element.dataset.benchmarkIndex = String(offset + index);
      element.style.cssText = 'height: 12px; margin-block-end: 6px;';
      root.append(element);
      elements.push(element);
    }

    return elements;
  }

  /**
   * Builds the disabled-updates option block with at most one observer enabled.
   *
   * @param {'mutation'|'resize'|'scroll'|null} enabledObserver - Observer to enable, or `null`.
   * @returns {Record<string, unknown>} Updates option block.
   */
  function createUpdatesOptions(enabledObserver) {
    return {
      interval: { enabled: false },
      mutation: { enabled: enabledObserver === 'mutation' },
      resize: { enabled: enabledObserver === 'resize' },
      scroll: { enabled: enabledObserver === 'scroll' },
    };
  }

  const needsScrollObserver =
    scenario === 'scroll-element' || scenario === 'scroll-page' || scenario === 'scroll-burst';
  const needsElementScrollRoot = scenario === 'scroll-element' || scenario === 'scroll-burst';
  const sourceRoot = document.createElement('main');
  const renderHost = document.createElement('div');
  let scrollRootElement;

  sourceRoot.className = 'core-browser-source';
  renderHost.className = 'core-browser-render-host';

  if (needsElementScrollRoot) {
    scrollRootElement = document.createElement('div');
    scrollRootElement.className = 'core-browser-scroll-root';
    scrollRootElement.style.cssText = 'position: relative; height: 300px; overflow-y: auto;';
    scrollRootElement.append(sourceRoot, renderHost);
    document.body.replaceChildren(scrollRootElement);
  } else {
    document.body.replaceChildren(sourceRoot, renderHost);
  }

  const elements = createSourceElements(sourceRoot, size);
  const enabledObserver =
    scenario === 'mutation-burst'
      ? 'mutation'
      : scenario === 'resize-burst'
        ? 'resize'
        : needsScrollObserver
          ? 'scroll'
          : null;
  const tracker = new window.RXTTracker({
    options: {
      clustering: { enabled: false },
      updates: createUpdatesOptions(enabledObserver),
    },
    rules: [{ selector: '.core-browser-probe' }],
  });
  const mountRequest = needsElementScrollRoot
    ? { renderHost, scrollRoot: scrollRootElement, sourceRoot }
    : { renderHost, sourceRoot };

  let durationMs = 0;
  let statsBefore = null;
  let statsAfter = null;
  let rawTriggerCount = null;

  // `mount()` itself performs one full render as part of the mount cycle, so
  // scenarios that only need a mounted baseline never call `render()` again.
  const mountStartedAt = performance.now();

  tracker.mount(mountRequest);

  const mountDurationMs = performance.now() - mountStartedAt;

  if (tracker.root === null || tracker.mounted !== true) {
    throw new Error(`Scenario "${scenario}" failed to mount Tracker.`);
  }

  switch (scenario) {
    case 'initial-mount': {
      durationMs = mountDurationMs;
      break;
    }

    case 'repeated-render': {
      tracker.resetStats();
      durationMs = await measureAction(() => {
        tracker.render();
      }, tracker);
      break;
    }

    case 'source-add-small':
    case 'source-add-large': {
      const fraction = scenario === 'source-add-small' ? 0.1 : 1;
      const addCount = Math.max(1, Math.round(size * fraction));

      // Benchmark-owned DOM creation happens before the timer: the intended
      // boundary is Tracker's processing of an already-changed source, not
      // the cost of constructing the new elements themselves.
      createSourceElements(sourceRoot, addCount, size);
      tracker.resetStats();
      durationMs = await measureAction(() => {
        tracker.requestRender();
      }, tracker);

      const snapshot = tracker.getSnapshot();

      if (snapshot.items.length !== size + addCount) {
        throw new Error(
          `Scenario "${scenario}" published ${String(snapshot.items.length)} items, expected ${String(size + addCount)}.`,
        );
      }

      break;
    }

    case 'source-remove-small':
    case 'source-remove-large': {
      const fraction = scenario === 'source-remove-small' ? 0.1 : 0.5;
      const removeCount = Math.max(1, Math.min(size - 1, Math.round(size * fraction)));

      // Removal happens before the timer for the same reason as source-add.
      elements.slice(0, removeCount).forEach((element) => {
        element.remove();
      });
      tracker.resetStats();
      durationMs = await measureAction(() => {
        tracker.requestRender();
      }, tracker);

      const snapshot = tracker.getSnapshot();

      if (snapshot.items.length !== size - removeCount) {
        throw new Error(
          `Scenario "${scenario}" published ${String(snapshot.items.length)} items, expected ${String(size - removeCount)}.`,
        );
      }

      break;
    }

    case 'geometry-change': {
      // Style writes happen before the timer for the same reason as source-add.
      elements.forEach((element, index) => {
        element.style.height = `${String(12 + (index % 5))}px`;
      });
      tracker.resetStats();
      durationMs = await measureAction(() => {
        tracker.requestRender();
      }, tracker);
      break;
    }

    case 'scroll-element': {
      tracker.resetStats();
      durationMs = await measureAction(() => {
        scrollRootElement.scrollTop = Math.min(200, scrollRootElement.scrollHeight);
      }, tracker);
      break;
    }

    case 'scroll-page': {
      tracker.resetStats();
      durationMs = await measureAction(() => {
        window.scrollTo(0, 200);
      }, tracker);
      break;
    }

    case 'presentation-only-update': {
      tracker.resetStats();
      durationMs = await measureAction(() => {
        tracker.patchOptions({ marker: { title: false } });
      }, tracker);

      const stats = tracker.getStats();

      if (stats.lastRender?.target !== 'marker-presentation') {
        throw new Error('Presentation-only update did not use the marker-presentation render target.');
      }

      break;
    }

    case 'mutation-burst': {
      statsBefore = tracker.getStats();
      rawTriggerCount = BURST_COUNT;

      for (let index = 0; index < BURST_COUNT; index += 1) {
        // Core's default mutation-observer config watches childList/subtree only
        // (attributes: false), so the burst must add real child nodes to be seen.
        const marker = document.createElement('span');

        elements[index % elements.length].append(marker);
      }

      // The wait below is a synchronization mechanism only: it lets the
      // debounced observer settle before the after-snapshot. It is not part
      // of the reported duration.
      await new Promise((resolveSettle) => {
        setTimeout(resolveSettle, MUTATION_WAIT_MS);
      });
      statsAfter = tracker.getStats();
      break;
    }

    case 'resize-burst': {
      // Core's `observe()` call during mount can queue an initial
      // ResizeObserver delivery. Let it settle before the baseline snapshot
      // so it isn't misattributed to the burst below.
      await new Promise((resolveSettle) => {
        setTimeout(resolveSettle, RESIZE_WAIT_MS);
      });

      const baselinePaddingPx = Number.parseFloat(getComputedStyle(sourceRoot).paddingLeft) || 0;

      statsBefore = tracker.getStats();
      rawTriggerCount = BURST_COUNT;

      // Monotonically increasing padding (rather than toggling between two
      // values) guarantees the final effective box state genuinely differs
      // from baseline, instead of an even trigger count landing back on it.
      for (let index = 0; index < BURST_COUNT; index += 1) {
        sourceRoot.style.paddingLeft = `${String(baselinePaddingPx + index + 1)}px`;
      }

      await new Promise((resolveSettle) => {
        setTimeout(resolveSettle, RESIZE_WAIT_MS);
      });
      statsAfter = tracker.getStats();

      const settledPaddingPx = Number.parseFloat(getComputedStyle(sourceRoot).paddingLeft);

      if (settledPaddingPx === baselinePaddingPx) {
        throw new Error('Resize-burst scenario ended at the same effective box state as its baseline.');
      }

      break;
    }

    case 'scroll-burst': {
      statsBefore = tracker.getStats();
      rawTriggerCount = BURST_COUNT;

      for (let index = 0; index < BURST_COUNT; index += 1) {
        scrollRootElement.scrollTop = index * 4;
      }

      await new Promise((resolveSettle) => {
        setTimeout(resolveSettle, SCROLL_WAIT_MS);
      });
      statsAfter = tracker.getStats();
      break;
    }

    case 'request-render-burst': {
      statsBefore = tracker.getStats();
      rawTriggerCount = BURST_COUNT;

      for (let index = 0; index < BURST_COUNT; index += 1) {
        tracker.requestRender();
      }

      await new Promise((resolveSettle) => {
        setTimeout(resolveSettle, REQUEST_RENDER_WAIT_MS);
      });
      statsAfter = tracker.getStats();
      break;
    }

    default: {
      throw new Error(`Unknown scenario "${scenario}".`);
    }
  }

  const finalSnapshot = tracker.getSnapshot();
  const finalStats = tracker.getStats();

  tracker.destroy();
  scrollRootElement?.remove();
  sourceRoot.remove();
  renderHost.remove();

  let coalescing = null;

  if (statsBefore !== null && statsAfter !== null) {
    const completedDelta = statsAfter.renders.completed - statsBefore.renders.completed;
    const requestedDelta = statsAfter.renders.requested - statsBefore.renders.requested;

    // A burst that produced zero completed renders is a functionally broken
    // sample, not a good coalescing ratio: fail it instead of letting
    // `rawTriggerCount / Math.max(1, 0)` publish a misleadingly clean number.
    if (completedDelta < 1) {
      throw new Error(
        `Scenario "${scenario}" burst produced no completed render (rawTriggerCount=${String(rawTriggerCount)}, completedDelta=${String(completedDelta)}).`,
      );
    }

    coalescing = { coalescingRatio: rawTriggerCount / completedDelta, completedDelta, rawTriggerCount, requestedDelta };
  }

  const isBurstScenario =
    scenario === 'mutation-burst' ||
    scenario === 'resize-burst' ||
    scenario === 'scroll-burst' ||
    scenario === 'request-render-burst';

  return {
    coalescing,
    // Burst `durationMs` would otherwise report the fixed settle wait above,
    // not Tracker processing time, so it is never reported for these scenarios.
    durationMs: isBurstScenario ? null : durationMs,
    itemCount: finalSnapshot.items.length,
    renders: finalStats.renders,
    scenario,
    size,
  };
}

/**
 * Runs warm-up and timed samples for one scenario/size cell.
 *
 * Every sample builds its own source DOM, mounts a fresh Tracker and destroys
 * it again, so each timed sample starts from an equivalent precondition and no
 * trigger is ever repeated against state a previous sample already mutated. No
 * additional reset step is needed, and a warm-up sample leaves the page in the
 * same phase the first timed sample starts in.
 *
 * @param {import('playwright').Page} page - Active benchmark page.
 * @param {string} scenario - Scenario name.
 * @param {number} size - Source-element workload size.
 * @returns {Promise<Record<string, unknown>>} Aggregated scenario result.
 */
async function runScenarioForSize(page, scenario, size) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    await page.evaluate(runScenarioInBrowser, { scenario, size });
  }

  const samples = [];

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    samples.push(await page.evaluate(runScenarioInBrowser, { scenario, size }));
  }

  if (samples.some((sample) => sample.itemCount !== samples[0].itemCount)) {
    throw new Error(
      `Scenario "${scenario}" published different item counts across its samples at size ${String(size)}.`,
    );
  }

  const coalescing = BURST_SCENARIOS.has(scenario)
    ? {
        coalescingRatio: median(samples.map((sample) => sample.coalescing.coalescingRatio)),
        completedDelta: samples.map((sample) => sample.coalescing.completedDelta),
        rawTriggerCount: samples.map((sample) => sample.coalescing.rawTriggerCount),
        requestedDelta: samples.map((sample) => sample.coalescing.requestedDelta),
      }
    : null;

  return {
    coalescing,
    durationMs: BURST_SCENARIOS.has(scenario) ? null : summarizeDurations(samples.map((sample) => sample.durationMs)),
    itemCount: samples[0].itemCount,
    renders: samples.map((sample) => sample.renders),
    scenario,
    size,
  };
}

/**
 * Converts one browser workload row into the shared report schema.
 *
 * `assertions` keep only the published item count: the semantic outcome of the
 * scenario. Scheduler counters and the raw coalescing tallies are per-sample
 * `diagnostics`, so a scenario that starts requesting or completing more
 * renders stays a comparable, visible number instead of invalidating the case.
 *
 * @param {Record<string, unknown>} result - Aggregated scenario result.
 * @returns {Record<string, unknown>} Report result row.
 */
function createReportResult(result) {
  const { coalescing } = result;

  return {
    assertions: { itemCount: result.itemCount },
    caseId: `${result.scenario}/${String(result.size)}`,
    diagnostics: {
      ...(coalescing === null
        ? {}
        : {
            coalescing: {
              completedDelta: coalescing.completedDelta,
              rawTriggerCount: coalescing.rawTriggerCount,
              requestedDelta: coalescing.requestedDelta,
            },
          }),
      renders: result.renders,
    },
    dimensions: {
      itemCount: result.size,
      scenario: result.scenario,
    },
    measurementVersion: getMeasurementVersion(result.scenario),
    metrics: {
      ...(coalescing === null ? {} : { coalescingRatio: coalescing.coalescingRatio }),
      ...(result.durationMs === null ? {} : { durationMs: result.durationMs }),
    },
  };
}

console.log('Running core-render-browser...');

/** Local server exposing the production Vanilla package build. */
const server = await startStaticServer();

/** Headless browser used for real DOM, layout, and scheduler measurements. */
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: VIEWPORT });

  await page.goto(`${server.origin}/benchmark.html`);
  await page.addScriptTag({ url: `${server.origin}/packages/vanilla/dist/rxt-tracker-vanilla.js` });

  const results = [];

  for (const size of WORKLOAD_SIZES) {
    for (const scenario of SCENARIOS) {
      results.push(await runScenarioForSize(page, scenario, size));
    }
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
      burstDurationScope:
        'Burst scenarios report only coalescing evidence, never durationMs: the fixed settle wait after each burst is a synchronization mechanism for reading a stable getStats() snapshot, not Tracker processing time.',
      burstTriggerCount: BURST_TRIGGER_COUNT,
      coalescingScope:
        "mutation-burst/resize-burst/scroll-burst/request-render-burst enable exactly one observer (or none, for request-render-burst) and perform BURST_TRIGGER_COUNT rapid triggers, then settle past Core's known debounce window before reading getStats().renders. coalescingRatio = rawTriggerCount / completedDelta is computed per sample and published as the median across the timed samples. A sample where no render completed (completedDelta < 1) fails the run instead of publishing a ratio.",
      coalescingSemantics:
        "request-render-burst measures Core's own scheduler coalescing, because the burst calls requestRender() directly. mutation-burst, resize-burst and scroll-burst measure end-to-end collapse instead: the browser may already coalesce MutationObserver, ResizeObserver and scroll delivery before Core sees anything, so rawTriggerCount is the benchmark's own trigger count and is not the number of notifications Core received. The ratio therefore describes how many benchmark-side triggers one completed render absorbed, not how many Core-side notifications were debounced.",
      observerScope:
        'Every non-burst scenario mounts with all update observers disabled and drives its own change via requestRender()/render(), isolating pipeline+DOM-write cost from observer debounce latency. For source-add/source-remove/geometry-change, benchmark-owned source mutation (element creation/removal, style writes) runs before the timer; only the subsequent requestRender()/completion is timed.',
      sampleCount: SAMPLE_COUNT,
      precondition:
        'Every timed sample builds its own source DOM, mounts a fresh Tracker and destroys it again, so each sample starts from an equivalent precondition and no trigger is repeated against progressively mutated state. Warm-up samples are complete discarded runs of the same shape.',
      reportSemantics:
        'assertions hold the published item count only. Scheduler render counters and the raw coalescing tallies are per-sample diagnostics and gate nothing, so a change in how much work a scenario performs stays comparable instead of invalidating the case.',
      smoke: arguments_.smoke,
      settleDelaysMs: {
        mutation: MUTATION_SETTLE_MS,
        requestRender: REQUEST_RENDER_SETTLE_MS,
        resize: RESIZE_SETTLE_MS,
        scroll: SCROLL_SETTLE_MS,
      },
      thresholds: 'None. Durations are reported for trend comparison only; no pass/fail budget is enforced.',
      warmupCount: WARMUP_COUNT,
      workloadSizes: WORKLOAD_SIZES,
    },
    results: results.map(createReportResult),
  };
  const savedReport = await writeBenchmarkReports('core-render-browser', report, arguments_);

  results.forEach((result) => {
    const coalescingSuffix =
      result.coalescing === null
        ? ''
        : `median coalescing ratio ${result.coalescing.coalescingRatio.toFixed(2)} (triggers ${result.coalescing.rawTriggerCount.join('/')} -> completed ${result.coalescing.completedDelta.join('/')})`;
    const durationPrefix = result.durationMs === null ? '' : `median ${result.durationMs.medianMs.toFixed(2)} ms`;
    const summary = [durationPrefix, coalescingSuffix].filter((part) => part !== '').join(', ');

    console.log(`${result.size.toLocaleString('en-US')} elements, ${result.scenario}: ${summary}`);
  });
  console.log(`Report: ${savedReport.json}`);
  console.log(`Report: ${savedReport.csv}`);
} finally {
  await browser.close();
  await server.close();
}
