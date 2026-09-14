/* eslint-disable no-console -- Command-line benchmark reports its progress and output paths. */

import process from 'node:process';
import { JSDOM } from 'jsdom';
import { parseBenchmarkArguments } from './lib/cli.mjs';
import { collectBenchmarkEnvironment } from './lib/environment.mjs';
import { writeBenchmarkReports } from './lib/reporting.mjs';
import { summarizeDurations } from './lib/statistics.mjs';
import { createBenchmarkViteServer } from './lib/vite-ssr.mjs';
import { getBenchmarkProfile } from './profiles.mjs';

/** Parsed command-line options for this benchmark invocation. */
const arguments_ = parseBenchmarkArguments(process.argv.slice(2));

/** Canonical profile metadata used for report provenance. */
const profile = getBenchmarkProfile('core-render-pipeline');

/** Representative source-element workload sizes. */
const WORKLOAD_SIZES = Object.freeze(arguments_.smoke ? [25] : [100, 1000, 5000, 10000]);

/** Timed samples retained for each scenario/size cell after warm-up. */
const SAMPLE_COUNT = arguments_.smoke ? 1 : 5;

/** Untimed samples used to warm the active runtime and JIT. */
const WARMUP_COUNT = arguments_.smoke ? 0 : 1;

/** Rule count used by the "large-rule-count" scenario, capped by workload size. */
const LARGE_RULE_COUNT = 50;

/** Class name and selector shared by every plain probe element. */
const PROBE_CLASS_NAME = 'pipeline-probe';
const PROBE_SELECTOR = '.pipeline-probe';

/** Prefix of the per-element text a function label reads back in the function-label scenario. */
const FUNCTION_LABEL_PREFIX = 'pipeline-probe-label-';

/** Vertical spacing and height used to lay out synthetic probe elements. */
const ELEMENT_SPACING = 12;
const ELEMENT_HEIGHT = 10;

/** Disables every auto-triggered observer so scenario timings reflect pipeline cost, not scheduling. */
const DISABLED_UPDATES = Object.freeze({
  interval: { enabled: false },
  mutation: { enabled: false },
  resize: { enabled: false },
  scroll: { enabled: false },
});

/**
 * Installs jsdom globals so Core's realm-safe DOM helpers resolve `document`/`window`.
 *
 * @param {JSDOM} dom - jsdom instance backing the benchmark.
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
 * Installs static document/window geometry so `WindowScrollContext` never bails
 * out on zero content size, mirroring the proven pattern from
 * `packages/core/src/tracker/__tests__/rendererIntegration.contract.test.ts`.
 *
 * @returns {void}
 */
function installDocumentGeometry() {
  Object.defineProperties(document.documentElement, {
    clientHeight: { configurable: true, value: 800 },
    scrollHeight: { configurable: true, value: 500000 },
  });
  Object.defineProperties(document.body, {
    clientHeight: { configurable: true, value: 800 },
    scrollHeight: { configurable: true, value: 500000 },
  });
  Object.defineProperties(window, {
    innerHeight: { configurable: true, value: 800 },
    scrollY: { configurable: true, value: 0 },
  });
}

/**
 * Creates a stable DOMRect-like object used by every probe element.
 *
 * @param {number} top - Rect top offset.
 * @param {number} [height] - Rect height.
 * @returns {DOMRect} Synthetic rect.
 */
function createRect(top, height = ELEMENT_HEIGHT) {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    toJSON: () => ({}),
    top,
    width: 100,
    x: 0,
    y: top,
  };
}

/**
 * Creates one detached probe element with a mutable, per-instance geometry.
 *
 * Assigning `getBoundingClientRect` per element (instead of monkeypatching
 * `Element.prototype`) keeps every other element in the realm at its jsdom
 * default, which is what lets the internal native-scroll-behavior probe in
 * `packages/core/src/dom/physicalAxis.ts` safely short-circuit.
 *
 * @param {string} className - Class name applied to the element.
 * @param {number} top - Initial rect top offset.
 * @param {number} [height] - Rect height.
 * @returns {{ element: HTMLElement, geometry: { height: number, top: number } }} Element and its mutable geometry.
 */
