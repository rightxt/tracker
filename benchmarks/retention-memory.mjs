/* eslint-disable no-console -- Command-line benchmark reports its progress and output paths. */

import process from 'node:process';
import { JSDOM } from 'jsdom';
import { parseBenchmarkArguments } from './lib/cli.mjs';
import { collectBenchmarkEnvironment } from './lib/environment.mjs';
import { writeBenchmarkReports } from './lib/reporting.mjs';
import { getBenchmarkProfile } from './profiles.mjs';

/** Parsed command-line options for this benchmark invocation. */
const arguments_ = parseBenchmarkArguments(process.argv.slice(2));

/** Canonical profile metadata used for report provenance. */
const profile = getBenchmarkProfile('retention-memory');

/** Number of forced-GC turns used for each baseline/post-cycle heap observation. */
const GC_ATTEMPTS = arguments_.smoke ? 5 : 20;

/** Cycles repeated within every scenario; the independent variable for retention pressure. */
const CYCLE_COUNT = arguments_.smoke ? 3 : 60;

/** Fixed source-element workload per cycle; item count is not the independent variable here. */
const ELEMENT_COUNT = arguments_.smoke ? 25 : 1000;

/** Selector used for every synthetic source element. */
const PROBE_SELECTOR = '.retention-probe';

/** Class name applied to every synthetic source element. */
const PROBE_CLASS_NAME = 'retention-probe';

/**
 * Measurement version for scenarios whose retention checkpoint is unchanged
 * (destroy()/unmount() every cycle), bumped because `metrics` now publishes
 * only `retainedDeltaBytes`. The delta's formula is unchanged; the set of
 * comparable numbers is not, so earlier reports are not like-for-like.
 */
const RETENTION_MEASUREMENT_VERSION = 2;

/**
 * Measurement version for persistent-runtime scenarios (source replacement,
 * projection-generation replacement, subscribe/unsubscribe). Version 2 added
 * verification that retired objects are collectible while the integration is
 * still mounted; version 3 reduces `metrics` to `retainedDeltaBytes` alone.
 */
const PERSISTENT_RETENTION_MEASUREMENT_VERSION = 3;

/** Disables every auto-triggered observer so scenarios stay deterministic and rAF-free. */
const DISABLED_UPDATES = Object.freeze({
  interval: { enabled: false },
  mutation: { enabled: false },
  resize: { enabled: false },
  scroll: { enabled: false },
});

/**
 * Installs jsdom globals so Core's compiled dist code can run in Node.
 *
 * @param {JSDOM} dom - jsdom instance backing the retention experiment.
 * @returns {void}
 */
function installDomGlobals(dom) {
  Object.assign(globalThis, {
    CSSStyleSheet: dom.window.CSSStyleSheet,
    CustomEvent: dom.window.CustomEvent,
    Document: dom.window.Document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    ShadowRoot: dom.window.ShadowRoot,
    document: dom.window.document,
    window: dom.window,
  });
}

/**
 * Gives V8 repeated full-GC opportunities separated by macrotasks.
 *
 * @returns {Promise<void>}
 */
async function runGcCycles() {
  for (let attempt = 0; attempt < GC_ATTEMPTS; attempt += 1) {
    globalThis.gc();
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 0);
    });
  }
}

/**
 * Busts jsdom's nwsapi selector cache, which otherwise makes retired elements
 * look retained until the next query following a DOM mutation.
 *
 * @returns {void}
 */
function bustSelectorCache() {
  document.querySelectorAll(PROBE_SELECTOR);
}

/**
 * Forces GC and reads V8 heap usage.
 *
 * @returns {Promise<number>} `process.memoryUsage().heapUsed` after forced GC.
 */
async function measureHeapAfterGc() {
  bustSelectorCache();
  await runGcCycles();
  return process.memoryUsage().heapUsed;
}

