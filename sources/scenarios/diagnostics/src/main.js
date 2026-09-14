import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';
import './shared/base.css';
import './styles.css';

/** Root of the static diagnostics dashboard. */
const root = document.querySelector('#diagnostics-scenario');
if (!(root instanceof HTMLElement)) {
  throw new Error('Diagnostics scenario root is missing.');
}

/** Tracked source content for the main runtime. */
const fixture = requireElement('#diagnostic-fixture');
/** Warning event result. */
const warningEventOutput = requireElement('#warning-event');
/** Warning sink result. */
const warningSinkOutput = requireElement('#warning-sink');
/** Retained warning statistics. */
const warningStatsOutput = requireElement('#warning-stats');
/** Warning detail ownership comparison. */
const warningOwnershipOutput = requireElement('#warning-ownership');
/** Resolver diagnostics sink result. */
const resolverSinkOutput = requireElement('#resolver-sink');
/** Resolver experiment result. */
const resolverResultOutput = requireElement('#resolver-result');
/** Retained error statistics. */
const errorStatsOutput = requireElement('#error-stats');
/** Invalid-configuration exception result. */
const configurationErrorOutput = requireElement('#configuration-error');
/** Invalid-configuration atomicity result. */
const atomicResultOutput = requireElement('#atomic-result');
/** Lifecycle exception result. */
const lifecycleErrorOutput = requireElement('#lifecycle-error');
/** Lifecycle experiment sequence. */
const lifecycleResultOutput = requireElement('#lifecycle-result');
/** Main runtime status. */
const runtimeStatus = requireElement('#runtime-status');
/** Debug-build statistics. */
const debugStatsOutput = requireElement('#debug-stats');

/** Warning sink calls retained by the demo UI. */
const warningSinkEntries = [];
/** Resolver-error sink calls retained by the demo UI. */
const resolverSinkEntries = [];
/** Number of successfully completed main-runtime synchronizations. */
let successfulSyncs = 0;

/** Public diagnostics sink used by the main Tracker. */
const diagnosticsSink = {
  warn: (code, message, details) => recordSink('warn', code, message, details),
  error: (code, message, details) => recordSink('error', code, message, details),
};

/** Normal mutation observer configuration restored after warning experiments. */
const normalMutation = { debounce: 0, enabled: true, targets: () => [fixture] };
/** Normal rule set restored after the one-shot resolver experiment. */
const normalRules = [
  { selector: '.diagnostic-target--safe', label: (element) => element.textContent?.trim() ?? null },
  { selector: '.diagnostic-target--failure', label: 'Resolver target' },
];

/** Main diagnostics runtime; all experiments restore this configuration. */
const tracker = new Tracker({
  options: {
    a11y: { enabled: true, keyboard: true, label: 'Diagnostics demo tracker' },
    diagnostics: { metrics: true, output: diagnosticsSink, warnings: true },
    updates: {
      interval: { enabled: false },
      mutation: normalMutation,
      resize: { debounce: 0, enabled: true },
      scroll: { enabled: true },
    },
  },
  rules: normalRules,
});

tracker.on('warning', (payload) => {
  const retainedDetails = tracker.getStats().warnings.last?.details ?? null;
  warningEventOutput.textContent = JSON.stringify(compactDiagnostic(payload), null, 2);
  warningOwnershipOutput.textContent = JSON.stringify(
    {
      eventDetails: compactDetails(payload.details),
      retainedStatsDetails: retainedDetails,
      sameObjectIdentity: payload.details === retainedDetails,
    },
    null,
    2,
  );
  queueMicrotask(updateStats);
});
tracker.on('sync:end', () => {
  successfulSyncs += 1;
  queueMicrotask(updateStats);
});
tracker.mount({ renderHost: document.body, sourceRoot: fixture });
updateStats();

root.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const actions = {
    invalid: runInvalidConfiguration,
    lifecycle: runLifecycleError,
    resolver: runResolverFailure,
    warning: () => triggerObserverWarning(true),
    'warning-muted': () => triggerObserverWarning(false),
  };
  actions[button.dataset.action]?.();
});

