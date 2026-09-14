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
const arguments_ = parseBenchmarkArguments(process.argv.slice(2), {
  booleanFlags: ['--diagnose-construction'],
});

/** Canonical profile metadata used for report provenance. */
const profile = getBenchmarkProfile('projection-boundary');

/** Representative projection item counts. */
const ITEM_COUNTS = Object.freeze(arguments_.smoke ? [100] : [1000, 5000, 10000]);

/** Timed samples retained for each scenario after warm-up. */
const SAMPLE_COUNT = arguments_.smoke ? 1 : 9;

/** Untimed samples used to warm the active runtime and JIT. */
const WARMUP_COUNT = arguments_.smoke ? 0 : 2;

/** Benchmark scenarios in stable report order. */
const SCENARIOS = Object.freeze([
  'initial-full',
  'full-update',
  'markers-items',
  'marker-presentation',
  'viewport-only',
  'selection-only',
  'configuration-presentation',
]);

/** Whether to append an untargeted direct-construction diagnostic after timed workload cells. */
const DIRECT_CONSTRUCTION_DIAGNOSTIC = arguments_.flags.has('--diagnose-construction');

/**
 * Version 2 removed the obsolete post-transaction item-view materialization
 * phase (`itemViewConstructionDurationMs`, `totalDurationMs`), narrowing what
 * an identically named metric measures.
 *
 * Version 3 moved the allocation proxy out of `assertions` and into
 * `diagnostics`: reference churn is an implementation work indicator, not a
 * semantic invariant, so it must no longer block a before/after comparison.
 * That changes what comparability means for every case, so no version-2 report
 * is strictly comparable with a version-3 one.
 */
const PROJECTION_BOUNDARY_MEASUREMENT_VERSION = 3;

/** Creates one normalized marker record used by marker and cluster items. */
function createMarkerRecord(document, index) {
  const key = `marker-${String(index)}`;

  return Object.freeze({
    cluster: null,
    element: document.createElement('section'),
    focus: Object.freeze({ enabled: index % 7 === 0, target: 'self' }),
    key,
    kind: 'marker',
    label: `Marker ${String(index)}`,
    rule: Object.freeze({
      focus: Object.freeze({ enabled: index % 7 === 0, target: 'self' }),
      index,
      label: `Marker ${String(index)}`,
      marker: Object.freeze({
        attributes: Object.freeze({ removals: new Set(), values: Object.freeze({ 'data-category': `c${index % 5}` }) }),
        className: `category-${String(index % 5)}`,
        cssVariables: Object.freeze({ '--rxtt-marker-bg': index % 2 === 0 ? '#2563eb' : '#7c3aed' }),
        title: true,
      }),
      scroll: Object.freeze({ align: 'start', behavior: 'auto', enabled: true, target: 'self' }),
      selector: `.marker-${String(index)}`,
      source: Object.freeze({ selector: `.marker-${String(index)}` }),
    }),
    ruleIndex: index,
    scroll: Object.freeze({ align: 'start', behavior: 'auto', enabled: true, target: 'self' }),
    selector: `.marker-${String(index)}`,
  });
}

/** Creates a stable mix of marker and cluster render records. */
function createRenderRecords(document, count) {
  const markers = Array.from({ length: count + Math.ceil(count / 20) }, (_, index) =>
    createMarkerRecord(document, index),
  );
  let nextMarkerIndex = 0;

  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const start = (index / count) * 100;
      const size = Math.max(0.01, 100 / count);

      if (index % 20 === 0) {
        const firstMarker = markers[nextMarkerIndex];
        const secondMarker = markers[nextMarkerIndex + 1];

        nextMarkerIndex += 2;

        return Object.freeze({
          count: 2,
          end: start + size,
          key: `cluster-${String(index)}`,
          kind: 'cluster',
          markers: Object.freeze([firstMarker, secondMarker]),
          orientation: 'vertical',
          primaryMarker: firstMarker,
          size,
          start,
        });
      }

      const marker = markers[nextMarkerIndex];

      nextMarkerIndex += 1;

      return Object.freeze({
        end: start + size,
        key: marker.key,
        kind: 'marker',
        marker,
        orientation: 'vertical',
        size,
        start,
      });
    }),
  );
}

/** Creates one initialized projection renderer and captures its latest commit. */
function createFixture(api, options) {
  const renderer = api.createTrackerProjectionRenderer();
  let latestCommit = null;

  renderer.initialize(options);
  renderer.subscribe((commit) => {
    latestCommit = commit;
  });

  return {
    consumeCommit() {
      const commit = latestCommit;

      latestCommit = null;

      return commit;
    },
    renderer,
  };
}