/**
 * Forces GC while a persistent integration is still mounted and confirms both
 * tracked canaries are already collectible before destroy() runs. Additive to
 * the existing post-destroy check: it catches a defect where a runtime holds
 * onto retired objects until final teardown instead of releasing them as soon
 * as they are genuinely retired (superseded source elements, superseded
 * projection generations, or unsubscribed listeners) while still mounted.
 *
 * @param {string} scenarioName - Scenario identifier used in the failure message.
 * @param {WeakRef<object>} firstCanary - Canary for the first retired object.
 * @param {WeakRef<object>} lastCanary - Canary for the last retired object.
 * @returns {Promise<{ firstCycleCollectedBeforeDestroy: boolean, lastCycleCollectedBeforeDestroy: boolean }>} Pre-destroy collection evidence.
 */
async function assertRetiredBeforeDestroy(scenarioName, firstCanary, lastCanary) {
  await measureHeapAfterGc();

  const firstCycleCollectedBeforeDestroy = firstCanary.deref() === undefined;
  const lastCycleCollectedBeforeDestroy = lastCanary.deref() === undefined;

  if (!firstCycleCollectedBeforeDestroy || !lastCycleCollectedBeforeDestroy) {
    throw new Error(
      `Scenario "${scenarioName}" retained retired objects while the integration was still mounted, before destroy().`,
    );
  }

  return { firstCycleCollectedBeforeDestroy, lastCycleCollectedBeforeDestroy };
}

/**
 * Creates detached synthetic source elements matching {@link PROBE_SELECTOR}.
 *
 * @param {number} count - Element count.
 * @returns {HTMLElement[]} Created elements.
 */
function createProbeElements(count) {
  const elements = [];

  for (let index = 0; index < count; index += 1) {
    const element = document.createElement('div');

    element.className = PROBE_CLASS_NAME;
    elements.push(element);
  }

  return elements;
}

/**
 * Appends elements to a root in document order.
 *
 * @param {HTMLElement} root - Destination root.
 * @param {HTMLElement[]} elements - Elements to append.
 * @returns {void}
 */
function appendElements(root, elements) {
  elements.forEach((element) => {
    root.append(element);
  });
}

/**
 * Runs a single mount → render → unmount cycle against a fresh integration.
 *
 * Isolated into its own call frame (rather than inlined in the caller's loop
 * body) so the cycle's locals are not reachable from the loop scope once this
 * function returns — inlining them directly in a `for` loop at module top
 * level otherwise leaves the *last* iteration's locals artificially reachable
 * through forced GC cycles run after the loop completes.
 *
 * @param {Function} createIntegration - `createTrackerProjectionIntegration`.
 * @param {number} cycle - Zero-based cycle index, used only for the cycle-0 precondition check.
 * @returns {WeakRef<HTMLElement>} Canary for the cycle's first source element.
 */
function runMountRenderUnmountCycle(createIntegration, cycle) {
  const sourceRoot = document.createElement('main');
  const renderRoot = document.createElement('div');
  const elements = createProbeElements(ELEMENT_COUNT);

  appendElements(sourceRoot, elements);
  document.body.append(sourceRoot, renderRoot);

  const integration = createIntegration({
    options: { clustering: { enabled: false }, updates: DISABLED_UPDATES },
    rules: [{ selector: PROBE_SELECTOR }],
  });

  integration.mount({ renderRoot, sourceRoot });
  integration.render();

  if (cycle === 0 && integration.getProjection().items.length !== ELEMENT_COUNT) {
    throw new Error(
      `Scenario "mount-render-unmount" published ${String(integration.getProjection().items.length)} items, expected ${String(ELEMENT_COUNT)}.`,
    );
  }

  integration.unmount();
  sourceRoot.remove();
  renderRoot.remove();
  bustSelectorCache();

  return new WeakRef(elements[0]);
}

/**
 * Runs repeated mount → render → unmount cycles against fresh integrations,
 * tracking whether the DOM subtree of the first and last cycle becomes
 * collectible once every local reference is dropped.
 *
 * @param {Function} createIntegration - `createTrackerProjectionIntegration`.
 * @returns {Promise<Record<string, unknown>>} Scenario result.
 */
