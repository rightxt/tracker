import { describe, expect, it } from 'vitest';

import { getEmptyArray, getNull, noop } from '../function.js';

describe('core function utilities', () => {
  it('returns null from the shared null provider', () => {
    expect(getNull()).toBeNull();
  });

  it('returns a fresh empty array on every call', () => {
    const first = getEmptyArray<number>();
    const second = getEmptyArray<number>();

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(first).not.toBe(second);
  });

  it('performs no operation and returns undefined', () => {
    expect(noop()).toBeUndefined();
  });
});