/**
 * Publishes one real observer warning and restores diagnostics and observer state.
 *
 * `diagnostics.warnings` controls console fallback, while a configured sink is
 * independent. The muted experiment therefore temporarily removes the sink too.
 *
 * @param {boolean} outputEnabled Whether the warning should reach the configured sink.
 */
function triggerObserverWarning(outputEnabled) {
  const callsBefore = warningSinkEntries.length;
  try {
    tracker.patchOptions(
      {
        diagnostics: { output: outputEnabled ? diagnosticsSink : null, warnings: outputEnabled },
        updates: { mutation: { debounce: 0, enabled: true, targets: () => [] } },
      },
      { render: false },
    );
  } finally {
    tracker.patchOptions(
      {
        diagnostics: { metrics: true, output: diagnosticsSink, warnings: true },
        updates: { mutation: normalMutation },
      },
      { render: false },
    );
    updateStats();
  }
  const callsAfter = warningSinkEntries.length;
  const latestCall = warningSinkEntries.at(-1);
  warningSinkOutput.textContent = JSON.stringify(
    {
      outputEnabled,
      callsBefore,
      callsAfter,
      callsThisRun: callsAfter - callsBefore,
      historicalCalls: callsAfter,
      ...(outputEnabled
        ? { code: latestCall?.code ?? null, status: 'delivered for this experiment' }
        : { status: 'suppressed for this experiment' }),
    },
    null,
    2,
  );
}

/** Runs one failing label resolver and restores normal rules without rerunning it. */
function runResolverFailure() {
  const errorsBefore = tracker.getStats().errors.total;
  const sinkCallsBefore = resolverSinkEntries.length;
  try {
    tracker.replaceRules(
      [
        normalRules[0],
        {
          selector: '.diagnostic-target--failure',
          label() {
            throw new Error('Intentional label resolver failure');
          },
        },
      ],
      { render: false },
    );
    tracker.render();
    const stats = tracker.getStats();
    const markers = tracker.root?.querySelectorAll('.rxtt__marker[data-rxtt-kind="marker"]') ?? [];
    const failedMarker = [...markers].find((marker) => !marker.hasAttribute('title')) ?? null;
    resolverResultOutput.textContent = JSON.stringify(
      {
        errorCode: stats.errors.last?.code ?? null,
        errorsBefore,
        errorsAfter: stats.errors.total,
        errorsDelta: stats.errors.total - errorsBefore,
        markerCount: markers.length,
        markerRemainsTracked: markers.length === fixture.querySelectorAll('.diagnostic-target').length,
        label: failedMarker?.getAttribute('title') ?? null,
        sinkCallsDelta: resolverSinkEntries.length - sinkCallsBefore,
      },
      null,
      2,
    );
  } finally {
    tracker.replaceRules(normalRules, { render: false });
    updateStats();
  }
}

/** Demonstrates atomic rejection of an invalid public option candidate. */
function runInvalidConfiguration() {
  const before = configurationSummary();
  const syncsBefore = successfulSyncs;
  const attempted = { placement: 'diagonal' };
  try {
    tracker.patchOptions(attempted);
  } catch (error) {
    configurationErrorOutput.textContent = JSON.stringify(compactError(error, 'invalid configuration'), null, 2);
  }
  const after = configurationSummary();
  atomicResultOutput.textContent = JSON.stringify(
    {
      before,
      attempted,
      after,
      committedConfigurationUnchanged: JSON.stringify(before) === JSON.stringify(after),
      successfulSyncsBefore: syncsBefore,
      successfulSyncsAfter: successfulSyncs,
      syncRequestedByRejectedCandidate: successfulSyncs !== syncsBefore,
    },
    null,
    2,
  );
}

/** Demonstrates a terminal lifecycle error on a disposable secondary Tracker. */
function runLifecycleError() {
  const sequence = [];
  const secondarySource = document.createElement('div');
  const secondaryHost = document.createElement('div');
  secondarySource.hidden = true;
  secondaryHost.hidden = true;
  document.body.append(secondarySource, secondaryHost);
  const secondary = new Tracker({ rules: [] });
  try {
    sequence.push('secondary Tracker created');
    secondary.mount({ renderHost: secondaryHost, sourceRoot: secondarySource });
    sequence.push('secondary Tracker mounted');
    secondary.destroy();
    sequence.push('secondary Tracker destroyed');
    secondary.getOptions();
  } catch (error) {
    sequence.push('forbidden getOptions() rejected');
    lifecycleErrorOutput.textContent = JSON.stringify(
      compactError(error, 'accessor after destroy', { destroyed: secondary.destroyed, mounted: secondary.mounted }),
      null,
      2,
    );
  } finally {
    secondary.destroy();
    secondarySource.remove();
    secondaryHost.remove();
    lifecycleResultOutput.textContent = JSON.stringify({ mainRuntime: 'operational', sequence }, null, 2);
    updateStats();
  }
}