async function runMountRenderUnmountScenario(createIntegration) {
  const baselineHeapBytes = await measureHeapAfterGc();
  const heapSamples = [];
  let firstCanary = null;
  let lastCanary = null;

  for (let cycle = 0; cycle < CYCLE_COUNT; cycle += 1) {
    const canary = runMountRenderUnmountCycle(createIntegration, cycle);

    if (cycle === 0) {
      firstCanary = canary;
    }

    if (cycle === CYCLE_COUNT - 1) {
      lastCanary = canary;
    }

    heapSamples.push(process.memoryUsage().heapUsed);
  }

  const postGcHeapBytes = await measureHeapAfterGc();
  const firstCycleCollected = firstCanary.deref() === undefined;
  const lastCycleCollected = lastCanary.deref() === undefined;

  if (!firstCycleCollected || !lastCycleCollected) {
    throw new Error('Scenario "mount-render-unmount" retained source elements after unmount without destroy().');
  }

  return {
    baselineHeapBytes,
    cycles: CYCLE_COUNT,
    elementCount: ELEMENT_COUNT,
    firstCycleCollected,
    lastCycleCollected,
    measurementVersion: RETENTION_MEASUREMENT_VERSION,
    peakHeapBytes: Math.max(...heapSamples),
    postGcHeapBytes,
    retainedDeltaBytes: postGcHeapBytes - baselineHeapBytes,
    scenario: 'mount-render-unmount',
  };
}

/**
 * Runs a single mount → render → destroy cycle against a fresh integration.
 *
 * Isolated into its own call frame for the same reason as
 * {@link runMountRenderUnmountCycle}.
 *
 * @param {Function} createIntegration - `createTrackerProjectionIntegration`.
 * @param {number} cycle - Zero-based cycle index, used only for the cycle-0 precondition check.
 * @returns {WeakRef<HTMLElement>} Canary for the cycle's first source element.
 */
function runMountRenderDestroyCycle(createIntegration, cycle) {
  const sourceRoot = document.createElement('main');
  const renderRoot = document.createElement('div');
  const elements = createProbeElements(ELEMENT_COUNT);

  appendElements(sourceRoot, elements);
  document.body.append(sourceRoot, renderRoot);

  const integration = createIntegration({
    options: { clustering: { enabled: false }, updates: DISABLED_UPDATES },
    rules: [{ selector: PROBE_SELECTOR }],
  });

  integration.mount({ renderRoot, sourceRoot });
  integration.render();

  if (cycle === 0 && integration.getProjection().items.length !== ELEMENT_COUNT) {
    throw new Error(
      `Scenario "mount-render-destroy" published ${String(integration.getProjection().items.length)} items, expected ${String(ELEMENT_COUNT)}.`,
    );
  }

  integration.destroy();
  sourceRoot.remove();
  renderRoot.remove();
  bustSelectorCache();

  return new WeakRef(elements[0]);
}

/**
 * Runs repeated mount → render → destroy cycles against fresh integrations,
 * exercising the explicit teardown path instead of unmount().
 *
 * @param {Function} createIntegration - `createTrackerProjectionIntegration`.
 * @returns {Promise<Record<string, unknown>>} Scenario result.
 */
async function runMountRenderDestroyScenario(createIntegration) {
  const baselineHeapBytes = await measureHeapAfterGc();
  const heapSamples = [];
  let firstCanary = null;
  let lastCanary = null;

  for (let cycle = 0; cycle < CYCLE_COUNT; cycle += 1) {
    const canary = runMountRenderDestroyCycle(createIntegration, cycle);

    if (cycle === 0) {
      firstCanary = canary;
    }

    if (cycle === CYCLE_COUNT - 1) {
      lastCanary = canary;
    }

    heapSamples.push(process.memoryUsage().heapUsed);
  }

  const postGcHeapBytes = await measureHeapAfterGc();
  const firstCycleCollected = firstCanary.deref() === undefined;
  const lastCycleCollected = lastCanary.deref() === undefined;

  if (!firstCycleCollected || !lastCycleCollected) {
    throw new Error('Scenario "mount-render-destroy" retained source elements after destroy().');
  }

  return {
    baselineHeapBytes,
    cycles: CYCLE_COUNT,
    elementCount: ELEMENT_COUNT,
    firstCycleCollected,
    lastCycleCollected,
    measurementVersion: RETENTION_MEASUREMENT_VERSION,
    peakHeapBytes: Math.max(...heapSamples),
    postGcHeapBytes,
    retainedDeltaBytes: postGcHeapBytes - baselineHeapBytes,
    scenario: 'mount-render-destroy',
  };
}

