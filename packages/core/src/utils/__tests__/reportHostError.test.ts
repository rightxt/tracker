import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportHostError } from '../reportHostError.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reportHostError', () => {
  it('reports the original value through the host reportError function', () => {
    const error = new Error('Expected host failure.');
    const reporter = vi.fn();
    const queueMicrotask = vi.fn();

    vi.stubGlobal('reportError', reporter);
    vi.stubGlobal('queueMicrotask', queueMicrotask);

    reportHostError(error);

    expect(reporter).toHaveBeenCalledWith(error);
    expect(queueMicrotask).not.toHaveBeenCalled();
  });

  it('falls back to an asynchronous throw of the original value', () => {
    const error = new Error('Expected fallback failure.');
    const callbacks: Array<() => void> = [];

    vi.stubGlobal('reportError', undefined);
    vi.stubGlobal('queueMicrotask', (callback: () => void) => callbacks.push(callback));

    reportHostError(error);

    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toThrow(error);
  });

  it('does not replace the original value when reportError itself fails', () => {
    const error = new Error('Expected consumer failure.');
    const reporterError = new Error('Expected reporter failure.');
    const callbacks: Array<() => void> = [];

    vi.stubGlobal('reportError', () => {
      throw reporterError;
    });
    vi.stubGlobal('queueMicrotask', (callback: () => void) => callbacks.push(callback));

    reportHostError(error);

    expect(callbacks).toHaveLength(2);
    expect(callbacks[0]).toThrow(reporterError);
    expect(callbacks[1]).toThrow(error);
  });

  it('falls back to timers in order when reportError and microtask scheduling fail', () => {
    const error = new Error('Expected consumer failure.');
    const reporterError = new Error('Expected reporter failure.');
    const callbacks: Array<() => void> = [];

    vi.stubGlobal('reportError', () => {
      throw reporterError;
    });
    vi.stubGlobal('queueMicrotask', () => {
      throw new Error('Expected microtask scheduling failure.');
    });
    vi.stubGlobal('setTimeout', (callback: () => void) => {
      callbacks.push(callback);
      return 1;
    });

    expect(() => reportHostError(error)).not.toThrow();
    expect(callbacks).toHaveLength(2);
    expect(callbacks[0]).toThrow(reporterError);
    expect(callbacks[1]).toThrow(error);
  });

  it('returns normally when no asynchronous host transport accepts the error', () => {
    vi.stubGlobal('reportError', undefined);
    vi.stubGlobal('queueMicrotask', () => {
      throw new Error('Expected microtask scheduling failure.');
    });
    vi.stubGlobal('setTimeout', () => {
      throw new Error('Expected timer scheduling failure.');
    });

    expect(() => reportHostError(new Error('Expected consumer failure.'))).not.toThrow();
  });
});
