import { cloneValue } from '../utils/object.js';
import { createRetainedDiagnosticValue } from '../utils/diagnostic.js';
import type { TrackerDebugTraceEntry, TrackerStats } from '../types.js';
import { Diagnostics } from './Diagnostics.js';
import type { DiagnosticsContext } from './Diagnostics.js';

/**
 * Maximum number of trace entries retained.
 *
 * Not currently reachable through any public configuration path: nothing
 * constructs {@link DebugDiagnostics} with a caller-supplied limit, so this
 * stays a plain internal constant rather than exposed configuration surface.
 */
const TRACE_LIMIT = 100;

/**
 * Returns a monotonic timestamp when available.
 *
 * @returns Timestamp or null when performance API is unavailable.
 */
function getTimestamp(activeWindow: Window | null): number | null {
  if (activeWindow !== null && typeof activeWindow.performance?.now === 'function') {
    return activeWindow.performance.now();
  }

  if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
    return null;
  }

  return performance.now();
}

/**
 * Debug-build Diagnostics extension that adds trace entries and optional timings.
 *
 * It is diagnostic-only and should not affect production runtime logic.
 */
class DebugDiagnostics extends Diagnostics {
  /** Window that owns debug timestamp measurements. */
  #clockWindow: Window | null = typeof globalThis.window === 'undefined' ? null : globalThis.window;

  /** Retained debug trace entries, capped at `TRACE_LIMIT` by `trace()`. */
  #trace: TrackerDebugTraceEntry[] = [];

  /**
   * Updates the window used for debug timestamps.
   *
   * @param activeWindow - Mounted runtime window, or null while unmounted.
   */
  updateClockWindow(activeWindow: Window | null): void {
    this.#clockWindow = activeWindow;
  }

  /** Clears retained trace entries without resetting base diagnostics stats. */
  clearTrace(): void {
    this.#trace = [];
  }

  /**
   * Returns a stats snapshot with debug trace metadata.
   *
   * @returns Stats snapshot.
   */
  getStats(): TrackerStats {
    return {
      ...super.getStats(),
      debug: {
        traceLength: this.#trace.length,
        traceLimit: TRACE_LIMIT,
      },
    };
  }

  /**
   * Returns a snapshot of recent trace entries.
   *
   * @returns Trace snapshot.
   */
  getTrace(): TrackerDebugTraceEntry[] {
    return cloneValue(this.#trace);
  }

  /**
   * Resets base stats and debug trace entries.
   */
  resetStats(): void {
    super.resetStats();
    this.clearTrace();
  }

  /**
   * Releases base diagnostics references and debug trace entries.
   */
  destroy(): void {
    super.destroy();
    this.#clockWindow = null;
    this.clearTrace();
  }

  /**
   * Adds a debug trace entry.
   *
   * The payload is converted through the same retention-safe sanitization used for
   * warning/error details, so DOM nodes, events, and other object graphs are stored
   * as compact descriptions instead of live references.
   *
   * @param type - Trace entry type.
   * @param payload - Trace payload.
   */
  trace(type: string, payload: Record<string, unknown> = {}): void {
    const entry: TrackerDebugTraceEntry = {
      payload: createRetainedDiagnosticValue(payload) as Record<string, unknown>,
      timestamp: getTimestamp(this.#clockWindow),
      type: typeof type === 'string' && type !== '' ? type : 'unknown',
    };

    this.#trace.push(entry);

    if (this.#trace.length > TRACE_LIMIT) {
      this.#trace.splice(0, this.#trace.length - TRACE_LIMIT);
    }
  }
}

export { DebugDiagnostics };
export type { DiagnosticsContext };