/**
 * Retires the current source elements and replaces them with a fresh batch,
 * isolated into its own call frame for the same reason as
 * {@link runMountRenderUnmountCycle}.
 *
 * @param {HTMLElement} sourceRoot - Persistent source root.
 * @param {Record<string, Function>} integration - Persistent projection integration.
 * @param {HTMLElement[]} elements - Currently-mounted source elements, about to be retired.
 * @returns {{ canary: WeakRef<HTMLElement>, elements: HTMLElement[] }} Canary for the retired batch's first element, plus the newly mounted batch.
 */
function runSourceReplacementCycle(sourceRoot, integration, elements) {
  const retiredElements = elements;

  retiredElements.forEach((element) => {
    element.remove();
  });

  const nextElements = createProbeElements(ELEMENT_COUNT);

  appendElements(sourceRoot, nextElements);
  integration.render();

  return { canary: new WeakRef(retiredElements[0]), elements: nextElements };
}

/**
 * Mounts once, then repeatedly replaces the entire source subtree in place
 * (no unmount), verifying retired source elements become collectible after
 * each replacement.
 *
 * @param {Function} createIntegration - `createTrackerProjectionIntegration`.
 * @returns {Promise<Record<string, unknown>>} Scenario result.
 */
async function runSourceReplacementScenario(createIntegration) {
  const sourceRoot = document.createElement('main');
  const renderRoot = document.createElement('div');

  document.body.append(sourceRoot, renderRoot);

  const integration = createIntegration({
    options: { clustering: { enabled: false }, updates: DISABLED_UPDATES },
    rules: [{ selector: PROBE_SELECTOR }],
  });

  let elements = createProbeElements(ELEMENT_COUNT);

  appendElements(sourceRoot, elements);
  integration.mount({ renderRoot, sourceRoot });
  integration.render();

  if (integration.getProjection().items.length !== ELEMENT_COUNT) {
    throw new Error(
      `Scenario "source-replacement" published ${String(integration.getProjection().items.length)} items, expected ${String(ELEMENT_COUNT)}.`,
    );
  }

  const baselineHeapBytes = await measureHeapAfterGc();
  const heapSamples = [];
  let firstCanary = null;
  let lastCanary = null;

  for (let cycle = 0; cycle < CYCLE_COUNT; cycle += 1) {
    const cycleResult = runSourceReplacementCycle(sourceRoot, integration, elements);

    elements = cycleResult.elements;

    if (cycle === 0) {
      firstCanary = cycleResult.canary;
    }

    if (cycle === CYCLE_COUNT - 1) {
      lastCanary = cycleResult.canary;
    }

    heapSamples.push(process.memoryUsage().heapUsed);
  }

  if (integration.getProjection().items.length !== ELEMENT_COUNT) {
    throw new Error(
      `Scenario "source-replacement" published ${String(integration.getProjection().items.length)} items after replacement, expected ${String(ELEMENT_COUNT)}.`,
    );
  }

  const preDestroyEvidence = await assertRetiredBeforeDestroy('source-replacement', firstCanary, lastCanary);

  integration.destroy();
  sourceRoot.remove();
  renderRoot.remove();
  elements = [];

  const postGcHeapBytes = await measureHeapAfterGc();
  const firstCycleCollected = firstCanary.deref() === undefined;
  const lastCycleCollected = lastCanary.deref() === undefined;

  if (!firstCycleCollected || !lastCycleCollected) {
    throw new Error('Scenario "source-replacement" retained retired source elements.');
  }

  return {
    baselineHeapBytes,
    cycles: CYCLE_COUNT,
    elementCount: ELEMENT_COUNT,
    firstCycleCollected,
    firstCycleCollectedBeforeDestroy: preDestroyEvidence.firstCycleCollectedBeforeDestroy,
    lastCycleCollected,
    lastCycleCollectedBeforeDestroy: preDestroyEvidence.lastCycleCollectedBeforeDestroy,
    measurementVersion: PERSISTENT_RETENTION_MEASUREMENT_VERSION,
    peakHeapBytes: Math.max(...heapSamples),
    postGcHeapBytes,
    retainedDeltaBytes: postGcHeapBytes - baselineHeapBytes,
    scenario: 'source-replacement',
  };
}

