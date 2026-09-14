/** Shared fallback callback for optional nullable providers. */
function getNull(): null {
  return null;
}

/** Shared fallback callback for optional list providers. */
function getEmptyArray<T>(): T[] {
  return [];
}

/** Shared no-operation callback for optional void hooks. */
function noop(): void {}

export { getEmptyArray, getNull, noop };
