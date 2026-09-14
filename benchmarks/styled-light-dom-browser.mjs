/* eslint-disable no-console, no-extend-native -- The isolated benchmark instruments browser prototypes and reports measurements. */

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
const profile = getBenchmarkProfile('styled-light-dom-browser');

/** Record counts representing ordinary, high, and stress workloads. */
const RECORD_COUNTS = Object.freeze(arguments_.smoke ? [50] : [1_000, 5_000, 10_000]);

/** Clustering configurations measured for every record count. */
const CLUSTERING_MODES = Object.freeze([false, true]);

/** Styling profiles compared with the clustered root-only reference profile. */
const ITEM_STYLE_SCENARIOS = Object.freeze(['external-categories', 'repeated-inline', 'unique-inline']);

/** Viewport used for repeatable headless measurements. */
const VIEWPORT = Object.freeze({ height: 720, width: 1280 });

/** Timed cycles retained for each cell after warm-up. */
const SAMPLE_COUNT = arguments_.smoke ? 1 : 3;

/** Discarded cycles that warm the runtime before the timed ones. */
const WARMUP_COUNT = arguments_.smoke ? 0 : 1;

/**
 * Semantic measurement version shared by every case in this profile.
 *
 * Version 2 removed the generic-renderer workload metrics, split the update
 * measurement into a completion boundary and the Core render duration, and
 * renamed the snapshot-tail metric to match its actual boundary.
 *
 * Version 3 changes what every case measures again: a cell is now a series of
 * independent cycles instead of a single run, durations are aggregated across
 * the timed cycles, the timed cycles execute on unpatched prototypes with no
 * observer attached, `selectedAttributeWriteDurationMs` is no longer published
 * as a metric, and the work counters that used to gate comparability moved to
 * `diagnostics`.
 *
 * Version 4 removes `selection.postDomWriteToSnapshotDeliveryMs` from `metrics`:
 * it structurally requires the DOM-write instrumentation, so it was a single
 * observation taken from the instrumented cycle rather than an aggregate of the
 * clean timed cycles. It is published under `diagnostics.instrumentedCycle`
 * instead, and `selection.updateMs` is the comparable selection timing.
 */
const STYLED_LIGHT_DOM_MEASUREMENT_VERSION = 4;

/**
 * Formats a duration for concise console output.
 *
 * @param {number} duration - Duration in milliseconds.
 * @returns {string} Formatted duration.
 */
function formatDuration(duration) {
  return `${duration.toFixed(2)} ms`;
}

/**
 * Summarizes one timed value across a cell's clean cycles.
 *
 * @param {Array<Record<string, unknown>>} samples - Timing rows, one per clean cycle.
 * @param {(sample: Record<string, unknown>) => number} select - Reads the value from one row.
 * @returns {{ maxMs: number, medianMs: number, minMs: number }} Duration summary.
 */
function summarizeSamples(samples, select) {
  return summarizeDurations(samples.map((sample) => select(sample)));
}

/**
 * Converts one styled workload cell into the shared report schema.
 *
 * `assertions` keep the semantic outcome of a cycle: Light-DOM topology, the
 * Core render target each styling update used, the selection result, the
 * rendered and published item counts, and node release after `destroy`. Every
 * work counter - source queries, geometry reads, node churn, keyed lookups,
 * attribute writes, mutation summaries - is `diagnostics`, so growth in how
 * much work an update performs stays a comparable number instead of
 * invalidating the cell.
 *
 * @param {Record<string, unknown>} result - One cell returned by the page.
 * @returns {Record<string, unknown>} Report result row.
 */