/**
 * Snapshots the current projection state, then replaces the configuration
 * and re-renders, isolated into its own call frame for the same reason as
 * {@link runMountRenderUnmountCycle}.
 *
 * @param {Record<string, Function>} integration - Persistent projection integration.
 * @returns {WeakRef<Record<string, unknown>>} Canary for the superseded projection state.
 */
function runProjectionGenerationCycle(integration) {
  const retiredProjection = integration.getProjection();
  const canary = new WeakRef(retiredProjection);

  integration.replaceConfiguration({
    options: { clustering: { enabled: false }, updates: DISABLED_UPDATES },
    rules: [{ selector: PROBE_SELECTOR }],
  });
  integration.render();

  return canary;
}

/**
 * Mounts once, then repeatedly calls `replaceConfiguration()` without ever
 * unmounting, verifying each superseded projection-state generation becomes
 * collectible once the renderer commits its successor.
 *
 * @param {Function} createIntegration - `createTrackerProjectionIntegration`.
 * @returns {Promise<Record<string, unknown>>} Scenario result.
 */
async function runProjectionGenerationScenario(createIntegration) {
  const sourceRoot = document.createElement('main');
  const renderRoot = document.createElement('div');
  const elements = createProbeElements(ELEMENT_COUNT);

  appendElements(sourceRoot, elements);
  document.body.append(sourceRoot, renderRoot);

  const integration = createIntegration({
    options: { clustering: { enabled: false }, updates: DISABLED_UPDATES },
    rules: [{ selector: PROBE_SELECTOR }],
  });

  integration.mount({ renderRoot, sourceRoot });
  integration.render();

  if (integration.getProjection().items.length !== ELEMENT_COUNT) {
    throw new Error(
      `Scenario "projection-generation-replacement" published ${String(integration.getProjection().items.length)} items, expected ${String(ELEMENT_COUNT)}.`,
    );
  }

  const baselineHeapBytes = await measureHeapAfterGc();
  const heapSamples = [];
  let firstCanary = null;
  let lastCanary = null;

  for (let cycle = 0; cycle < CYCLE_COUNT; cycle += 1) {
    const canary = runProjectionGenerationCycle(integration);

    if (cycle === 0) {
      firstCanary = canary;
    }

    if (cycle === CYCLE_COUNT - 1) {
      lastCanary = canary;
    }

    heapSamples.push(process.memoryUsage().heapUsed);
  }

  const preDestroyEvidence = await assertRetiredBeforeDestroy(
    'projection-generation-replacement',
    firstCanary,
    lastCanary,
  );

  integration.destroy();
  sourceRoot.remove();
  renderRoot.remove();

  const postGcHeapBytes = await measureHeapAfterGc();
  const firstCycleCollected = firstCanary.deref() === undefined;
  const lastCycleCollected = lastCanary.deref() === undefined;

  if (!firstCycleCollected || !lastCycleCollected) {
    throw new Error('Scenario "projection-generation-replacement" retained a superseded projection state.');
  }

  return {
    baselineHeapBytes,
    cycles: CYCLE_COUNT,
    elementCount: ELEMENT_COUNT,
    firstCycleCollected,
    firstCycleCollectedBeforeDestroy: preDestroyEvidence.firstCycleCollectedBeforeDestroy,
    lastCycleCollected,
    lastCycleCollectedBeforeDestroy: preDestroyEvidence.lastCycleCollectedBeforeDestroy,
    measurementVersion: PERSISTENT_RETENTION_MEASUREMENT_VERSION,
    peakHeapBytes: Math.max(...heapSamples),
    postGcHeapBytes,
    retainedDeltaBytes: postGcHeapBytes - baselineHeapBytes,
    scenario: 'projection-generation-replacement',
  };
}

