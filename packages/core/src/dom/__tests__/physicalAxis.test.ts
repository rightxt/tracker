import { describe, expect, it } from 'vitest';

import { createAxisOffsetConverter } from '../physicalAxis.js';

import type { TrackerNativeAxisModel } from '../physicalAxis.js';

/**
 * Creates a concrete converter model.
 *
 * @param nativeStart - Native value at physical start.
 * @param nativeEnd - Native value at physical end.
 * @returns Native axis model.
 */
function createModel(nativeStart: number, nativeEnd: number): TrackerNativeAxisModel {
  return {
    axis: 'x',
    flowDirection: nativeEnd >= nativeStart ? 'positive' : 'negative',
    nativeStart,
    nativeEnd,
    nativeMinimum: Math.min(nativeStart, nativeEnd),
    nativeMaximum: Math.max(nativeStart, nativeEnd),
  };
}

describe('physical axis conversion', () => {
  it.each([
    [0, 100],
    [-100, 0],
    [100, 0],
    [0, -100],
  ])('round-trips native endpoints %s to %s', (nativeStart, nativeEnd) => {
    const maxOffset = 100;
    const converter = createAxisOffsetConverter(createModel(nativeStart, nativeEnd));

    expect(converter.toPhysicalOffset(nativeStart, maxOffset)).toBe(0);
    expect(converter.toPhysicalOffset(nativeEnd, maxOffset)).toBe(maxOffset);
    expect(converter.toNativeOffset(0, maxOffset)).toBe(nativeStart);
    expect(converter.toNativeOffset(maxOffset, maxOffset)).toBe(nativeEnd);

    for (const physicalOffset of [0, 25, 50, 75, 100]) {
      const nativeOffset = converter.toNativeOffset(physicalOffset, maxOffset);

      expect(converter.toPhysicalOffset(nativeOffset, maxOffset)).toBeCloseTo(physicalOffset, 8);
    }
  });

  it('clamps invalid and out-of-range values', () => {
    const converter = createAxisOffsetConverter(createModel(-100, 0));

    expect(converter.toPhysicalOffset(Number.NaN, 100)).toBe(0);
    expect(converter.toPhysicalOffset(-200, 100)).toBe(0);
    expect(converter.toPhysicalOffset(200, 100)).toBe(100);
    expect(converter.toNativeOffset(-10, 100)).toBe(-100);
    expect(converter.toNativeOffset(200, 100)).toBe(0);
    expect(converter.toNativeOffset(50, Number.NaN)).toBe(-100);
  });
});
