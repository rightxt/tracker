import { describe, expect, it } from 'vitest';

import {
  areValuesEqual,
  cloneValue,
  collectUnknownKeys,
  findFirstOwnUndefinedPath,
  isPlainObject,
  mergeOptions,
} from '../object.js';

describe('object utilities', () => {
  it('rejects class instances whose constructor is named Object', () => {
    const ImpostorObject = class Object {};

    expect(isPlainObject(new ImpostorObject())).toBe(false);
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('preserves an own __proto__ property without changing the result prototype', () => {
    const source = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const cloned = cloneValue(source);
    const merged = mergeOptions({}, source);

    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.hasOwn(cloned, '__proto__')).toBe(true);
    expect(Object.hasOwn(merged, '__proto__')).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('clones cyclic plain objects without retaining references to the source graph', () => {
    const source: { self?: unknown } = {};
    source.self = source;

    const cloned = cloneValue(source);

    expect(cloned).not.toBe(source);
    expect(cloned.self).toBe(cloned);
  });

  it('compares equivalent cyclic plain object graphs', () => {
    const left: { self?: unknown } = {};
    const right: { self?: unknown } = {};
    left.self = left;
    right.self = right;

    expect(areValuesEqual(left, right)).toBe(true);
  });

  it('distinguishes cyclic graphs with different aliasing topology', () => {
    const selfCycle: { self?: unknown } = {};
    const childCycle: { self?: unknown } = {};
    const nestedCycle: { self?: unknown } = {};
    selfCycle.self = selfCycle;
    childCycle.self = nestedCycle;
    nestedCycle.self = nestedCycle;

    expect(areValuesEqual(selfCycle, childCycle)).toBe(false);
  });

  it('distinguishes a shared child from independently duplicated children', () => {
    const sharedChild = { value: 1 };
    const shared = { first: sharedChild, second: sharedChild };
    const duplicated = { first: { value: 1 }, second: { value: 1 } };

    expect(areValuesEqual(shared, duplicated)).toBe(false);
  });

  it('preserves sparse array holes while cloning and comparing values', () => {
    const sparse = new Array(2);
    const cloned = cloneValue(sparse);
    const sparseWithValue = new Array(2);
    sparseWithValue[1] = 'value';

    expect(cloned).toHaveLength(2);
    expect(0 in cloned).toBe(false);
    expect(areValuesEqual(sparseWithValue, [undefined, 'value'])).toBe(false);
  });

  it('merges cyclic plain object graphs without overflowing the stack', () => {
    const base: { self?: unknown } = {};
    const patch: { self?: unknown } = {};
    base.self = base;
    patch.self = patch;

    const merged = mergeOptions(base, patch);

    expect(merged.self).toBe(merged);
  });

  it('preserves a patch-only root cycle', () => {
    const patch: { self?: unknown } = {};
    patch.self = patch;

    const merged = mergeOptions({}, patch);

    expect(merged.self).toBe(merged);
  });

  it('preserves shared patch-only children', () => {
    const shared = { value: 1 };
    const merged = mergeOptions({}, { first: shared, second: shared });

    expect(merged.first).toBe(merged.second);
    expect(merged.first).not.toBe(shared);
  });

  it('preserves a nested reference to the patch root', () => {
    const patch: { nested?: { parent: unknown } } = {};
    patch.nested = { parent: patch };

    const merged = mergeOptions({ nested: {} }, patch);

    expect(merged.nested.parent).toBe(merged);
  });

  it('merges one shared patch independently against sibling base branches', () => {
    const sharedPatch = { enabled: false };
    const merged = mergeOptions(
      {
        updates: {
          mutation: { debounce: 100, enabled: true },
          resize: { debounce: 50, enabled: true },
        },
      },
      {
        updates: {
          mutation: sharedPatch,
          resize: sharedPatch,
        },
      },
    );

    expect(merged.updates.mutation).toEqual({ debounce: 100, enabled: false });
    expect(merged.updates.resize).toEqual({ debounce: 50, enabled: false });
    expect(merged.updates.mutation).not.toBe(merged.updates.resize);
  });
});

describe('collectUnknownKeys', () => {
  it('returns no unknown keys when every input key is declared in the allowed shape', () => {
    expect(collectUnknownKeys({ orientation: 'vertical' }, { orientation: true })).toEqual([]);
  });

  it('reports a top-level key absent from the allowed shape', () => {
    expect(collectUnknownKeys({ bogus: true, orientation: 'vertical' }, { orientation: true })).toEqual(['bogus']);
  });

  it('reports a nested unknown key with a dot-separated path when the allowed shape declares a nested shape', () => {
    const allowedShape = { a11y: { enabled: true, label: true } };
    const input = { a11y: { bogus: true, enabled: true } };

    expect(collectUnknownKeys(input, allowedShape)).toEqual(['a11y.bogus']);
  });

  it('does not walk into a key whose allowed shape entry is an opaque leaf, even when the input value is a plain object with extra keys', () => {
    const allowedShape = { output: true };
    const input = { output: { unexpected: 1 } };

    expect(collectUnknownKeys(input, allowedShape)).toEqual([]);
  });

  it('collects multiple unknown keys in input key order', () => {
    const allowedShape = { known: true };
    const input = { first: true, known: true, second: true };

    expect(collectUnknownKeys(input, allowedShape)).toEqual(['first', 'second']);
  });

  it('returns no paths when the input or the allowed shape is not a plain object', () => {
    expect(collectUnknownKeys(null, { a: true })).toEqual([]);
    expect(collectUnknownKeys([1, 2], { a: true })).toEqual([]);
    expect(collectUnknownKeys({ a: 1 }, null as unknown as Record<string, unknown>)).toEqual([]);
  });
});

describe('findFirstOwnUndefinedPath', () => {
  it('finds a top-level own-undefined field', () => {
    const allowedShape = { a: true, b: true };
    const input = { a: 1, b: undefined };

    expect(findFirstOwnUndefinedPath(input, allowedShape)).toBe('b');
  });

  it('finds a nested own-undefined field inside a declared nested shape', () => {
    const allowedShape = { a11y: { enabled: true, label: true } };
    const input = { a11y: { enabled: true, label: undefined } };

    expect(findFirstOwnUndefinedPath(input, allowedShape)).toBe('a11y.label');
  });

  it('returns null when a declared field is absent rather than explicitly undefined', () => {
    const allowedShape = { a: true, b: true };
    const input = { a: 1 };

    expect(findFirstOwnUndefinedPath(input, allowedShape)).toBeNull();
  });

  it('returns the first own-undefined field in allowed-shape key order, not input insertion order', () => {
    const allowedShape = { first: true, second: true };
    const input = { second: undefined, first: undefined };

    expect(findFirstOwnUndefinedPath(input, allowedShape)).toBe('first');
  });

  it('does not walk into an opaque leaf even when its value is a plain object containing an explicit undefined', () => {
    const allowedShape = { output: true };
    const input = { output: { sink: undefined } };

    expect(findFirstOwnUndefinedPath(input, allowedShape)).toBeNull();
  });

  it('returns null when the input itself is not a plain object', () => {
    expect(findFirstOwnUndefinedPath(null, { a: true })).toBeNull();
    expect(findFirstOwnUndefinedPath([1, undefined], { a: true })).toBeNull();
  });
});
