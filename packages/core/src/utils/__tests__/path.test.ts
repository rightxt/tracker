import { describe, expect, it } from 'vitest';

import { deletePath, getPath, hasPath, setPath } from '../path.js';

describe('core path utilities', () => {
  describe('getPath', () => {
    it('reads nested values', () => {
      const object = { a: { b: { c: 1 } } };

      expect(getPath(object, 'a.b.c')).toBe(1);
      expect(getPath(object, 'a.b')).toEqual({ c: 1 });
    });

    it('returns undefined for missing or non-object segments', () => {
      const object = { a: { b: 1 } };

      expect(getPath(object, 'a.missing')).toBeUndefined();
      expect(getPath(object, 'a.b.c')).toBeUndefined();
      expect(getPath(object, 'missing.b')).toBeUndefined();
    });
  });

  describe('hasPath', () => {
    it('detects existing nested paths including falsy values', () => {
      const object = { a: { b: { c: undefined } } };

      expect(hasPath(object, 'a.b.c')).toBe(true);
      expect(hasPath(object, 'a.b')).toBe(true);
    });

    it('rejects missing paths and inherited properties', () => {
      const object = { a: { b: 1 } };

      expect(hasPath(object, 'a.c')).toBe(false);
      expect(hasPath(object, 'a.b.c')).toBe(false);
      expect(hasPath(object, 'a.toString')).toBe(false);
    });
  });

  describe('setPath', () => {
    it('writes nested values and creates missing intermediates', () => {
      const object: Record<string, unknown> = {};

      setPath(object, 'a.b.c', 1);

      expect(object).toEqual({ a: { b: { c: 1 } } });
    });

    it('replaces non-object intermediates', () => {
      const object: Record<string, unknown> = { a: 1 };

      setPath(object, 'a.b', 2);

      expect(object).toEqual({ a: { b: 2 } });
    });

    it('stores a clone detached from the input value', () => {
      const object: Record<string, unknown> = {};
      const value = { nested: 1 };

      setPath(object, 'a', value);
      value.nested = 2;

      expect(getPath(object, 'a')).toEqual({ nested: 1 });
    });

    it('ignores empty paths', () => {
      const object: Record<string, unknown> = { a: 1 };

      setPath(object, '', 2);

      expect(object).toEqual({ a: 1 });
    });
  });

  describe('deletePath', () => {
    it('removes nested keys', () => {
      const object: Record<string, unknown> = { a: { b: { c: 1, d: 2 } } };

      deletePath(object, 'a.b.c');

      expect(object).toEqual({ a: { b: { d: 2 } } });
    });

    it('ignores missing intermediates and empty paths', () => {
      const object: Record<string, unknown> = { a: 1 };

      deletePath(object, 'missing.b');
      deletePath(object, 'a.b');
      deletePath(object, '');

      expect(object).toEqual({ a: 1 });
    });
  });
});