function createReportResult(result) {
  const { evidence } = result.instrumented;
  const { samples } = result;

  return {
    assertions: {
      invariants: result.invariants,
      renderedItems: result.renderedItems,
      snapshotItemCount: result.snapshotItemCount,
    },
    caseId: `${result.styleScenario}/clustering-${result.clustered ? 'enabled' : 'disabled'}/${String(result.records)}`,
    diagnostics: { instrumentedCycle: evidence },
    dimensions: {
      clusteringEnabled: result.clustered,
      recordCount: result.records,
      styleScenario: result.styleScenario,
    },
    measurementVersion: STYLED_LIGHT_DOM_MEASUREMENT_VERSION,
    metrics: {
      markerPresentation: {
        completionMs: summarizeSamples(samples, (sample) => sample.markerPresentation.completionMs),
        coreRenderDurationMs: summarizeSamples(samples, (sample) => sample.markerPresentation.coreRenderDurationMs),
        styleAndLayoutRealizationMs: summarizeSamples(
          samples,
          (sample) => sample.markerPresentation.styleAndLayoutRealizationMs,
        ),
      },
      rootStyle: {
        completionMs: summarizeSamples(samples, (sample) => sample.rootStyle.completionMs),
        coreRenderDurationMs: summarizeSamples(samples, (sample) => sample.rootStyle.coreRenderDurationMs),
        styleAndLayoutRealizationMs: summarizeSamples(
          samples,
          (sample) => sample.rootStyle.styleAndLayoutRealizationMs,
        ),
      },
      selection: {
        updateMs: summarizeSamples(samples, (sample) => sample.selection.updateMs),
      },
      setup: {
        initialRenderMs: summarizeSamples(samples, (sample) => sample.setup.initialRenderMs),
        styleAndLayoutRealizationMs: summarizeSamples(samples, (sample) => sample.setup.styleAndLayoutRealizationMs),
      },
      teardownDurationMs: summarizeSamples(samples, (sample) => sample.teardownDurationMs),
    },
  };
}

console.log('Running styled-light-dom-browser...');

/** Local server exposing the production package build. */
const server = await startStaticServer();

