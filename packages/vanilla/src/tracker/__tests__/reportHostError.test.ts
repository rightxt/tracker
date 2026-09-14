import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportHostError } from '../reportHostError.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Runs every scheduled fallback callback and collects whatever each one throws.
 *
 * @param callbacks - Callbacks captured from the stubbed microtask queue.
 * @returns The values thrown, in execution order.
 */
function collectThrown(callbacks: ReadonlyArray<() => void>): unknown[] {
  const thrown: unknown[] = [];

  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      thrown.push(error);
    }
  }

  return thrown;
}

describe('reportHostError', () => {
  it('surfaces the original consumer failure asynchronously when host reporting is unavailable or broken', () => {
    const error = new Error('consumer callback failed');
    let queuedCallbacks: Array<() => void> = [];

    vi.stubGlobal('queueMicrotask', (callback: () => void) => {
      queuedCallbacks.push(callback);
    });

    // No host reporter: the helper must not throw synchronously and must schedule
    // the original error for an unhandled asynchronous throw.
    vi.stubGlobal('reportError', undefined);

    expect(() => reportHostError(error)).not.toThrow();
    expect(collectThrown(queuedCallbacks)).toContain(error);

    // Broken host reporter: the original failure must still reach an asynchronous throw.
    queuedCallbacks = [];
    vi.stubGlobal(
      'reportError',
      vi.fn(() => {
        throw new Error('reportError itself is broken');
      }),
    );

    expect(() => reportHostError(error)).not.toThrow();
    expect(collectThrown(queuedCallbacks)).toContain(error);
  });
});