/**
 * Subscribes a fresh listener closure, renders once, then unsubscribes,
 * isolated into its own call frame for the same reason as
 * {@link runMountRenderUnmountCycle}.
 *
 * @param {Record<string, Function>} integration - Persistent projection integration.
 * @returns {{ canary: WeakRef<Function>, observedCommit: boolean }} Canary for the unsubscribed listener, plus whether it observed a commit.
 */
function runSubscribeUnsubscribeCycle(integration) {
  let observedCommit = false;
  const listener = () => {
    observedCommit = true;
  };
  const canary = new WeakRef(listener);
  const unsubscribe = integration.subscribeProjection(listener);

  integration.render();
  unsubscribe();

  return { canary, observedCommit };
}

/**
 * Mounts once, then repeatedly subscribes and unsubscribes a fresh listener
 * per cycle, verifying unsubscribed listener closures become collectible.
 *
 * @param {Function} createIntegration - `createTrackerProjectionIntegration`.
 * @returns {Promise<Record<string, unknown>>} Scenario result.
 */
async function runSubscribeUnsubscribeScenario(createIntegration) {
  const sourceRoot = document.createElement('main');
  const renderRoot = document.createElement('div');
  const elements = createProbeElements(ELEMENT_COUNT);

  appendElements(sourceRoot, elements);
  document.body.append(sourceRoot, renderRoot);

  const integration = createIntegration({
    options: { clustering: { enabled: false }, updates: DISABLED_UPDATES },
    rules: [{ selector: PROBE_SELECTOR }],
  });

  integration.mount({ renderRoot, sourceRoot });
  integration.render();

  const baselineHeapBytes = await measureHeapAfterGc();
  const heapSamples = [];
  let firstCanary = null;
  let lastCanary = null;
  let firstCycleObservedCommit = false;

  for (let cycle = 0; cycle < CYCLE_COUNT; cycle += 1) {
    const cycleResult = runSubscribeUnsubscribeCycle(integration);

    if (cycle === 0) {
      firstCycleObservedCommit = cycleResult.observedCommit;
      firstCanary = cycleResult.canary;
    }

    if (cycle === CYCLE_COUNT - 1) {
      lastCanary = cycleResult.canary;
    }

    heapSamples.push(process.memoryUsage().heapUsed);
  }

  if (!firstCycleObservedCommit) {
    throw new Error('Scenario "subscribe-unsubscribe" listener never observed a projection commit.');
  }

  const preDestroyEvidence = await assertRetiredBeforeDestroy('subscribe-unsubscribe', firstCanary, lastCanary);

  integration.destroy();
  sourceRoot.remove();
  renderRoot.remove();

  const postGcHeapBytes = await measureHeapAfterGc();
  const firstCycleCollected = firstCanary.deref() === undefined;
  const lastCycleCollected = lastCanary.deref() === undefined;

  if (!firstCycleCollected || !lastCycleCollected) {
    throw new Error('Scenario "subscribe-unsubscribe" retained an unsubscribed listener closure.');
  }

  return {
    baselineHeapBytes,
    cycles: CYCLE_COUNT,
    elementCount: ELEMENT_COUNT,
    firstCycleCollected,
    firstCycleCollectedBeforeDestroy: preDestroyEvidence.firstCycleCollectedBeforeDestroy,
    lastCycleCollected,
    lastCycleCollectedBeforeDestroy: preDestroyEvidence.lastCycleCollectedBeforeDestroy,
    measurementVersion: PERSISTENT_RETENTION_MEASUREMENT_VERSION,
    peakHeapBytes: Math.max(...heapSamples),
    postGcHeapBytes,
    retainedDeltaBytes: postGcHeapBytes - baselineHeapBytes,
    scenario: 'subscribe-unsubscribe',
  };
}

/**
 * Converts one retention workload row into the shared report schema.
 *
 * Only `retainedDeltaBytes` is a comparison metric: it is the difference of two
 * checkpoints taken after the same forced-GC procedure, so both sides of the
 * subtraction were produced under the same conditions. The checkpoints
 * themselves and the raw per-cycle maximum are absolute heap readings taken
 * between uncontrolled collector decisions, so they are evidence for reading a
 * suspicious delta rather than regression numbers, and they are `diagnostics`.
 *
 * @param {Record<string, unknown>} result - One retention scenario row.
 * @returns {Record<string, unknown>} Report result row.
 */
