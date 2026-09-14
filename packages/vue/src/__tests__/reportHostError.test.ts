import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportHostError } from '../reportHostError.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reportHostError', () => {
  it('surfaces the original Vue listener failure asynchronously when host reporting is unavailable or broken', () => {
    const originalError = new Error('vue emit listener failed');
    let scheduled: Array<() => void> = [];

    vi.stubGlobal('queueMicrotask', (callback: () => void) => {
      scheduled.push(callback);
    });

    // Phase A - no host reporter is installed. The no-reporter branch owns exactly one
    // original failure and one async scheduling choice.
    vi.stubGlobal('reportError', undefined);

    expect(() => reportHostError(originalError)).not.toThrow();
    expect(scheduled).toHaveLength(1);

    const phaseAThrown: unknown[] = [];

    scheduled.forEach((callback) => {
      try {
        callback();
      } catch (thrown) {
        phaseAThrown.push(thrown);
      }
    });

    expect(phaseAThrown).toContain(originalError);

    // Phase B - the installed host reporter itself throws. The retained contract is only
    // that the original Vue consumer failure still surfaces asynchronously and does not
    // synchronously leak; exact callback cardinality/order is not pinned.
    scheduled = [];
    vi.stubGlobal(
      'reportError',
      vi.fn(() => {
        throw new Error('reportError itself is broken');
      }),
    );

    expect(() => reportHostError(originalError)).not.toThrow();

    const phaseBThrown: unknown[] = [];

    scheduled.forEach((callback) => {
      try {
        callback();
      } catch (thrown) {
        phaseBThrown.push(thrown);
      }
    });

    expect(phaseBThrown).toContain(originalError);
  });
});
