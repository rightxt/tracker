import { EVENT_NAMES } from '../events/eventNames.js';
import { TrackerLifecycleError } from '../errors.js';
import { createRetainedDiagnosticValue } from '../utils/diagnostic.js';
import { cloneValue, hasOwn } from '../utils/object.js';
import type {
  TrackerDiagnosticCode,
  TrackerDiagnosticsSink,
  TrackerEventName,
  TrackerEventPayloadMap,
  TrackerRenderStatsSummary,
  TrackerStats,
} from '../types.js';

interface EventEmitterLike {
  emit: <TEventName extends TrackerEventName>(
    eventName: TEventName,
    payload?: TrackerEventPayloadMap[TEventName],
  ) => void;
}

interface DiagnosticEntry {
  /** Diagnostic code. */
  code: TrackerDiagnosticCode;
  /** Additional diagnostic details. */
  details: Record<string, unknown> | null;
  /** Human-readable message. */
  message: string;
}

interface DiagnosticsOptions {
  /** Whether non-hot-path metrics are collected. */
  metrics?: boolean;
  /**
   * Whether warnings are written to console.warn. Affects console output only:
   * warning stats and `warning` events are always produced, and errors are
   * always written to console.error.
   */
  warnings?: boolean;
  output?: TrackerDiagnosticsSink | null;
}

interface DiagnosticsRenderCounts {
  /** Current cluster count. */
  clusters?: number;
  /** Current marker count. */
  markers?: number;
}

interface DiagnosticsContext {
  /** Event emitter. */
  events?: EventEmitterLike | null;
  /** Diagnostics options. */
  options?: DiagnosticsOptions;
}

/** Recursively mutable internal view of the readonly public stats contract. */
type MutableStatsValue<T> = T extends readonly (infer TItem)[]
  ? MutableStatsValue<TItem>[]
  : T extends object
    ? { -readonly [TKey in keyof T]: MutableStatsValue<T[TKey]> }
    : T;

/** Private accumulator shape; callers only receive detached readonly snapshots. */
type MutableTrackerStats = MutableStatsValue<TrackerStats>;

/**
 * Creates the base stats object.
 *
 * @returns Initial stats.
 */
function createInitialStats(): MutableTrackerStats {
  return {
    clusters: {
      current: 0,
    },
    errors: {
      byCode: {},
      last: null,
      total: 0,
    },
    lastRender: null,
    markers: {
      created: 0,
      current: 0,
      removed: 0,
    },
    observers: {
      interval: 0,
      mutation: 0,
      resize: 0,
      scroll: 0,
    },
    renders: {
      cancelled: 0,
      completed: 0,
      requested: 0,
      skipped: 0,
      started: 0,
    },
    rules: {
      added: 0,
      cleared: 0,
      duplicates: 0,
      rejected: 0,
      removed: 0,
    },
    warnings: {
      byCode: {},
      last: null,
      total: 0,
    },
  };
}

/**
 * Increments a counter stored in a plain object.
 *
 * @param counters - Counter object.
 * @param key - Counter key.
 */
function incrementCounter(counters: Record<string, number>, key: string): void {
  counters[key] = (counters[key] || 0) + 1;
}

/**
 * Returns a safe diagnostic details object.
 *
 * @param details - Diagnostic details candidate.
 * @returns Details object or null.
 */
function normalizeDetails(details: unknown): Record<string, unknown> | null {
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
}

/** Maximum warning publications delivered in one synchronous reentrant batch. */
const MAX_WARNING_EMISSIONS_PER_BATCH = 1000;

/** Executes optional diagnostic output without affecting runtime control flow. */
function reportOutput(operation: () => unknown): void {
  try {
    const result: unknown = operation();

    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      (result as PromiseLike<unknown>).then(undefined, () => {
        // Diagnostics output is best-effort and must not replace the original operation failure.
      });
    }
  } catch {
    // Diagnostics output is best-effort and must not replace the original operation failure.
  }
}