function createReportResult(result) {
  const beforeDestroyAssertions =
    result.firstCycleCollectedBeforeDestroy === undefined
      ? {}
      : {
          firstCycleCollectedBeforeDestroy: result.firstCycleCollectedBeforeDestroy,
          lastCycleCollectedBeforeDestroy: result.lastCycleCollectedBeforeDestroy,
        };

  return {
    assertions: {
      firstCycleCollected: result.firstCycleCollected,
      lastCycleCollected: result.lastCycleCollected,
      ...beforeDestroyAssertions,
    },
    caseId: result.scenario,
    dimensions: {
      cycleCount: result.cycles,
      elementCount: result.elementCount,
      scenario: result.scenario,
    },
    diagnostics: {
      baselineHeapBytes: result.baselineHeapBytes,
      peakHeapBytes: result.peakHeapBytes,
      postGcHeapBytes: result.postGcHeapBytes,
    },
    measurementVersion: result.measurementVersion,
    metrics: { retainedDeltaBytes: result.retainedDeltaBytes },
  };
}

/**
 * Runs every retention scenario against a single jsdom realm and Core's
 * production build.
 *
 * @returns {Promise<Record<string, unknown>>} Complete benchmark report.
 */
async function runBenchmark() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });

  installDomGlobals(dom);

  try {
    const { createTrackerProjectionIntegration } = await import('../packages/core/dist/projection.mjs');
    const results = [
      await runMountRenderUnmountScenario(createTrackerProjectionIntegration),
      await runMountRenderDestroyScenario(createTrackerProjectionIntegration),
      await runSourceReplacementScenario(createTrackerProjectionIntegration),
      await runProjectionGenerationScenario(createTrackerProjectionIntegration),
      await runSubscribeUnsubscribeScenario(createTrackerProjectionIntegration),
    ];

    return {
      environment: await collectBenchmarkEnvironment({
        buildTarget: profile.buildTarget,
        provenance: profile.provenance,
      }),
      methodology: {
        canaryScope:
          'Only the first and last cycle of each scenario are tracked via WeakRef; intermediate cycles are exercised but not individually verified, keeping forced-GC rounds bounded to two per scenario.',
        cycleCount: CYCLE_COUNT,
        elementCount: ELEMENT_COUNT,
        gcAttempts: GC_ATTEMPTS,
        heapMetric:
          'process.memoryUsage().heapUsed. The only comparison metric is retainedDeltaBytes = postGcHeapBytes - baselineHeapBytes, where both checkpoints follow the same GC_ATTEMPTS forced-GC macrotask cycles. baselineHeapBytes, postGcHeapBytes and peakHeapBytes are diagnostics: the first two are absolute readings whose level depends on collector decisions outside the benchmark, and peakHeapBytes is the maximum raw per-cycle sample with no intervening forced GC, so it reflects allocation pressure rather than a collectible-retained size.',
        relationToCheckRetention:
          'Strictly additive to the retention stage of `pnpm packages:verify:dist` (scripts/check-projection-renderer-retention.mjs, scripts/check-promise-retention.mjs), which remains the pass/fail correctness gate; this benchmark repeats the same WeakRef-canary technique over many cycles to also surface heap-growth trends.',
        smoke: arguments_.smoke,
      },
      results: results.map(createReportResult),
    };
  } finally {
    dom.window.close();
  }
}

if (typeof globalThis.gc !== 'function') {
  throw new Error('Run this benchmark with node --expose-gc benchmarks/retention-memory.mjs.');
}

console.log('Running retention-memory...');

/** Complete benchmark report for the requested phase. */
const report = await runBenchmark();

/** Persisted JSON/CSV report pair. */
const savedReport = await writeBenchmarkReports('retention-memory', report, arguments_);

console.log(`Report: ${savedReport.json}`);
console.log(`Report: ${savedReport.csv}`);
