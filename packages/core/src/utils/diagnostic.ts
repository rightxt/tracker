import { cloneValue, isPlainObject } from './object.js';
import type { TrackerDiagnosticCode, TrackerStats, TrackerValidationDiagnostic } from '../types.js';

/** Maximum recursive depth retained in diagnostic detail snapshots. */
const DIAGNOSTIC_VALUE_MAX_DEPTH = 4;

/** Stable message used when an unknown object cannot be inspected safely. */
const UNKNOWN_ERROR_MESSAGE = 'Unknown error.';

interface TrackerValidationDiagnosticsSink {
  /** Warning reporter. */
  warn: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown> | null) => void;
  /** Error reporter. */
  error: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown> | null) => void;
}

/**
 * Dispatches validation diagnostics to a Diagnostics sink.
 *
 * Missing sinks are ignored so callers with optional diagnostics can dispatch
 * unconditionally.
 *
 * @param entries - Diagnostic entries.
 * @param diagnostics - Diagnostics sink.
 */
function dispatchDiagnostics(
  entries: TrackerValidationDiagnostic[],
  diagnostics: TrackerValidationDiagnosticsSink | null | undefined,
): void {
  if (!diagnostics) {
    return;
  }

  entries.forEach((entry) => {
    if (entry.type === 'error') {
      diagnostics.error(entry.code, entry.message, entry.details);
      return;
    }

    diagnostics.warn(entry.code, entry.message, entry.details);
  });
}

/**
 * Creates a validation diagnostic entry.
 *
 * @param type - Diagnostic type.
 * @param code - Diagnostic code.
 * @param message - Diagnostic message.
 * @param details - Diagnostic details.
 * @returns Diagnostic entry.
 */
function createDiagnostic(
  type: 'warning' | 'error',
  code: TrackerDiagnosticCode,
  message: string,
  details: Record<string, unknown> = {},
): TrackerValidationDiagnostic {
  return { type, code, message, details };
}

/**
 * Inspects a thrown value without invoking arbitrary object coercion.
 *
 * @param error - Thrown value.
 * @returns Safely classified Error identity and message.
 */
function inspectError(error: unknown): { error: Error | null; message: string } {
  if (error === null) {
    return { error: null, message: 'null' };
  }

  switch (typeof error) {
    case 'string':
      return { error: null, message: error };
    case 'undefined':
    case 'boolean':
    case 'bigint':
    case 'number':
    case 'symbol':
      return { error: null, message: String(error) };
    case 'object':
      try {
        if (error instanceof Error && typeof error.message === 'string') {
          return { error, message: error.message };
        }
      } catch {
        return { error: null, message: UNKNOWN_ERROR_MESSAGE };
      }

      return { error: null, message: UNKNOWN_ERROR_MESSAGE };
    default:
      return { error: null, message: UNKNOWN_ERROR_MESSAGE };
  }
}

/**
 * Converts a thrown value to a diagnostic-safe string without throwing.
 *
 * @param error - Thrown value.
 * @returns Error message.
 */
function getErrorMessage(error: unknown): string {
  return inspectError(error).message;
}

/**
 * Creates a copy of diagnostic detail data that can be retained after destroy.
 *
 * Plain data is copied recursively. Functions, DOM objects, events, errors and
 * other class instances are replaced with compact descriptions so final stats
 * do not keep external object graphs alive.
 *
 * @param value - Diagnostic detail value.
 * @param depth - Current recursion depth.
 * @returns Retained-safe diagnostic detail value.
 */
function createRetainedDiagnosticValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'function') {
    return '[Function]';
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (typeof Element !== 'undefined' && value instanceof Element) {
    const tagName = typeof value.tagName === 'string' ? value.tagName.toLowerCase() : 'element';
    const id = typeof value.id === 'string' && value.id !== '' ? `#${value.id}` : '';

    return `[Element ${tagName}${id}]`;
  }

  if (typeof Event !== 'undefined' && value instanceof Event) {
    return `[Event ${value.type || 'unknown'}]`;
  }

  if (typeof Node !== 'undefined' && value instanceof Node) {
    return `[Node ${value.nodeName || 'unknown'}]`;
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (depth >= DIAGNOSTIC_VALUE_MAX_DEPTH) {
    return '[MaxDepth]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => createRetainedDiagnosticValue(item, depth + 1));
  }

  if (!isPlainObject(value)) {
    return Object.prototype.toString.call(value);
  }

  return Object.entries(value).reduce<Record<string, unknown>>((result, [key, item]) => {
    result[key] = createRetainedDiagnosticValue(item, depth + 1);

    return result;
  }, {});
}

/**
 * Creates a retained-safe diagnostics stats snapshot.
 *
 * @param stats - Diagnostics stats snapshot.
 * @returns Retained-safe stats snapshot.
 */
function createRetainedDiagnosticStats(stats: TrackerStats): TrackerStats {
  const retainedStats = cloneValue(stats);

  for (const key of ['warnings', 'errors'] as const) {
    const lastEntry = retainedStats[key].last;

    if (!lastEntry) {
      continue;
    }

    (lastEntry as { details: Record<string, unknown> | null }).details = isPlainObject(lastEntry.details)
      ? (createRetainedDiagnosticValue(lastEntry.details) as Record<string, unknown>)
      : null;
  }

  return retainedStats;
}

/**
 * Converts a thrown value to an Error instance without throwing.
 *
 * @param error - Thrown value.
 * @returns Error instance.
 */
function toError(error: unknown): Error {
  const inspected = inspectError(error);

  return inspected.error ?? new Error(inspected.message);
}

export {
  createDiagnostic,
  createRetainedDiagnosticStats,
  createRetainedDiagnosticValue,
  dispatchDiagnostics,
  getErrorMessage,
  toError,
};
export type { TrackerValidationDiagnosticsSink };