/** Runs one projection renderer transaction and returns Core elapsed time. */
function runTransaction(api, renderer, operation) {
  const startedAt = performance.now();

  api.beginTrackerRendererTransaction(renderer);
  operation();
  api.commitTrackerRendererTransaction(renderer);

  return performance.now() - startedAt;
}

/** Performs the initial mounted full projection transaction. */
function initializeMountedFixture(api, fixture, options, records, markerDefaults) {
  const viewport = {
    end: 30,
    orientation: 'vertical',
    size: 20,
    source: { contentSize: 5000, scrollOffset: 500, viewportSize: 1000 },
    start: 10,
    visible: true,
  };

  runTransaction(api, fixture.renderer, () => {
    api.updateTrackerRendererMount(fixture.renderer, api.createTrackerMountView(true, 'window', true), options);
    fixture.renderer.renderTrack(options);
    fixture.renderer.renderMarkers(records, options, markerDefaults);
    fixture.renderer.renderSelection(null, null);
    fixture.renderer.renderViewport(viewport, options);
  });

  const commit = fixture.consumeCommit();
  const state = fixture.renderer.getProjection();

  return { commit, state, viewport };
}

/** Counts changed item object identities at corresponding array positions. */
function countChangedItemReferences(previousItems, nextItems) {
  const commonLength = Math.min(previousItems.length, nextItems.length);
  let changed = Math.abs(previousItems.length - nextItems.length);

  for (let index = 0; index < commonLength; index += 1) {
    if (!Object.is(previousItems[index], nextItems[index])) {
      changed += 1;
    }
  }

  return changed;
}

/** Runs one scenario sample with setup excluded from timing. */
function runScenarioSample(api, scenario, options, records, markerDefaults, alternateMarkerDefaults, sequence) {
  const fixture = createFixture(api, options);
  let initialized = null;

  if (scenario !== 'initial-full') {
    initialized = initializeMountedFixture(api, fixture, options, records, markerDefaults);
  }

  const previousState = initialized?.state ?? fixture.renderer.getProjection();
  const nextViewport = {
    end: 35 + (sequence % 10),
    orientation: 'vertical',
    size: 20,
    source: { contentSize: 5000, scrollOffset: 750 + sequence, viewportSize: 1000 },
    start: 15 + (sequence % 10),
    visible: true,
  };
  let activeMarkerDefaults = markerDefaults;
  const coreMs = runTransaction(api, fixture.renderer, () => {
    if (scenario === 'initial-full') {
      api.updateTrackerRendererMount(fixture.renderer, api.createTrackerMountView(true, 'window', true), options);
      fixture.renderer.renderTrack(options);
      fixture.renderer.renderMarkers(records, options, markerDefaults);
      fixture.renderer.renderSelection(null, null);
      fixture.renderer.renderViewport(nextViewport, options);
    } else if (scenario === 'full-update') {
      fixture.renderer.renderTrack(options);
      fixture.renderer.renderMarkers(records, options, markerDefaults);
      fixture.renderer.renderViewport(nextViewport, options);
    } else if (scenario === 'markers-items') {
      fixture.renderer.renderMarkers(records, options, markerDefaults);
    } else if (scenario === 'marker-presentation') {
      fixture.renderer.renderMarkerPresentation(records, markerDefaults);
    } else if (scenario === 'selection-only') {
      fixture.renderer.renderSelection(records[0]?.key ?? null, records[1]?.key ?? null);
    } else if (scenario === 'configuration-presentation') {
      activeMarkerDefaults = alternateMarkerDefaults;
      fixture.renderer.renderMarkerPresentation(records, alternateMarkerDefaults);
    } else {
      fixture.renderer.renderViewport(nextViewport, options);
    }
  });
  const commit = fixture.consumeCommit();
  const state = fixture.renderer.getProjection();
  let directConstructionMs = null;

  if (DIRECT_CONSTRUCTION_DIAGNOSTIC && scenario === 'markers-items') {
    const directConstructionStartedAt = performance.now();

    api.projectTrackerItemViews(records, activeMarkerDefaults, true);
    directConstructionMs = performance.now() - directConstructionStartedAt;
  }

  return {
    allocationProxy: {
      itemArrayChanged: !Object.is(previousState.items, state.items),
      itemObjectReferencesChanged: countChangedItemReferences(previousState.items, state.items),
    },
    changedDomains: commit?.changed ?? [],
    coreMs,
    directConstructionMs,
    itemCount: state.items.length,
    itemsFrozen: Object.isFrozen(state.items),
  };
}

/**
 * Fails fast when a timed sample violates the deterministic workload invariant
 * that production always publishes a non-empty, frozen projection items array,
 * so only genuinely valid samples reach the aggregate statistics.
 */