function createProbeElement(className, top, height = ELEMENT_HEIGHT) {
  const element = document.createElement('div');
  const geometry = { height, top };

  element.className = className;
  element.getBoundingClientRect = () => createRect(geometry.top, geometry.height);

  return { element, geometry };
}

/**
 * Creates a batch of probe elements, optionally cycling through class names
 * so callers can synthesize multi-rule or split-selector workloads.
 *
 * @param {number} count - Element count.
 * @param {{ classNames?: ReadonlyArray<string>, offset?: number, spacing?: number }} [config] - Batch configuration.
 * @returns {{ elements: HTMLElement[], geometries: Array<{ height: number, top: number }> }} Created elements and their geometries.
 */
function createProbeBatch(count, { classNames = [PROBE_CLASS_NAME], offset = 0, spacing = ELEMENT_SPACING } = {}) {
  const elements = [];
  const geometries = [];

  for (let index = 0; index < count; index += 1) {
    const className = classNames[index % classNames.length];
    const { element, geometry } = createProbeElement(className, (offset + index) * spacing);

    elements.push(element);
    geometries.push(geometry);
  }

  return { elements, geometries };
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
 * Creates a render root with a fixed, generous rect so renderer-target sizing
 * never becomes the bottleneck under measurement.
 *
 * @returns {HTMLElement} Render root element.
 */
function createRenderRoot() {
  const renderRoot = document.createElement('div');

  renderRoot.getBoundingClientRect = () => createRect(0, 800);

  return renderRoot;
}

/**
 * Builds an unmounted source/render DOM pair plus a fresh state integration.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @param {{ classNames?: ReadonlyArray<string>, options?: Record<string, unknown>, rules?: ReadonlyArray<Record<string, unknown>> }} [config] - Optional overrides.
 * @returns {Record<string, unknown>} Setup handles used by scenario samples.
 */
function createSetup(createIntegration, size, config = {}) {
  const { classNames = [PROBE_CLASS_NAME], options = {}, rules = [{ selector: PROBE_SELECTOR }] } = config;
  const sourceRoot = document.createElement('main');
  const renderRoot = createRenderRoot();
  const { elements, geometries } = createProbeBatch(size, { classNames });

  appendElements(sourceRoot, elements);
  document.body.append(sourceRoot, renderRoot);

  const integration = createIntegration({
    options: { clustering: { enabled: false }, updates: DISABLED_UPDATES, ...options },
    rules,
  });

  return { elements, geometries, integration, renderRoot, sourceRoot };
}

/**
 * Mounts a setup — which itself performs one initial render as part of the
 * mount cycle — then resets stats so the following timed action's
 * `renders.completed` counter starts at zero.
 *
 * @param {Record<string, unknown>} setup - Setup created by {@link createSetup}.
 * @returns {void}
 */
function primeBaseline(setup) {
  setup.integration.mount({ renderRoot: setup.renderRoot, sourceRoot: setup.sourceRoot });
  setup.integration.resetStats();
}

/**
 * Destroys the integration and detaches its DOM subtree.
 *
 * @param {Record<string, unknown>} setup - Setup created by {@link createSetup}.
 * @returns {void}
 */
function teardown(setup) {
  setup.integration.destroy();
  setup.sourceRoot.remove();
  setup.renderRoot.remove();
}

/**
 * Asserts a snapshot published exactly the expected marker count.
 *
 * @param {string} scenario - Scenario name, used in the error message.
 * @param {Record<string, unknown>} snapshot - Published tracker snapshot.
 * @param {number} expected - Expected marker count.
 * @returns {void}
 */
function assertMarkerCount(scenario, snapshot, expected) {
  if (snapshot.markers.length !== expected) {
    throw new Error(
      `Scenario "${scenario}" published ${String(snapshot.markers.length)} markers, expected ${String(expected)}.`,
    );
  }
}

/**
 * Asserts the timed action actually executed the measured render path.
 *
 * Only "no render completed at all" invalidates a sample: it means the timed
 * span never ran the workload the case claims to measure. The exact completed
 * render count is a scheduler work counter, so it is published as
 * `diagnostics.renders` instead of being enforced here — a render-count change
 * must stay comparable evidence rather than making the sample unusable.
 *
 * @param {string} scenario - Scenario name, used in the error message.
 * @param {Record<string, unknown>} stats - Tracker stats after the timed action.
 * @returns {void}
 */
function assertMeasuredRenderCompleted(scenario, stats) {
  if (stats.renders.completed < 1) {
    throw new Error(`Scenario "${scenario}" completed no render, so the measured path did not execute.`);
  }
}

/**
 * Asserts every published marker carried the label its function rule computed.
 *
 * A label function that silently returned `null` would still publish the
 * expected marker count while exercising a cheaper path than this scenario
 * claims to measure, so the labels themselves are a semantic precondition of
 * the sample rather than a work counter.
 *
 * @param {string} scenario - Scenario name, used in the error message.
 * @param {Record<string, unknown>} snapshot - Published tracker snapshot.
 * @param {Set<string>} expected - Labels the rule is expected to have produced.
 * @returns {void}
 */
function assertFunctionLabels(scenario, snapshot, expected) {
  const published = new Set(snapshot.markers.map((marker) => marker.label));

  if (published.size !== expected.size) {
    throw new Error(
      `Scenario "${scenario}" published ${String(published.size)} distinct marker labels, expected ${String(expected.size)}.`,
    );
  }

  published.forEach((label) => {
    if (!expected.has(label)) {
      throw new Error(`Scenario "${scenario}" published unexpected marker label ${JSON.stringify(label)}.`);
    }
  });
}

/**
 * Times the initial mount + first render pass against a fresh instance.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runInitialFullSample(createIntegration, size) {
  const setup = createSetup(createIntegration, size);
  const startedAt = performance.now();

  // `mount()` performs one full render as part of the mount cycle itself —
  // there is no separate "mount without rendering" step to time.
  setup.integration.mount({ renderRoot: setup.renderRoot, sourceRoot: setup.sourceRoot });

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  assertMarkerCount('initial-full', snapshot, size);
  assertMeasuredRenderCompleted('initial-full', stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times a repeated full render against unchanged mounted state.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runRepeatedFullSample(createIntegration, size) {
  const setup = createSetup(createIntegration, size);

  primeBaseline(setup);

  const startedAt = performance.now();

  setup.integration.render();

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  assertMarkerCount('repeated-full', snapshot, size);
  assertMeasuredRenderCompleted('repeated-full', stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times a repeated full render whose single rule carries a function label.
 *
 * A function label makes marker-match reuse unavailable, so the rebuild takes
 * the selector-revalidation path instead of reusing the previous matches. Only
 * `render()` is timed: the source text the label function reads is written
 * before the baseline render, so no benchmark-owned DOM mutation is inside the
 * timed span, and the scenario differs from "repeated-full" purely in how the
 * rule's label is declared.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runFunctionLabelRepeatedFullSample(createIntegration, size) {
  const setup = createSetup(createIntegration, size, {
    rules: [{ label: (element) => element.textContent, selector: PROBE_SELECTOR }],
  });
  const expectedLabels = new Set();

  setup.elements.forEach((element, index) => {
    const label = `${FUNCTION_LABEL_PREFIX}${String(index)}`;

    element.textContent = label;
    expectedLabels.add(label);
  });

  primeBaseline(setup);

  const startedAt = performance.now();

  setup.integration.render();

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  assertMarkerCount('function-label-repeated-full', snapshot, size);
  assertMeasuredRenderCompleted('function-label-repeated-full', stats);
  assertFunctionLabels('function-label-repeated-full', snapshot, expectedLabels);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times appending a batch of new source elements followed by a render.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Base workload size before the addition.
 * @param {number} fraction - Fraction of `size` to append (rounded, minimum 1).
 * @param {string} label - Scenario name used in assertions.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runSourceAddSample(createIntegration, size, fraction, label) {
  const setup = createSetup(createIntegration, size);

  primeBaseline(setup);

  const addCount = Math.max(1, Math.round(size * fraction));
  const { elements: addedElements } = createProbeBatch(addCount, { classNames: [PROBE_CLASS_NAME], offset: size });

  appendElements(setup.sourceRoot, addedElements);

  const startedAt = performance.now();

  setup.integration.render();

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  assertMarkerCount(label, snapshot, size + addCount);
  assertMeasuredRenderCompleted(label, stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times removing a batch of existing source elements followed by a render.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Base workload size before the removal.
 * @param {number} fraction - Fraction of `size` to remove (rounded, clamped to leave at least one element).
 * @param {string} label - Scenario name used in assertions.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runSourceRemoveSample(createIntegration, size, fraction, label) {
  const setup = createSetup(createIntegration, size);

  primeBaseline(setup);

  const removeCount = Math.max(1, Math.min(size - 1, Math.round(size * fraction)));
  const toRemove = setup.elements.slice(0, removeCount);

  toRemove.forEach((element) => {
    element.remove();
  });

  const startedAt = performance.now();

  setup.integration.render();

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  assertMarkerCount(label, snapshot, size - removeCount);
  assertMeasuredRenderCompleted(label, stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times mutating every element's live geometry followed by a render, since
 * Core exposes no dedicated geometry-change API.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runGeometryChangeSample(createIntegration, size) {
  const setup = createSetup(createIntegration, size);

  primeBaseline(setup);

  setup.geometries.forEach((geometry, index) => {
    geometry.top = (size - index) * ELEMENT_SPACING;
  });

  const startedAt = performance.now();

  setup.integration.render();

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  assertMarkerCount('geometry-change', snapshot, size);
  assertMeasuredRenderCompleted('geometry-change', stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times replacing the active rule set from a half-matching rule to a
 * fully-matching two-rule set, followed by a render.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runRuleChangeSample(createIntegration, size) {
  const evenSelector = '.pipeline-probe-even';
  const oddSelector = '.pipeline-probe-odd';
  const setup = createSetup(createIntegration, size, {
    classNames: ['pipeline-probe-even', 'pipeline-probe-odd'],
    rules: [{ selector: evenSelector }],
  });

  setup.integration.mount({ renderRoot: setup.renderRoot, sourceRoot: setup.sourceRoot });

  const initialExpected = Math.ceil(size / 2);

  assertMarkerCount('rule-change (baseline)', setup.integration.getSnapshot(), initialExpected);
  setup.integration.resetStats();

  const startedAt = performance.now();

  setup.integration.replaceRules([{ selector: evenSelector }, { selector: oddSelector }]);
  setup.integration.flushPendingRender();

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  assertMarkerCount('rule-change', snapshot, size);
  assertMeasuredRenderCompleted('rule-change', stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times the initial mount + render with clustering enabled or disabled from
 * the start, using the default tight element spacing so clustering (when
 * enabled) actually groups markers.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @param {boolean} enabled - Whether clustering is enabled.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runClusteringSample(createIntegration, size, enabled) {
  const label = enabled ? 'clustering-enabled' : 'clustering-disabled';
  const setup = createSetup(createIntegration, size, { options: { clustering: { enabled, threshold: 2 } } });
  const startedAt = performance.now();

  setup.integration.mount({ renderRoot: setup.renderRoot, sourceRoot: setup.sourceRoot });

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  if (stats.markers.current + stats.clusters.current === 0 && size > 0) {
    throw new Error(`Scenario "${label}" published no markers or clusters for a non-empty workload.`);
  }

  if (enabled && size > 1 && stats.clusters.current === 0) {
    throw new Error(`Scenario "${label}" enabled clustering but produced zero clusters.`);
  }

  if (!enabled && stats.clusters.current !== 0) {
    throw new Error(`Scenario "${label}" disabled clustering but produced ${String(stats.clusters.current)} clusters.`);
  }

  assertMeasuredRenderCompleted(label, stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times a clustering threshold change (patchOptions) followed by a flush of
 * the resulting MARKERS-only render request, moving from a coarse threshold
 * that merges everything into few clusters to a near-zero threshold that
 * leaves markers mostly ungrouped.
 *
 * `patchOptions()` queues a targeted render (see `getRenderTargetForDiff` in
 * `packages/core/src/tracker/updating.ts`: `clustering.threshold` only ever
 * sets `diff.markers`), so the timed action synchronously executes that
 * queued MARKERS target via `flushPendingRender()` instead of calling the
 * public `render()`, which would additionally request a full ALL render.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runClusteringOptionChangeSample(createIntegration, size) {
  const setup = createSetup(createIntegration, size, { options: { clustering: { enabled: true, threshold: 50 } } });

  setup.integration.mount({ renderRoot: setup.renderRoot, sourceRoot: setup.sourceRoot });

  const baselineSnapshot = setup.integration.getSnapshot();
  const baselineClusterCount = baselineSnapshot.clusters.length;

  setup.integration.resetStats();

  const startedAt = performance.now();

  setup.integration.patchOptions({ clustering: { threshold: 0.0001 } });
  setup.integration.flushPendingRender();

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  // Every published record accounts for either one ungrouped marker or a
  // cluster's `count` grouped markers, so their sum must equal the workload
  // size regardless of how clustering split the workload.
  const clusteredItemCount = snapshot.clusters.reduce((total, cluster) => total + cluster.count, 0);
  const coveredItemCount = snapshot.markers.length + clusteredItemCount;

  if (coveredItemCount !== size) {
    throw new Error(
      `Scenario "clustering-option-change" published records covering ${String(coveredItemCount)} items, expected ${String(size)}.`,
    );
  }

  // A threshold shrink can only reduce (never increase) how aggressively
  // markers merge, so a genuinely-applied change must reduce cluster count
  // or grow the ungrouped-marker count relative to the coarse baseline.
  const clusteringLoosened =
    snapshot.clusters.length < baselineClusterCount || snapshot.markers.length > baselineSnapshot.markers.length;

  if (size > 1 && !clusteringLoosened) {
    throw new Error('Scenario "clustering-option-change" threshold narrowing did not reduce clustering.');
  }

  assertMeasuredRenderCompleted('clustering-option-change', stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/**
 * Times an initial mount + render against a large, evenly split rule count,
 * isolating rule-count overhead from marker count.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {number} size - Source-element workload size.
 * @returns {{ durationMs: number, snapshot: Record<string, unknown>, stats: Record<string, unknown> }} Sample result.
 */
function runLargeRuleCountSample(createIntegration, size) {
  const ruleCount = Math.max(1, Math.min(LARGE_RULE_COUNT, size));
  const classNames = Array.from({ length: ruleCount }, (_, index) => `pipeline-probe-rule-${String(index)}`);
  const rules = classNames.map((className) => ({ selector: `.${className}` }));
  const setup = createSetup(createIntegration, size, { classNames, rules });
  const startedAt = performance.now();

  setup.integration.mount({ renderRoot: setup.renderRoot, sourceRoot: setup.sourceRoot });

  const durationMs = performance.now() - startedAt;
  const snapshot = setup.integration.getSnapshot();
  const stats = setup.integration.getStats();

  assertMarkerCount('large-rule-count', snapshot, size);
  assertMeasuredRenderCompleted('large-rule-count', stats);
  teardown(setup);

  return { durationMs, snapshot, stats };
}

/** Maps every scenario name to its sample function. */
const SCENARIO_RUNNERS = {
  'clustering-disabled': (createIntegration, size) => runClusteringSample(createIntegration, size, false),
  'clustering-enabled': (createIntegration, size) => runClusteringSample(createIntegration, size, true),
  'clustering-option-change': (createIntegration, size) => runClusteringOptionChangeSample(createIntegration, size),
  'function-label-repeated-full': (createIntegration, size) =>
    runFunctionLabelRepeatedFullSample(createIntegration, size),
  'geometry-change': (createIntegration, size) => runGeometryChangeSample(createIntegration, size),
  'initial-full': (createIntegration, size) => runInitialFullSample(createIntegration, size),
  'large-rule-count': (createIntegration, size) => runLargeRuleCountSample(createIntegration, size),
  'repeated-full': (createIntegration, size) => runRepeatedFullSample(createIntegration, size),
  'rule-change': (createIntegration, size) => runRuleChangeSample(createIntegration, size),
  'source-add-large': (createIntegration, size) => runSourceAddSample(createIntegration, size, 1, 'source-add-large'),
  'source-add-small': (createIntegration, size) => runSourceAddSample(createIntegration, size, 0.1, 'source-add-small'),
  'source-remove-large': (createIntegration, size) =>
    runSourceRemoveSample(createIntegration, size, 0.5, 'source-remove-large'),
  'source-remove-small': (createIntegration, size) =>
    runSourceRemoveSample(createIntegration, size, 0.1, 'source-remove-small'),
};

/** Benchmark scenarios in stable report order. */
const SCENARIOS = Object.freeze(Object.keys(SCENARIO_RUNNERS).sort());

/**
 * Per-scenario `measurementVersion`.
 *
 * The previous generation used 1 for scenarios whose measured boundary had
 * never changed and 2 for those where benchmark-owned mutation moved out of
 * the timed span or the trigger switched from `render()` to
 * `flushPendingRender()`. Every one of those is bumped once more because the
 * `assertions` composition changed for all of them: marker churn and scheduler
 * counters became `diagnostics`, so comparability no longer means the same
 * thing as it did in the previous report generation.
 */
const MEASUREMENT_VERSION_BY_SCENARIO = Object.freeze({
  'clustering-disabled': 2,
  'clustering-enabled': 2,
  'clustering-option-change': 3,
  'function-label-repeated-full': 1,
  'geometry-change': 3,
  'initial-full': 2,
  'large-rule-count': 2,
  'repeated-full': 2,
  'rule-change': 3,
  'source-add-large': 3,
  'source-add-small': 3,
  'source-remove-large': 3,
  'source-remove-small': 3,
});

/**
 * Workload sizes for scenarios that deliberately do not run the full matrix.
 *
 * "function-label-repeated-full" runs at the smallest size already present in
 * the shared matrix. The scenario exists to keep the function-label rebuild
 * path visible in before/after comparisons, not to chart how it scales, and a
 * per-element selector revalidation makes the larger matrix sizes needlessly
 * expensive for that purpose.
 */
const SIZES_BY_SCENARIO = Object.freeze({
  'function-label-repeated-full': Object.freeze(arguments_.smoke ? [25] : [100]),
});

/**
 * Reports whether a scenario participates in the given workload size.
 *
 * @param {string} scenario - Scenario name.
 * @param {number} size - Source-element workload size.
 * @returns {boolean} Whether the scenario/size cell is part of the matrix.
 */
function scenarioRunsAtSize(scenario, size) {
  return (SIZES_BY_SCENARIO[scenario] ?? WORKLOAD_SIZES).includes(size);
}

/**
 * Runs warm-up and timed samples for one scenario/size cell.
 *
 * @param {Function} createIntegration - Benchmark-owned Direct Renderer integration factory.
 * @param {string} scenario - Scenario name.
 * @param {number} size - Source-element workload size.
 * @returns {Record<string, unknown>} One report result row.
 */
function runScenarioForSize(createIntegration, scenario, size) {
  const sampleFunction = SCENARIO_RUNNERS[scenario];

  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    sampleFunction(createIntegration, size);
  }

  const durations = [];
  let lastResult = null;

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    lastResult = sampleFunction(createIntegration, size);
    durations.push(lastResult.durationMs);
  }

  return {
    clusters: lastResult.stats.clusters,
    duration: summarizeDurations(durations),
    markers: lastResult.stats.markers,
    renderRecordCount: lastResult.snapshot.items.length,
    renders: lastResult.stats.renders,
    scenario,
    size,
  };
}

