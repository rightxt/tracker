import { cloneValue, hasOwn, isPlainObject } from './object.js';

/**
 * Deletes a nested value from an object.
 *
 * Missing intermediate objects are ignored.
 *
 * @param object - Target object.
 * @param path - Dot-separated path.
 */
function deletePath(object: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  const lastKey = keys.pop();

  if (!lastKey) {
    return;
  }

  const target = keys.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return null;
    }

    return (current as Record<string, unknown>)[key];
  }, object);

  if (target && typeof target === 'object') {
    delete (target as Record<string, unknown>)[lastKey];
  }
}

/**
 * Reads a nested value from an object.
 *
 * @param object - Source object.
 * @param path - Dot-separated path.
 * @returns Nested value.
 */
function getPath(object: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  }, object);
}

/**
 * Checks whether a nested path exists on an object.
 *
 * @param object - Source object.
 * @param path - Dot-separated path.
 * @returns True when the path exists.
 */
function hasPath(object: Record<string, unknown>, path: string): boolean {
  const keys = path.split('.');
  let current: unknown = object;

  return keys.every((key) => {
    if (!current || typeof current !== 'object' || !hasOwn(current, key)) {
      return false;
    }

    current = (current as Record<string, unknown>)[key];
    return true;
  });
}

/**
 * Writes a nested value to an object.
 *
 * Missing intermediate objects are created.
 *
 * @param object - Target object.
 * @param path - Dot-separated path.
 * @param value - Value to write.
 */
function setPath(object: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const lastKey = keys.pop();

  if (!lastKey) {
    return;
  }

  const target = keys.reduce<Record<string, unknown>>((current, key) => {
    if (!isPlainObject(current[key])) {
      current[key] = {};
    }

    return current[key] as Record<string, unknown>;
  }, object);

  target[lastKey] = cloneValue(value);
}

export { deletePath, getPath, hasPath, setPath };
