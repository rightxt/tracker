import { describe, expect, it, vi } from 'vitest';

import type { TrackerStats, TrackerValidationDiagnostic } from '../../types.js';
import {
  createDiagnostic,
  createRetainedDiagnosticStats,
  dispatchDiagnostics,
  getErrorMessage,
  toError,
} from '../diagnostic.js';

/**
 * Creates a stats snapshot with the given last warning details.
 *
 * @param details - Last warning details.
 * @returns Stats snapshot stub.
 */
function createStatsWithWarningDetails(details: Record<string, unknown> | null): TrackerStats {
  return {
    warnings: {
      total: 1,
      byCode: { code: 1 },
      last: { code: 'code', message: 'Warning message.', details },
    },
    errors: {
      total: 0,
      byCode: {},
      last: null,
    },
  } as unknown as TrackerStats;
}

describe('core diagnostic utilities', () => {
  it('creates diagnostic entries with default details', () => {
    expect(createDiagnostic('warning', 'invalid-option-value', 'Message.')).toEqual({
      type: 'warning',
      code: 'invalid-option-value',
      message: 'Message.',
      details: {},
    });
    expect(createDiagnostic('error', 'invalid-options', 'Message.', { key: 1 })).toEqual({
      type: 'error',
      code: 'invalid-options',
      message: 'Message.',
      details: { key: 1 },
    });
  });

  it('extracts messages from thrown values', () => {
    expect(getErrorMessage(new Error('failed'))).toBe('failed');
    expect(getErrorMessage('failed')).toBe('failed');
    expect(getErrorMessage(42)).toBe('42');
  });

  it.each([
    [
      'Error classification',
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('classification failed');
          },
        },
      ),
    ],
    [
      'Error message access',
      Object.defineProperty(new Error('hidden'), 'message', {
        get() {
          throw new Error('message access failed');
        },
      }),
    ],
    [
      'object coercion',
      {
        [Symbol.toPrimitive]() {
          throw new Error('coercion failed');
        },
      },
    ],
  ])('contains unsafe %s while normalizing an unknown failure', (_case, thrownValue) => {
    expect(() => getErrorMessage(thrownValue)).not.toThrow();
    expect(getErrorMessage(thrownValue)).toBe('Unknown error.');
    expect(() => toError(thrownValue)).not.toThrow();
    expect(toError(thrownValue)).toEqual(expect.objectContaining({ message: 'Unknown error.' }));
  });

  it('converts thrown values to Error instances', () => {
    const error = new Error('failed');

    expect(toError(error)).toBe(error);

    const wrapped = toError('failed');

    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('failed');
  });

  describe('dispatchDiagnostics', () => {
    it('routes entries to the matching diagnostics channel', () => {
      const diagnostics = { warn: vi.fn(), error: vi.fn() };
      const entries: TrackerValidationDiagnostic[] = [
        { type: 'warning', code: 'invalid-option-value', message: 'Warning message.', details: { key: 1 } },
        { type: 'error', code: 'invalid-options', message: 'Error message.', details: null },
      ];

      dispatchDiagnostics(entries, diagnostics);

      expect(diagnostics.warn).toHaveBeenCalledTimes(1);
      expect(diagnostics.warn).toHaveBeenCalledWith('invalid-option-value', 'Warning message.', { key: 1 });
      expect(diagnostics.error).toHaveBeenCalledTimes(1);
      expect(diagnostics.error).toHaveBeenCalledWith('invalid-options', 'Error message.', null);
    });

    it('does nothing for empty entry lists or missing sinks', () => {
      const diagnostics = { warn: vi.fn(), error: vi.fn() };
      const entries: TrackerValidationDiagnostic[] = [
        { type: 'warning', code: 'invalid-option-value', message: 'Warning message.', details: null },
      ];

      dispatchDiagnostics([], diagnostics);

      expect(diagnostics.warn).not.toHaveBeenCalled();
      expect(diagnostics.error).not.toHaveBeenCalled();

      expect(() => dispatchDiagnostics(entries, null)).not.toThrow();
      expect(() => dispatchDiagnostics(entries, undefined)).not.toThrow();
    });
  });

  describe('createRetainedDiagnosticStats', () => {
    it('replaces external references in retained details', () => {
      const stats = createStatsWithWarningDetails({
        callback: () => {},
        error: new Error('failed'),
        event: new Event('click'),
        map: new Map(),
        list: [1, () => {}],
        plain: { value: 1 },
        scalar: 'text',
      });

      const retained = createRetainedDiagnosticStats(stats);

      expect(retained.warnings.last!.details).toEqual({
        callback: '[Function]',
        error: { name: 'Error', message: 'failed' },
        event: '[Event click]',
        map: '[object Map]',
        list: [1, '[Function]'],
        plain: { value: 1 },
        scalar: 'text',
      });
    });

    it('truncates deeply nested details', () => {
      const stats = createStatsWithWarningDetails({ a: { b: { c: { d: { e: 1 } } } } });
      const retained = createRetainedDiagnosticStats(stats);

      expect(retained.warnings.last!.details).toEqual({ a: { b: { c: { d: '[MaxDepth]' } } } });
    });

    it('normalizes non-object details to null and keeps empty last entries', () => {
      const stats = createStatsWithWarningDetails(null);
      const retained = createRetainedDiagnosticStats(stats);

      expect(retained.warnings.last!.details).toBeNull();
      expect(retained.errors.last).toBeNull();
    });
  });
});