/**
 * Converts one workload row into the shared report schema.
 *
 * Topology stays a comparability gate: `renderRecordCount` is the published
 * `TrackerSnapshot.items` length, `markers.current` the marker records that
 * participated in the last render pass, and `clusters.current` the clustering
 * shape that distinguishes the clustering scenarios from each other. The
 * remaining `TrackerStats` counters describe how much work reaching that shape
 * took — marker record churn (`created`/`removed`, i.e. how much reuse
 * happened) and the scheduler's requested/started/completed/cancelled/skipped
 * tallies — so they are `diagnostics`: a reuse or scheduling regression must
 * stay a visible, comparable number rather than voiding the sample.
 */
function createReportResult(result) {
  return {
    assertions: {
      clusters: { current: result.clusters.current },
      markers: { current: result.markers.current },
      renderRecordCount: result.renderRecordCount,
    },
    caseId: `${result.scenario}/${String(result.size)}`,
    diagnostics: {
      markers: { created: result.markers.created, removed: result.markers.removed },
      renders: result.renders,
    },
    dimensions: {
      itemCount: result.size,
      scenario: result.scenario,
    },
    measurementVersion: MEASUREMENT_VERSION_BY_SCENARIO[result.scenario],
    metrics: {
      durationMs: result.duration,
    },
  };
}