function assertScenarioSampleInvariants(scenario, sample) {
  if (!Number.isInteger(sample.itemCount) || sample.itemCount <= 0) {
    throw new Error(`Scenario "${scenario}" sample produced ${String(sample.itemCount)} projected items.`);
  }

  if (!sample.itemsFrozen) {
    throw new Error(`Scenario "${scenario}" sample produced a non-frozen projection items array.`);
  }
}

/** Runs all samples for one size/scenario cell. */
function runScenario(api, scenario, options, records, markerDefaults, alternateMarkerDefaults) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    runScenarioSample(api, scenario, options, records, markerDefaults, alternateMarkerDefaults, index);
  }

  const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const sample = runScenarioSample(
      api,
      scenario,
      options,
      records,
      markerDefaults,
      alternateMarkerDefaults,
      WARMUP_COUNT + index,
    );

    assertScenarioSampleInvariants(scenario, sample);

    return sample;
  });
  const representative = samples[Math.floor(samples.length / 2)];

  return {
    allocationProxy: representative.allocationProxy,
    changedDomains: representative.changedDomains,
    core: summarizeDurations(samples.map((sample) => sample.coreMs)),
    ...(representative.directConstructionMs === null
      ? {}
      : { directConstruction: summarizeDurations(samples.map((sample) => sample.directConstructionMs)) }),
    itemCount: representative.itemCount,
    itemsFrozen: representative.itemsFrozen,
    scenario,
  };
}

/**
 * Converts one workload row into the shared report schema.
 *
 * `changedDomains`, `itemsFrozen`, and `projectedItemCount` are semantic
 * outcomes of the projection transaction — which domains a commit reports,
 * the published immutability contract, and result topology — so they stay
 * comparability gates. The allocation proxy is not: whether the items array
 * was reissued and how many item references changed are implementation
 * work/allocation indicators with no repository-guaranteed public semantics,
 * so they become `diagnostics` and stay visible instead of invalidating the
 * comparison whenever projection churn changes.
 */
function createReportResult(result) {
  return {
    assertions: {
      changedDomains: result.changedDomains,
      itemsFrozen: result.itemsFrozen,
      projectedItemCount: result.itemCount,
    },
    caseId: `${result.scenario}/${String(result.count)}`,
    diagnostics: {
      allocationProxy: result.allocationProxy,
    },
    dimensions: {
      itemCount: result.count,
      scenario: result.scenario,
    },
    measurementVersion: PROJECTION_BOUNDARY_MEASUREMENT_VERSION,
    metrics: {
      coreDurationMs: result.core,
      ...(result.directConstruction === undefined ? {} : { directConstructionDurationMs: result.directConstruction }),
    },
  };
}

/** Runs the complete benchmark matrix against the current source implementation. */
async function runBenchmark() {
  const server = await createBenchmarkViteServer({ version: '0.1.0-projection-boundary-benchmark' });
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });

  try {
    const api = await server.ssrLoadModule('/benchmarks/projection-boundary-entry.ts');
    const options = api.resolveTrackerOptions({
      a11y: { enabled: true, keyboard: true },
      clustering: { enabled: true, threshold: 2 },
      marker: { attributes: { 'data-global': 'baseline' }, className: 'global-marker', title: true },
      viewport: { enabled: true },
    });
    const markerDefaults = api.createTrackerMarkerDefaultsSnapshot(options.marker);
    const alternateMarkerDefaults = api.createTrackerMarkerDefaultsSnapshot({
      attributes: { 'data-global': 'changed' },
      className: 'global-marker-changed',
      title: false,
    });
    const workloadResults = ITEM_COUNTS.flatMap((count) => {
      const records = createRenderRecords(dom.window.document, count);

      return SCENARIOS.map((scenario) => ({
        count,
        ...runScenario(api, scenario, options, records, markerDefaults, alternateMarkerDefaults),
      }));
    });

    return {
      environment: await collectBenchmarkEnvironment({
        buildTarget: profile.buildTarget,
        provenance: profile.provenance,
      }),
      methodology: {
        allocationProxy: 'Reference churn in projection items; setup and source-record creation excluded.',
        itemCounts: ITEM_COUNTS,
        sampleCount: SAMPLE_COUNT,
        smoke: arguments_.smoke,
        warmupCount: WARMUP_COUNT,
      },
      results: workloadResults.map(createReportResult),
    };
  } finally {
    dom.window.close();
    await server.close();
  }
}

console.log('Running projection-boundary...');

/** Complete benchmark report for the requested phase. */
const report = await runBenchmark();

/** Persisted JSON/CSV report pair. */
const savedReport = await writeBenchmarkReports('projection-boundary', report, arguments_);

console.log(`Report: ${savedReport.json}`);
console.log(`Report: ${savedReport.csv}`);