/**
 * Basic diagnostics layer used by the main build.
 *
 * The class keeps runtime validation messages, lightweight counters and public
 * stats snapshots. Expensive timings are collected only when metrics are enabled
 * by higher-level code.
 *
 * Detail retention policy is hybrid: console output and `warning` events
 * receive original detail references for live debugging, while stats store
 * retained-safe copies so long-lived stats snapshots do not keep DOM nodes,
 * events or other external object graphs alive.
 */
class Diagnostics {
  /**
   * Event emitter used for public warning events.
   */
  #events: EventEmitterLike | null = null;

  /**
   * Diagnostics options.
   */
  #options: { metrics: boolean; warnings: boolean; output: DiagnosticsOptions['output'] } = {
    metrics: false,
    output: null,
    warnings: true,
  };

  /**
   * Mutable internal stats.
   */
  #stats: MutableTrackerStats = createInitialStats();

  /**
   * True while `warn()` is iterating `#pendingWarningEmissions`.
   *
   * A `warning` handler that synchronously triggers another warning would
   * otherwise recurse through `warn()` and `EventEmitterLike#emit` until the
   * call stack overflows. Reentrant calls append to the pending queue instead
   * of recursing, and the outer call drains it iteratively.
   */
  #emittingWarnings = false;

  /**
   * Warning entries awaiting `warning` event dispatch, in publication order.
   */
  #pendingWarningEmissions: DiagnosticEntry[] = [];

  /** Monotonic revision of warning and error statistics. */
  #revision = 0;

  /**
   * @param context - Event emitter used for `warning` events and initial
   * diagnostics options. The emitter reference is retained until destroy();
   * invalid option values are ignored. No listeners are attached.
   */
  constructor(context: DiagnosticsContext = {}) {
    const { events = null, options = {} } = context;

    this.#events = events ?? null;
    this.updateOptions(options);
  }

  /**
   * Indicates whether timing metrics are enabled.
   *
   * @returns True when metrics are enabled.
   */
  get metricsEnabled(): boolean {
    return this.#options.metrics;
  }

  /**
   * Returns the warning/error revision used to repair cached snapshots.
   *
   * @returns Current diagnostics revision.
   */
  get revision(): number {
    return this.#revision;
  }

  /**
   * Creates a normalized diagnostic entry.
   *
   * @param code - Diagnostic code.
   * @param message - Diagnostic message.
   * @param details - Diagnostic details.
   * @returns Diagnostic entry.
   */
  #createEntry(code: TrackerDiagnosticCode, message: string, details: unknown): DiagnosticEntry {
    return {
      code: typeof code === 'string' && code.length > 0 ? code : 'unknown',
      details: normalizeDetails(details),
      message: typeof message === 'string' && message !== '' ? message : 'Tracker diagnostic message.',
    };
  }

  /**
   * Creates a retained-safe entry copy stored in stats.
   *
   * @param entry - Original diagnostic entry.
   * @returns Entry copy with retention-safe details.
   */
  #createRetainedEntry(entry: DiagnosticEntry): DiagnosticEntry {
    return {
      ...entry,
      details: entry.details ? (createRetainedDiagnosticValue(entry.details) as Record<string, unknown>) : null,
    };
  }

  /**
   * Releases event and diagnostic detail references after permanent destroy.
   */
  destroy(): void {
    this.#events = null;
    this.#pendingWarningEmissions.length = 0;
    this.#options.output = null;
    this.#stats.warnings.last = null;
    this.#stats.errors.last = null;
    this.#stats.lastRender = null;
  }

  /**
   * Registers and prints an error.
   *
   * Configuration errors are recorded without throwing by default so the caller
   * can preserve the previous valid state.
   *
   * @param code - Error code.
   * @param message - Error message.
   * @param details - Additional error details.
   */
  error(code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown> | null): void {
    const entry = this.#createEntry(code, message, details);

    this.#stats.errors.total += 1;
    this.#stats.errors.last = this.#createRetainedEntry(entry);
    incrementCounter(this.#stats.errors.byCode, entry.code);
    this.#revision += 1;

    if (typeof this.#options.output?.error === 'function') {
      reportOutput(() => this.#options.output!.error!(entry.code, entry.message, entry.details ?? undefined));
    } else if (entry.details) {
      console.error(entry.message, entry.details);
    } else {
      console.error(entry.message);
    }
  }

  /**
   * Returns a snapshot of current diagnostics stats.
   *
   * @returns Stats snapshot.
   */
  getStats(): TrackerStats {
    return cloneValue(this.#stats);
  }

  /**
   * Increments a marker lifecycle counter.
   *
   * Unknown counter names are ignored.
   *
   * @param counterName - Marker lifecycle counter.
   * @param amount - Increment amount.
   */
  recordMarker(counterName: 'created' | 'removed', amount = 1): void {
    if (!hasOwn(this.#stats.markers, counterName)) {
      return;
    }

    this.#stats.markers[counterName] += Math.max(0, Number(amount) || 0);
  }

  /**
   * Increments a named observer counter.
   *
   * Unknown observer names are ignored.
   *
   * @param observerName - Observer counter name.
   */
  recordObserverEvent(observerName: 'mutation' | 'resize' | 'scroll' | 'interval'): void {
    if (!hasOwn(this.#stats.observers, observerName)) {
      return;
    }

    this.#stats.observers[observerName] += 1;
  }

  /**
   * Records a cancelled render.
   */
  recordRenderCancelled(): void {
    this.#stats.renders.cancelled += 1;
  }

  /**
   * Records a completed render and stores its summary.
   *
   * @param summary - Render summary.
   */
  recordRenderCompleted(summary: Partial<TrackerRenderStatsSummary> = {}): void {
    this.#stats.renders.completed += 1;
    this.#stats.lastRender = cloneValue(summary) as MutableStatsValue<TrackerRenderStatsSummary>;
  }

  /**
   * Records a render request.
   */
  recordRenderRequested(): void {
    this.#stats.renders.requested += 1;
  }

  /**
   * Records a skipped render.
   */
  recordRenderSkipped(): void {
    this.#stats.renders.skipped += 1;
  }

  /**
   * Records a render start.
   */
  recordRenderStarted(): void {
    this.#stats.renders.started += 1;
  }

  /**
   * Increments a rule counter.
   *
   * Unknown counter names are ignored.
   *
   * @param counterName - Rule counter.
   * @param amount - Increment amount.
   */
  recordRule(counterName: 'added' | 'removed' | 'cleared' | 'rejected' | 'duplicates', amount = 1): void {
    if (!hasOwn(this.#stats.rules, counterName)) {
      return;
    }

    this.#stats.rules[counterName] += Math.max(0, Number(amount) || 0);
  }

  /**
   * Restores rule counters captured before a transactional rule mutation.
   *
   * @param counters - Previous rule counter snapshot.
   */
  restoreRuleCounters(counters: TrackerStats['rules']): void {
    this.#stats.rules = cloneValue(counters) as MutableTrackerStats['rules'];
  }

  /**
   * Restores marker and cluster counters captured before a failed render.
   *
   * @param markers - Previous marker counters.
   * @param clusters - Previous cluster counters.
   */
  restoreMarkerCounters(markers: TrackerStats['markers'], clusters: TrackerStats['clusters']): void {
    this.#stats.markers = cloneValue(markers) as MutableTrackerStats['markers'];
    this.#stats.clusters = cloneValue(clusters) as MutableTrackerStats['clusters'];
  }

  /**
   * Resets counters and metrics.
   */
  resetStats(): void {
    this.#stats = createInitialStats();
    this.#revision += 1;
  }

  /**
   * Replaces diagnostics behavior from its defaults.
   *
   * Invalid option values are ignored after the previous configuration has
   * been cleared.
   *
   * @param options - Diagnostics options.
   */
  replaceOptions(options: DiagnosticsOptions = {}): void {
    this.#options = {
      metrics: false,
      output: null,
      warnings: true,
    };
    this.updateOptions(options);
  }

  /**
   * Updates current marker and cluster counters.
   */
  setCurrentRenderCounts({ markers, clusters }: DiagnosticsRenderCounts): void {
    if (Number.isInteger(markers) && markers! >= 0) {
      this.#stats.markers.current = markers!;
    }

    if (Number.isInteger(clusters) && clusters! >= 0) {
      this.#stats.clusters.current = clusters!;
    }
  }

  /**
   * Updates diagnostics behavior.
   *
   * Invalid option values are ignored.
   *
   * @param options - Diagnostics options.
   */
  updateOptions(options: DiagnosticsOptions = {}): void {
    if (typeof options.warnings === 'boolean') {
      this.#options.warnings = options.warnings;
    }

    if (typeof options.metrics === 'boolean') {
      this.#options.metrics = options.metrics;
    }

    if (options.output === null || (options.output !== undefined && typeof options.output === 'object')) {
      this.#options.output = options.output;
    }
  }

  /**
   * Registers and optionally prints a warning.
   *
   * A `warning` handler that reentrantly triggers another warning is
   * dispatched after the in-progress `warning` event finishes instead of
   * recursing. If a single reentrant chain exceeds
   * `MAX_WARNING_EMISSIONS_PER_BATCH`, the remaining pending warnings are
   * dropped and this throws {@link TrackerLifecycleError} with code
   * `ERR_TRACKER_REENTRANCY_LIMIT`.
   *
   * @param code - Warning code.
   * @param message - Warning message.
   * @param details - Additional warning details.
   * @throws {TrackerLifecycleError} When a reentrant warning feedback loop exceeds the batch limit.
   */
  warn(code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown> | null): void {
    const entry = this.#createEntry(code, message, details);

    this.#stats.warnings.total += 1;
    this.#stats.warnings.last = this.#createRetainedEntry(entry);
    incrementCounter(this.#stats.warnings.byCode, entry.code);
    this.#revision += 1;

    this.#pendingWarningEmissions.push(entry);

    if (this.#emittingWarnings) {
      return;
    }

    this.#emittingWarnings = true;

    try {
      for (let index = 0; index < this.#pendingWarningEmissions.length; index += 1) {
        if (index >= MAX_WARNING_EMISSIONS_PER_BATCH) {
          const droppedEmissions = this.#pendingWarningEmissions.length - index;

          this.error(
            'ERR_TRACKER_REENTRANCY_LIMIT',
            'Tracker stopped a non-terminating warning publication feedback loop.',
            {
              droppedEmissions,
              processedEmissions: index,
            },
          );
          throw new TrackerLifecycleError('Tracker stopped a non-terminating warning publication feedback loop.', {
            code: 'ERR_TRACKER_REENTRANCY_LIMIT',
          });
        }

        const pendingEntry = this.#pendingWarningEmissions[index];

        if (typeof this.#options.output?.warn === 'function') {
          reportOutput(() =>
            this.#options.output!.warn!(pendingEntry.code, pendingEntry.message, pendingEntry.details ?? undefined),
          );
        } else if (this.#options.warnings) {
          if (pendingEntry.details) {
            console.warn(pendingEntry.message, pendingEntry.details);
          } else {
            console.warn(pendingEntry.message);
          }
        }

        this.#events?.emit(EVENT_NAMES.WARNING, pendingEntry);
      }
    } finally {
      this.#pendingWarningEmissions.length = 0;
      this.#emittingWarnings = false;
    }
  }
}

export { Diagnostics, MAX_WARNING_EMISSIONS_PER_BATCH };
export type { DiagnosticEntry, DiagnosticsContext, DiagnosticsOptions, DiagnosticsRenderCounts };