/**
 * Runs the complete benchmark matrix against the real Core pipeline.
 *
 * @returns {Promise<Record<string, unknown>>} Complete benchmark report.
 */
async function runBenchmark() {
  const server = await createBenchmarkViteServer({ version: '0.1.0-core-render-pipeline-benchmark' });
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });

  installDomGlobals(dom);
  installDocumentGeometry();

  try {
    const { createBenchmarkCoreIntegration } = await server.ssrLoadModule('/benchmarks/core-render-pipeline-entry.ts');
    const results = WORKLOAD_SIZES.flatMap((size) =>
      SCENARIOS.filter((scenario) => scenarioRunsAtSize(scenario, size)).map((scenario) =>
        runScenarioForSize(createBenchmarkCoreIntegration, scenario, size),
      ),
    );

    return {
      environment: await collectBenchmarkEnvironment({
        buildTarget: profile.buildTarget,
        provenance: profile.provenance,
      }),
      methodology: {
        counterLimitations:
          'Core exposes no selector-match or geometry-read counters. markers/clusters/renders come from TrackerStats (getStats()), reset via resetStats() before every timed action; renderRecordCount is the published TrackerSnapshot.items length. A sample is rejected only when no render completed at all, meaning the timed span never executed the measured path.',
        reportSemantics:
          'assertions hold semantic outcomes (published record count, marker records in the last render pass, clustering shape). diagnostics hold work indicators (marker record churn, scheduler requested/started/completed/cancelled/skipped counts): they are evidence for investigating a duration change, never a comparability gate.',
        disabledObservers:
          'mutation/resize/scroll/interval observers are disabled for every scenario so timings isolate pipeline cost from observer scheduling; scheduler/coalescing behavior is covered separately by core-render-browser.mjs.',
        geometryMethodology:
          'Per-element getBoundingClientRect() overrides (the pattern proven in packages/core/src/tracker/__tests__/rendererIntegration.contract.test.ts) plus static documentElement/body/window overrides exercise the real WindowScrollContext end-to-end instead of mocking it or monkeypatching Element.prototype.',
        functionLabelScenario:
          'The "function-label-repeated-full" scenario repeats a full render against a rule whose label is a function instead of a string, so marker-match reuse is unavailable and the rebuild revalidates its selector. It runs only at the smallest workload size of the matrix: it exists to keep that path visible in before/after comparisons, not to chart its scaling.',
        largeRuleCount: LARGE_RULE_COUNT,
        sampleCount: SAMPLE_COUNT,
        smoke: arguments_.smoke,
        timingScope:
          'Only the scenario-defining call is timed: mount() for "initial-full", "clustering-enabled", "clustering-disabled", and "large-rule-count" (mount() performs one full render as part of the mount cycle itself); render() for "repeated-full" and "function-label-repeated-full", where a full render is the scenario itself and the source text the label function reads is written before the baseline render; flushPendingRender() for "rule-change" and "clustering-option-change", which synchronously executes the MARKERS-only render request already queued by replaceRules()/patchOptions() without widening it to a full render the way render() would. For "source-add-*", "source-remove-*", and "geometry-change", benchmark-owned DOM/geometry mutation runs before the timer starts, so only the subsequent render() call is timed. DOM/fixture setup and correctness assertions are excluded.',
        warmupCount: WARMUP_COUNT,
        workloadSizes: WORKLOAD_SIZES,
        workloadSizesByScenario: SIZES_BY_SCENARIO,
      },
      results: results.map(createReportResult),
    };
  } finally {
    dom.window.close();
    await server.close();
  }
}

console.log('Running core-render-pipeline...');

/** Complete benchmark report for the requested phase. */
const report = await runBenchmark();

/** Persisted JSON/CSV report pair. */
const savedReport = await writeBenchmarkReports('core-render-pipeline', report, arguments_);

console.log(`Report: ${savedReport.json}`);
console.log(`Report: ${savedReport.csv}`);