/** Refreshes retained stats and the visible main-runtime status. */
function updateStats() {
  const stats = tracker.getStats();
  warningStatsOutput.textContent = JSON.stringify(stats.warnings, null, 2);
  errorStatsOutput.textContent = JSON.stringify(stats.errors, null, 2);
  debugStatsOutput.textContent = JSON.stringify(
    { traceLength: stats.debug?.traceLength ?? null, traceLimit: stats.debug?.traceLimit ?? null },
    null,
    2,
  );
  runtimeStatus.textContent = `Main Tracker is ${tracker.mounted && !tracker.destroyed ? 'operational' : 'unavailable'}; markers=${String(stats.markers.current)}; successful synchronizations=${String(successfulSyncs)}.`;
  runtimeStatus.dataset.successfulSyncs = String(successfulSyncs);
}

/**
 * Records one sink call in its experiment-specific output.
 *
 * @param {'warn' | 'error'} level Diagnostic severity.
 * @param {string} code Diagnostic code.
 * @param {string} message Diagnostic message.
 * @param {unknown} details Borrowed diagnostic details.
 */
function recordSink(level, code, message, details) {
  if (level === 'warn') {
    const entry = { callNumber: warningSinkEntries.length + 1, level, code, message, details: compactDetails(details) };
    warningSinkEntries.push(entry);
    warningSinkOutput.textContent = JSON.stringify(entry, null, 2);
  } else {
    const entry = {
      callNumber: resolverSinkEntries.length + 1,
      level,
      code,
      message,
      details: compactDetails(details),
    };
    resolverSinkEntries.push(entry);
    resolverSinkOutput.textContent = JSON.stringify(entry, null, 2);
  }
}

/**
 * Creates a serializable warning/event summary.
 *
 * @param {object} entry Diagnostic event payload.
 * @returns {object} Compact diagnostic entry.
 */
function compactDiagnostic(entry) {
  return { code: entry.code, message: entry.message, details: compactDetails(entry.details) };
}

/**
 * Converts diagnostic details into retention-safe educational values.
 *
 * @param {unknown} details Borrowed diagnostic details.
 * @returns {object | null} Compact serializable details.
 */
function compactDetails(details) {
  if (details === undefined || details === null) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      value === null || ['boolean', 'number', 'string'].includes(typeof value)
        ? value
        : (value?.constructor?.name ?? typeof value),
    ]),
  );
}

/**
 * Returns the committed options relevant to the atomicity experiment.
 *
 * @returns {object} Stable configuration summary.
 */
function configurationSummary() {
  const options = tracker.getOptions();
  return {
    metrics: options.diagnostics.metrics,
    orientation: options.orientation,
    placement: options.placement,
    warnings: options.diagnostics.warnings,
  };
}

/**
 * Creates a serializable public exception summary.
 *
 * @param {unknown} error Caught public exception.
 * @param {string} boundary Operation that threw.
 * @param {object} [context] Additional lifecycle context.
 * @returns {object} Serializable exception summary.
 */
function compactError(error, boundary, context = {}) {
  return {
    boundary,
    name: error instanceof Error ? error.name : typeof error,
    code: error && typeof error === 'object' && 'code' in error ? error.code : null,
    message: error instanceof Error ? error.message : String(error),
    ...context,
  };
}

/**
 * Returns one required dashboard element.
 *
 * @param {string} selector Required selector within the scenario root.
 * @returns {HTMLElement} Matching dashboard element.
 */
function requireElement(selector) {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Diagnostics output is missing: ${selector}`);
  }
  return element;
}

window.addEventListener('pagehide', () => tracker.destroy(), { once: true });