/** Headless browser used for CSS, layout, and DOM measurements. */
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: VIEWPORT });

  await page.goto(`${server.origin}/benchmark.html`);
  await page.addStyleTag({ url: `${server.origin}/packages/vanilla/dist/rxt-tracker.css` });
  await page.addScriptTag({
    url: `${server.origin}/packages/vanilla/dist/rxt-tracker-vanilla.js`,
  });
  await page.addStyleTag({
    content: `
      .rxtt > .rxtt__markers > .rxtt__marker.benchmark-category-marker[data-benchmark-category='0'] {
        background-color: rgb(220 38 38);
      }
      .rxtt > .rxtt__markers > .rxtt__marker.benchmark-category-marker[data-benchmark-category='1'] {
        background-color: rgb(37 99 235);
      }
      .rxtt > .rxtt__markers > .rxtt__marker.benchmark-category-marker[data-benchmark-category='2'] {
        background-color: rgb(5 150 105);
      }
      .rxtt > .rxtt__markers > .rxtt__marker.benchmark-category-marker[data-benchmark-category='3'] {
        background-color: rgb(217 119 6);
      }
    `,
  });

  const results = [];

  for (const recordCount of RECORD_COUNTS) {
    const scenarios = [
      ...CLUSTERING_MODES.map((clusteringEnabled) => ({
        clusteringEnabled,
        styleScenario: 'root-only',
      })),
      ...ITEM_STYLE_SCENARIOS.map((styleScenario) => ({
        clusteringEnabled: false,
        styleScenario,
      })),
    ];

    for (const { clusteringEnabled, styleScenario } of scenarios) {
      results.push(
        await page.evaluate(
          async ({ clustered, records, sampleCount, styling, warmupCount }) => {
            const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
            const originalMapGet = Map.prototype.get;
            const originalRemoveAttribute = Element.prototype.removeAttribute;
            const originalSetAttribute = Element.prototype.setAttribute;

            /**
             * Instrumentation state of the cycle currently running, or `null`.
             *
             * A timed cycle always runs with this at `null`: no prototype is
             * patched, `querySelectorAll` is not wrapped, and no observer is
             * attached, so the measured durations contain production work only.
             */
            let probe = null;

            /**
             * Builds one cycle's source records and render host.
             *
             * @param {number} recordTotal - Source record count.
             * @returns {{ renderHost: HTMLElement, sourceRoot: HTMLElement }} Fresh, unmounted DOM pair.
             */
            function createCycleDom(recordTotal) {
              const sourceRoot = document.createElement('main');
              const renderHost = document.createElement('div');

              sourceRoot.className = 'benchmark-source';
              sourceRoot.style.cssText = 'position: relative;';
              renderHost.className = 'benchmark-render-host';

              for (let index = 0; index < recordTotal; index += 1) {
                const sourceElement = document.createElement('div');

                sourceElement.className = 'benchmark-record';
                sourceElement.dataset.benchmarkIndex = String(index);
                sourceElement.dataset.benchmarkCategory = String(index % 4);
                sourceElement.classList.add(`benchmark-category-${index % 4}`);
                sourceElement.id = `benchmark-record-${index}`;
                sourceElement.textContent = `Record ${index}`;
                sourceElement.style.cssText = 'height: 16px; margin-block-end: 8px;';
                sourceRoot.append(sourceElement);
              }

              return { renderHost, sourceRoot };
            }

            /**
             * Installs the work counters used by the single instrumented cycle.
             *
             * @param {HTMLElement} sourceRoot - Source root whose queries are counted.
             * @returns {Record<string, unknown>} Mutable instrumentation state.
             */
            function installInstrumentation(sourceRoot) {
              const state = {
                activeSelectionRoot: null,
                geometryReads: 0,
                markerMapLookups: 0,
                selectedAttributeWriteDurationMs: 0,
                selectedAttributeWrites: 0,
                selectionLastDomWriteAt: null,
                sourceQueries: 0,
              };
              const originalQuerySelectorAll = sourceRoot.querySelectorAll.bind(sourceRoot);

              sourceRoot.querySelectorAll = (selector) => {
                state.sourceQueries += 1;

                return originalQuerySelectorAll(selector);
              };

              Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
                if (this.classList?.contains('benchmark-record')) {
                  state.geometryReads += 1;
                }

                return originalGetBoundingClientRect.call(this);
              };

              Map.prototype.get = function get(key) {
                const value = originalMapGet.call(this, key);

                if (
                  state.activeSelectionRoot !== null &&
                  value instanceof HTMLElement &&
                  value.classList.contains('rxtt__marker') &&
                  state.activeSelectionRoot.contains(value)
                ) {
                  state.markerMapLookups += 1;
                }

                return value;
              };

              Element.prototype.setAttribute = function setAttribute(name, value) {
                if (
                  state.activeSelectionRoot !== null &&
                  name === 'data-rxtt-selected' &&
                  state.activeSelectionRoot.contains(this)
                ) {
                  const startedAt = performance.now();
                  const result = originalSetAttribute.call(this, name, value);

                  state.selectedAttributeWriteDurationMs += performance.now() - startedAt;
                  state.selectedAttributeWrites += 1;
                  state.selectionLastDomWriteAt = performance.now();

                  return result;
                }

                return originalSetAttribute.call(this, name, value);
              };

              Element.prototype.removeAttribute = function removeAttribute(name) {
                if (
                  state.activeSelectionRoot !== null &&
                  name === 'data-rxtt-selected' &&
                  state.activeSelectionRoot.contains(this)
                ) {
                  const startedAt = performance.now();
                  const result = originalRemoveAttribute.call(this, name);

                  state.selectedAttributeWriteDurationMs += performance.now() - startedAt;
                  state.selectedAttributeWrites += 1;
                  state.selectionLastDomWriteAt = performance.now();

                  return result;
                }

                return originalRemoveAttribute.call(this, name);
              };

              return state;
            }

            /**
             * Restores every patched prototype method.
             *
             * @returns {void}
             */
            function uninstallInstrumentation() {
              Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
              Element.prototype.removeAttribute = originalRemoveAttribute;
              Element.prototype.setAttribute = originalSetAttribute;
              Map.prototype.get = originalMapGet;
            }

            /**
             * Reads and clears the work counters of the instrumented cycle.
             *
             * @returns {{ geometryReads: number, sourceQueries: number } | null} Counters, or `null` in a clean cycle.
             */
            function takeWorkCounters() {
              if (probe === null) {
                return null;
              }

              const counters = { geometryReads: probe.geometryReads, sourceQueries: probe.sourceQueries };

              probe.geometryReads = 0;
              probe.sourceQueries = 0;

              return counters;
            }

            /**
             * Times one Tracker operation up to its completed render.
             *
             * @param {() => void} operation - Operation that changes Tracker state.
             * @param {{ on: (name: string, handler: () => void) => () => void }} trackerInstance - Active Tracker.
             * @param {HTMLElement | null} mutationTarget - Observed subtree, or `null` in a clean cycle.
             * @returns {Promise<{ durationMs: number, mutations: MutationRecord[] }>} Measurement.
             */
            async function measureOperation(operation, trackerInstance, mutationTarget) {
              const mutations = [];
              const observer =
                mutationTarget === null
                  ? null
                  : new MutationObserver((recordsList) => {
                      mutations.push(...recordsList);
                    });

              observer?.observe(mutationTarget, {
                attributeOldValue: true,
                attributes: true,
                childList: true,
                subtree: true,
              });

              const renderCompletion = new Promise((resolveRender) => {
                const unsubscribe = trackerInstance.on('sync:end', () => {
                  unsubscribe();
                  resolveRender();
                });
              });
              const startedAt = performance.now();

              operation();
              await renderCompletion;
              await Promise.resolve();

              const durationMs = performance.now() - startedAt;

              if (observer !== null) {
                mutations.push(...observer.takeRecords());
                observer.disconnect();
              }

              return { durationMs, mutations };
            }

            /**
             * Summarizes DOM mutations without retaining DOM nodes in the report.
             *
             * @param {MutationRecord[]} mutations - Collected mutation records.
             * @returns {{ attributeMutations: number, nodesAdded: number, nodesRemoved: number }} Summary.
             */
            function summarizeMutations(mutations) {
              return mutations.reduce(
                (summary, mutation) => {
                  if (mutation.type === 'attributes') {
                    summary.attributeMutations += 1;
                  } else {
                    summary.nodesAdded += mutation.addedNodes.length;
                    summary.nodesRemoved += mutation.removedNodes.length;
                  }

                  return summary;
                },
                { attributeMutations: 0, nodesAdded: 0, nodesRemoved: 0 },
              );
            }

            /**
             * Forces representative style and layout realization.
             *
             * @param {HTMLElement} root - Tracker root.
             * @param {HTMLElement[]} markerElements - Current rendered items.
             * @returns {{ durationMs: number, inspectedItems: number }} Measurement.
             */
            function realizeRepresentativeStyles(root, markerElements) {
              const representativeElements = [
                root,
                markerElements[0],
                markerElements[Math.floor(markerElements.length / 2)],
                markerElements.at(-1),
              ].filter((element, index, elements) => element !== undefined && elements.indexOf(element) === index);
              const startedAt = performance.now();

              representativeElements.forEach((element) => {
                const style = getComputedStyle(element);

                void style.backgroundColor;
                void style.opacity;
                void element.getBoundingClientRect();
              });

              return {
                durationMs: performance.now() - startedAt,
                inspectedItems: representativeElements.length,
              };
            }

            /**
             * Creates rules for one styling cost profile.
             *
             * @param {string} scenario - Styling profile name.
             * @param {number} recordTotal - Source record count.
             * @returns {Array<Record<string, unknown>>} Public Tracker rules.
             */
            function createScenarioRules(scenario, recordTotal) {
              if (scenario === 'external-categories') {
                return Array.from({ length: 4 }, (_, category) => ({
                  marker: {
                    attributes: { 'data-benchmark-category': String(category) },
                    className: 'benchmark-category-marker',
                  },
                  selector: `.benchmark-category-${category}`,
                }));
              }

              if (scenario === 'repeated-inline') {
                const colors = ['#dc2626', '#2563eb', '#059669', '#d97706'];

                return Array.from({ length: 4 }, (_, category) => ({
                  marker: {
                    cssVariables: {
                      '--rxtt-marker-bg': colors[category],
                      '--rxtt-marker-opacity': String(0.7 + category * 0.1),
                    },
                  },
                  selector: `.benchmark-category-${category}`,
                }));
              }

              if (scenario === 'unique-inline') {
                return Array.from({ length: recordTotal }, (_, index) => ({
                  marker: {
                    cssVariables: {
                      '--rxtt-marker-bg': `hsl(${index % 360} 70% 50%)`,
                      '--rxtt-marker-opacity': String(0.65 + (index % 35) / 100),
                    },
                  },
                  selector: `#benchmark-record-${index}`,
                }));
              }

              return [{ selector: '.benchmark-record' }];
            }

            /**
             * Runs one complete, self-contained measurement cycle.
             *
             * Every cycle builds its own source DOM and Tracker, applies the
             * same operation sequence to that fresh state, and removes both
             * again, so no measured operation is ever repeated against state an
             * earlier cycle already mutated and neither `patchOptions` call can
             * degenerate into a no-op.
             *
             * @param {boolean} instrumented - Whether to install work counters and observers.
             * @returns {Promise<Record<string, unknown>>} Cycle timings, invariants, and optional evidence.
             */
            async function runCycle(instrumented) {
              const { renderHost, sourceRoot } = createCycleDom(records);

              document.body.replaceChildren(sourceRoot, renderHost);
              probe = instrumented ? installInstrumentation(sourceRoot) : null;

              const tracker = new window.RXTTracker({
                options: {
                  a11y: { enabled: true, keyboard: true },
                  clustering: { enabled: clustered, threshold: 2 },
                  cssVariables: {
                    '--rxtt-marker-bg': '#2563eb',
                    '--rxtt-track-bg': '#e2e8f0',
                  },
                  diagnostics: { metrics: true, warnings: false },
                  marker: {
                    attributes: {},
                    className: '',
                    title: true,
                  },
                  updates: {
                    interval: { enabled: false },
                    mutation: { enabled: false },
                    resize: { enabled: false },
                    scroll: { enabled: false },
                  },
                },
                rules: createScenarioRules(styling, records),
              });

              try {
                const initialStartedAt = performance.now();

                tracker.mount({ renderHost, sourceRoot });

                const initialRenderMs = performance.now() - initialStartedAt;
                const root = tracker.root;

                if (!(root instanceof HTMLElement) || tracker.mounted !== true) {
                  throw new Error('Styled Light DOM benchmark failed to mount Tracker.');
                }

                const initialMarkerElements = [...root.querySelectorAll('.rxtt__marker')];
                const initialKeys = new Map(
                  initialMarkerElements.map((element) => [element.getAttribute('data-rxtt-key'), element]),
                );
                const initialStyleRealization = realizeRepresentativeStyles(root, initialMarkerElements);
                const setupCounters = takeWorkCounters();
                const rootStyleStatsBefore = tracker.getStats();
                const rootStyleUpdate = await measureOperation(
                  () => {
                    tracker.patchOptions({
                      cssVariables: {
                        '--rxtt-marker-bg': '#7c3aed',
                        '--rxtt-track-bg': '#cbd5e1',
                      },
                    });
                  },
                  tracker,
                  instrumented ? renderHost : null,
                );
                const rootStyleRealization = realizeRepresentativeStyles(root, initialMarkerElements);
                const rootStyleStatsAfter = tracker.getStats();
                const rootStyleCounters = takeWorkCounters();
                const markerPresentationStatsBefore = tracker.getStats();
                const markerPresentationUpdate = await measureOperation(
                  () => {
                    tracker.patchOptions({
                      marker: {
                        attributes: {
                          'data-benchmark-extra': 'updated',
                          'data-benchmark-presentation': 'updated',
                        },
                        className: 'benchmark-global-marker benchmark-global-marker--updated',
                        title: false,
                      },
                    });
                  },
                  tracker,
                  instrumented ? renderHost : null,
                );
                const currentMarkerElements = [...root.querySelectorAll('.rxtt__marker')];
                const markerPresentationRealization = realizeRepresentativeStyles(root, currentMarkerElements);
                const markerPresentationStatsAfter = tracker.getStats();
                const markerPresentationCounters = takeWorkCounters();
                const selectionMutations = [];
                const selectionObserver =
                  probe === null
                    ? null
                    : new MutationObserver((recordsList) => {
                        selectionMutations.push(...recordsList);
                      });
                let selectionSnapshotDeliveredAt = null;
                let unsubscribeSelectionSnapshot = null;

                selectionObserver?.observe(root, {
                  attributeFilter: ['data-rxtt-selected'],
                  attributes: true,
                  subtree: true,
                });

                if (probe !== null) {
                  unsubscribeSelectionSnapshot = tracker.subscribeSnapshot(() => {
                    if (probe !== null && probe.activeSelectionRoot !== null) {
                      selectionSnapshotDeliveredAt = performance.now();
                    }
                  });
                }

                const selectionStatsBefore = tracker.getStats();

                if (probe !== null) {
                  probe.activeSelectionRoot = root;
                }

                const selectionStartedAt = performance.now();

                root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));

                if (probe !== null) {
                  probe.activeSelectionRoot = null;
                }

                await Promise.resolve();

                const selectionUpdateMs = performance.now() - selectionStartedAt;
                const selectionStatsAfter = tracker.getStats();

                if (selectionObserver !== null) {
                  selectionMutations.push(...selectionObserver.takeRecords());
                  selectionObserver.disconnect();
                }

                unsubscribeSelectionSnapshot?.();

                const selectedNodes = root.querySelectorAll('[data-rxtt-selected="true"]').length;
                const snapshot = tracker.getSnapshot();
                const teardownStartedAt = performance.now();

                tracker.destroy();

                const teardownDurationMs = performance.now() - teardownStartedAt;
                const retainedMarkerNodes = renderHost.querySelectorAll('.rxtt__marker').length;

                if (root.shadowRoot !== null) {
                  throw new Error('Vanilla rendered an unexpected ShadowRoot.');
                }

                if (
                  rootStyleStatsAfter.lastRender?.target !== 'track' ||
                  markerPresentationStatsAfter.lastRender?.target !== 'marker-presentation'
                ) {
                  throw new Error('A styling update did not execute the expected Core render path.');
                }

                if (
                  typeof rootStyleStatsAfter.lastRender.duration !== 'number' ||
                  typeof markerPresentationStatsAfter.lastRender.duration !== 'number'
                ) {
                  throw new Error('Core render duration was unavailable for a styling update.');
                }

                if (selectedNodes !== 1) {
                  throw new Error('Keyboard selection did not leave exactly one selected node.');
                }

                if (!Object.isFrozen(snapshot)) {
                  throw new Error('Snapshot was not frozen.');
                }

                if (retainedMarkerNodes !== 0) {
                  throw new Error('Tracker teardown retained rendered marker nodes.');
                }

                let evidence = null;

                if (probe !== null) {
                  const markerPresentationMutatedNodes = new Set(
                    markerPresentationUpdate.mutations
                      .filter(
                        (mutation) =>
                          mutation.type === 'attributes' &&
                          mutation.target instanceof HTMLElement &&
                          mutation.target.classList.contains('rxtt__marker'),
                      )
                      .map((mutation) => mutation.target),
                  ).size;

                  evidence = {
                    markerPresentation: {
                      ...summarizeMutations(markerPresentationUpdate.mutations),
                      geometryReads: markerPresentationCounters.geometryReads,
                      markerNodes: currentMarkerElements.length,
                      markerNodesMutated: markerPresentationMutatedNodes,
                      renderPasses:
                        markerPresentationStatsAfter.renders.started - markerPresentationStatsBefore.renders.started,
                      reusedMarkerNodes: currentMarkerElements.filter(
                        (element) => initialKeys.get(element.getAttribute('data-rxtt-key')) === element,
                      ).length,
                      sourceQueries: markerPresentationCounters.sourceQueries,
                    },
                    rootStyle: {
                      ...summarizeMutations(rootStyleUpdate.mutations),
                      geometryReads: rootStyleCounters.geometryReads,
                      renderPasses: rootStyleStatsAfter.renders.started - rootStyleStatsBefore.renders.started,
                      sourceQueries: rootStyleCounters.sourceQueries,
                    },
                    selection: {
                      markerMapLookups: probe.markerMapLookups,
                      postDomWriteToSnapshotDeliveryMs:
                        selectionSnapshotDeliveredAt === null || probe.selectionLastDomWriteAt === null
                          ? null
                          : selectionSnapshotDeliveredAt - probe.selectionLastDomWriteAt,
                      renderPasses: selectionStatsAfter.renders.started - selectionStatsBefore.renders.started,
                      selectedAttributeWriteDurationMs: probe.selectedAttributeWriteDurationMs,
                      selectedAttributeWrites: probe.selectedAttributeWrites,
                      touchedNodes: new Set(selectionMutations.map((mutation) => mutation.target)).size,
                    },
                    setup: {
                      geometryReads: setupCounters.geometryReads,
                      inspectedItems: initialStyleRealization.inspectedItems,
                      sourceQueries: setupCounters.sourceQueries,
                    },
                  };
                }

                return {
                  evidence,
                  invariants: {
                    lightDom: root.shadowRoot === null,
                    markerPresentationRenderTarget: markerPresentationStatsAfter.lastRender.target,
                    rootStyleRenderTarget: rootStyleStatsAfter.lastRender.target,
                    selectedNodes,
                    snapshotFrozen: true,
                    teardownReleasedMarkerNodes: retainedMarkerNodes === 0,
                  },
                  renderedItems: initialMarkerElements.length,
                  snapshotItemCount: snapshot.items.length,
                  timings: {
                    markerPresentation: {
                      completionMs: markerPresentationUpdate.durationMs,
                      coreRenderDurationMs: markerPresentationStatsAfter.lastRender.duration,
                      styleAndLayoutRealizationMs: markerPresentationRealization.durationMs,
                    },
                    rootStyle: {
                      completionMs: rootStyleUpdate.durationMs,
                      coreRenderDurationMs: rootStyleStatsAfter.lastRender.duration,
                      styleAndLayoutRealizationMs: rootStyleRealization.durationMs,
                    },
                    selection: { updateMs: selectionUpdateMs },
                    setup: {
                      initialRenderMs,
                      styleAndLayoutRealizationMs: initialStyleRealization.durationMs,
                    },
                    teardownDurationMs,
                  },
                };
              } finally {
                if (!tracker.destroyed) {
                  tracker.destroy();
                }

                if (instrumented) {
                  uninstallInstrumentation();
                }

                probe = null;
                sourceRoot.remove();
                renderHost.remove();
              }
            }

            for (let index = 0; index < warmupCount; index += 1) {
              await runCycle(false);
            }

            const cycles = [];

            for (let index = 0; index < sampleCount; index += 1) {
              cycles.push(await runCycle(false));
            }

            const instrumented = await runCycle(true);

            [...cycles, instrumented].forEach((cycle) => {
              if (
                cycle.renderedItems !== cycles[0].renderedItems ||
                cycle.snapshotItemCount !== cycles[0].snapshotItemCount
              ) {
                throw new Error(
                  'Styled Light DOM cycles rendered different state, so they are not equivalent samples.',
                );
              }
            });

            return {
              clustered,
              instrumented,
              invariants: instrumented.invariants,
              records,
              renderedItems: cycles[0].renderedItems,
              samples: cycles.map((cycle) => cycle.timings),
              snapshotItemCount: cycles[0].snapshotItemCount,
              styleScenario: styling,
            };
          },
          {
            clustered: clusteringEnabled,
            records: recordCount,
            sampleCount: SAMPLE_COUNT,
            styling: styleScenario,
            warmupCount: WARMUP_COUNT,
          },
        ),
      );
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
      clusteringModes: CLUSTERING_MODES,
      cycleStructure:
        'A cell is a series of independent cycles. Each cycle builds its own source DOM and its own Tracker, then mounts, patches root CSS variables, patches marker presentation, dispatches an ArrowDown selection, and destroys, before removing its DOM again. No measured operation is repeated on state an earlier cycle mutated, so neither patchOptions call degenerates into a no-op. Warm-up cycles are discarded whole and leave no residue.',
      instrumentationPass:
        'Timed cycles run on unpatched prototypes, with an unwrapped querySelectorAll and no MutationObserver attached, so their durations contain production work only. Every work counter comes from one additional instrumented cycle executed last, after all timed cycles, and is published as diagnostics.',
      recordCounts: RECORD_COUNTS,
      reportSemantics:
        'assertions hold the semantic outcome of a cycle: Light-DOM topology, the Core render target each styling update used, the selection result, the rendered and published item counts, and node release after destroy. Work counters (source queries, geometry reads, node churn, keyed lookups, attribute writes, mutation summaries) are diagnostics and gate nothing.',
      sampleCount: SAMPLE_COUNT,
      smoke: arguments_.smoke,
      styleScenarios: ITEM_STYLE_SCENARIOS,
      timingAggregate: 'min/median/max across the timed cycles of a cell; the median is the primary value.',
      timingScope:
        'setup.initialRenderMs covers mount(); the styling metrics cover patchOptions() up to the completed render; selection.updateMs covers the dispatched keydown and the microtask that settles it, and is the only comparable selection timing; teardownDurationMs covers destroy(). Every published metric is aggregated across the clean timed cycles. selection.postDomWriteToSnapshotDeliveryMs - the interval between the last selected-attribute DOM write and snapshot delivery - structurally requires the write instrumentation and is therefore a single observation from the instrumented cycle, published under diagnostics.instrumentedCycle rather than as a metric.',
      warmupCount: WARMUP_COUNT,
    },
    notes: {
      budgetsAreInformational: true,
      forcedStyleReadsAreRepresentative: true,
      snapshotIsObservedThroughTheSupportedFacade: true,
    },
    results: results.map(createReportResult),
  };
  const savedReport = await writeBenchmarkReports('styled-light-dom-browser', report, arguments_);

  console.log('Styled Light DOM browser benchmark (informational; no CI budgets)');

  results.forEach((result) => {
    const initialRenderMs = median(result.samples.map((sample) => sample.setup.initialRenderMs));
    const rootStyleMs = median(result.samples.map((sample) => sample.rootStyle.completionMs));
    const markerPresentationMs = median(result.samples.map((sample) => sample.markerPresentation.completionMs));
    const selectionMs = median(result.samples.map((sample) => sample.selection.updateMs));

    console.log(
      `${result.records.toLocaleString('en-US')} records, ${result.styleScenario}, clustering ${result.clustered ? 'on' : 'off'}: initial ${formatDuration(initialRenderMs)}, root style ${formatDuration(rootStyleMs)}, marker presentation ${formatDuration(markerPresentationMs)}, selection ${formatDuration(selectionMs)}, rendered items ${result.renderedItems.toLocaleString('en-US')} (medians of ${String(result.samples.length)} cycles)`,
    );
  });

  console.log(`Report: ${savedReport.json}`);
  console.log(`Report: ${savedReport.csv}`);
} finally {
  await browser.close();
  await server.close();
}
