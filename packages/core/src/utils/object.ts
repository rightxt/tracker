/** Unbound intrinsic used for own-property checks on arbitrary objects. */
const OBJECT_HAS_OWN = Object.prototype.hasOwnProperty;

/** Unbound intrinsic used for cross-realm object tag checks. */
const OBJECT_TO_STRING = Object.prototype.toString;

/** Unbound intrinsic and native Object source used for cross-realm constructor checks. */
const FUNCTION_TO_STRING = Function.prototype.toString;
const NATIVE_OBJECT_SOURCE = FUNCTION_TO_STRING.call(Object);

/**
 * Defines an own enumerable data property without invoking the legacy
 * `__proto__` setter inherited from Object.prototype.
 *
 * @param object - Object receiving the property.
 * @param key - Property key.
 * @param value - Property value.
 */
function defineOwnProperty(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Creates a public copy of a rule object.
 *
 * Callback functions are intentionally preserved by reference. Nested plain
 * objects and arrays are cloned to prevent accidental mutation of internal
 * state through the public API.
 *
 * @param rule - Rule object.
 * @returns Public rule copy.
 */
function clonePublicRule<T extends Record<string, unknown>>(rule: T): T {
  return cloneValue(rule);
}

/**
 * Clones arrays and plain objects without JSON serialization.
 *
 * Functions and non-plain objects remain by reference because user rules may
 * contain callbacks and DOM references.
 *
 * @param value - Value to clone.
 * @returns Cloned value when cloning is supported, otherwise the original value.
 */
function cloneValue<T>(value: T, seen: WeakMap<object, object> = new WeakMap()): T {
  if (Array.isArray(value)) {
    const existingClone = seen.get(value);

    if (existingClone !== undefined) {
      return existingClone as T;
    }

    const result: unknown[] = new Array(value.length);
    seen.set(value, result);
    for (let index = 0; index < value.length; index += 1) {
      if (index in value) {
        result[index] = cloneValue(value[index], seen);
      }
    }

    return result as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const existingClone = seen.get(value);

  if (existingClone !== undefined) {
    return existingClone as T;
  }

  const result: Record<string, unknown> = {};
  seen.set(value, result);

  Object.entries(value).forEach(([key, item]) => {
    defineOwnProperty(result, key, cloneValue(item, seen));
  });

  return result as T;
}

/**
 * Restores a caller-owned `diagnostics.output` sink identity onto a cloned
 * diagnostics-options object.
 *
 * {@link cloneValue} (and anything built on it, including
 * {@link snapshotCallTimeInput}) clones every reachable plain object, so a
 * plain-object `output` sink would otherwise silently lose its identity
 * across any configuration-cloning boundary. Diagnostics sinks are
 * documented caller-owned state — they may hold their own mutable `this` —
 * so every such boundary must restore this one field's reference after
 * cloning, and must not freeze it.
 *
 * @param original - Original, caller-supplied diagnostics-options candidate.
 * @param clonedDiagnostics - Cloned diagnostics-options object to restore identity onto.
 * @returns The clone with the original `output` reference restored, or `clonedDiagnostics` unchanged when there is nothing to restore.
 */
function withRestoredDiagnosticsOutput<T extends { output?: unknown }>(original: unknown, clonedDiagnostics: T): T {
  if (!isPlainObject(original)) {
    return clonedDiagnostics;
  }

  const output = (original as Record<string, unknown>).output as T['output'];

  return { ...clonedDiagnostics, ...(output === undefined ? {} : { output }) };
}

/** Bidirectional identity mapping used during recursive graph comparison. */
interface ValueEqualityContext {
  /** Object identities mapped from the left graph to the right graph. */
  leftToRight: WeakMap<object, object>;
  /** Object identities mapped from the right graph to the left graph. */
  rightToLeft: WeakMap<object, object>;
}

/**
 * Compares arrays recursively.
 *
 * @param left - First array.
 * @param right - Second array.
 * @param context - Bidirectional graph identity mapping.
 * @returns True when arrays are equivalent.
 */
function areArraysEqual(left: unknown[], right: unknown[], context: ValueEqualityContext): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return Array.from({ length: left.length }, (_, index) => {
    if (index in left !== index in right) {
      return false;
    }

    return !(index in left) || areValuesEqual(left[index], right[index], context);
  }).every(Boolean);
}

/**
 * Compares plain objects recursively by own enumerable keys.
 *
 * @param left - First object.
 * @param right - Second object.
 * @returns True when objects are equivalent.
 */
function arePlainObjectsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  context: ValueEqualityContext,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => hasOwn(right, key) && areValuesEqual(left[key], right[key], context));
}

/**
 * Records one object pair currently compared during recursive equality checks.
 *
 * @param left - First object in the pair.
 * @param right - Second object in the pair.
 * @param context - Bidirectional object identity mappings.
 * @returns True when the pair was already compared.
 */
function compareObjectPair(left: object, right: object, context: ValueEqualityContext): boolean | null {
  const mappedRight = context.leftToRight.get(left);
  const mappedLeft = context.rightToLeft.get(right);

  if (mappedRight !== undefined || mappedLeft !== undefined) {
    return mappedRight === right && mappedLeft === left;
  }

  context.leftToRight.set(left, right);
  context.rightToLeft.set(right, left);

  return null;
}

/**
 * Compares values recursively for internal runtime diffing.
 *
 * Functions, DOM nodes, class instances and other non-plain objects are
 * compared by reference through Object.is(). Arrays and plain objects are
 * compared recursively.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns True when values are equivalent.
 */
function areValuesEqual(
  left: unknown,
  right: unknown,
  context: ValueEqualityContext = { leftToRight: new WeakMap(), rightToLeft: new WeakMap() },
): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (typeof left !== typeof right) {
    return false;
  }

  if (left === null || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    const pairComparison = compareObjectPair(left, right, context);

    return pairComparison ?? areArraysEqual(left, right, context);
  }

  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }

  const pairComparison = compareObjectPair(left, right, context);

  return pairComparison ?? arePlainObjectsEqual(left, right, context);
}

/**
 * Collects unknown object keys according to an allowed shape.
 *
 * The allowed shape is a nested plain object. Leaf values may be any value.
 * A nested object means that nested keys are checked recursively.
 *
 * @param input - Object to inspect.
 * @param allowedShape - Allowed object shape.
 * @param basePath - Internal path prefix.
 * @returns Unknown key paths.
 */
function collectUnknownKeys(input: unknown, allowedShape: Record<string, unknown>, basePath = ''): string[] {
  if (!isPlainObject(input) || !isPlainObject(allowedShape)) {
    return [];
  }

  return Object.keys(input).reduce<string[]>((paths, key) => {
    const currentPath = basePath ? `${basePath}.${key}` : key;

    if (!hasOwn(allowedShape, key)) {
      paths.push(currentPath);
      return paths;
    }

    const inputValue = input[key];
    const allowedValue = allowedShape[key];

    if (isPlainObject(inputValue) && isPlainObject(allowedValue)) {
      paths.push(...collectUnknownKeys(inputValue, allowedValue, currentPath));
    }

    return paths;
  }, []);
}

/**
 * Finds the first own property, at any depth of a known schema, whose value
 * is explicitly `undefined`.
 *
 * Only walks paths declared in `allowedShape`. A nested shape branch is
 * followed only when the corresponding input value is itself a plain
 * object; opaque leaves (dynamic records, callbacks, DOM identities) are
 * left to their own dedicated leaf validation instead of being walked here.
 *
 * @param input - Object to inspect.
 * @param allowedShape - Nested shape describing known fields.
 * @param basePath - Internal path prefix.
 * @returns Dot-separated path of the first own-`undefined` field, or null.
 */
function findFirstOwnUndefinedPath(
  input: unknown,
  allowedShape: Record<string, unknown>,
  basePath = '',
): string | null {
  if (!isPlainObject(input)) {
    return null;
  }

  return Object.keys(allowedShape).reduce<string | null>((found, key) => {
    if (found !== null || !hasOwn(input, key)) {
      return found;
    }

    const currentPath = basePath ? `${basePath}.${key}` : key;
    const value = input[key];

    if (value === undefined) {
      return currentPath;
    }

    const allowedValue = allowedShape[key];

    if (isPlainObject(allowedValue) && isPlainObject(value)) {
      return findFirstOwnUndefinedPath(value, allowedValue, currentPath);
    }

    return found;
  }, null);
}

/**
 * Checks whether an object owns a property.
 *
 * @param object - Object to inspect.
 * @param key - Property key.
 * @returns True when the property belongs directly to the object.
 */
function hasOwn(object: unknown, key: string | number | symbol): boolean {
  return object !== null && typeof object === 'object' && OBJECT_HAS_OWN.call(object, key);
}

/**
 * Checks whether a value is a plain object.
 *
 * Arrays, functions, DOM nodes, class instances and built-in objects are not
 * treated as plain objects.
 *
 * @param value - Value to check.
 * @returns True when the value is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    if (OBJECT_TO_STRING.call(value) !== '[object Object]') {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);

    if (prototype === null) {
      return true;
    }

    const constructor = prototype.constructor;

    return typeof constructor === 'function' && FUNCTION_TO_STRING.call(constructor) === NATIVE_OBJECT_SOURCE;
  } catch {
    return false;
  }
}

/**
 * Returns a deep call-time snapshot of a plain-object or array candidate, or
 * the value unchanged otherwise.
 *
 * Recursively clones every reachable plain object and array so a later
 * in-place mutation of the original container, at any nesting depth (for
 * example after a call queued during reentrant dispatch returns), cannot
 * change what a still-pending operation later reads. Functions, DOM
 * references, and other non-plain objects keep their original identity,
 * matching the traversal boundary {@link cloneValue} already uses. Callers
 * that need a specific nested plain-object field to keep the caller's
 * identity (for example a `diagnostics.output` sink) must restore it onto
 * the returned snapshot themselves.
 *
 * @param candidate - Raw caller-supplied input.
 * @returns Deep call-time snapshot, or the original value when it is neither
 * a plain object nor an array.
 */
function snapshotCallTimeInput<T>(candidate: T): T {
  return Array.isArray(candidate) || isPlainObject(candidate) ? cloneValue(candidate) : candidate;
}

/**
 * Recursively freezes plain objects and arrays reachable from a value.
 *
 * Non-plain objects (functions, DOM nodes, class instances) are left
 * unfrozen, matching the traversal boundary already used by {@link cloneValue}.
 * Circular references are visited once through the `seen` set.
 *
 * @param value - Value to freeze in place.
 * @param seen - Object identities already frozen, used to close cycles.
 * @returns The same value, deeply frozen.
 */
function deepFreeze<T>(value: T, seen: Set<unknown> = new Set()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => deepFreeze(item, seen));
    return Object.freeze(value);
  }

  if (isPlainObject(value)) {
    Object.values(value).forEach((item) => deepFreeze(item, seen));
    return Object.freeze(value) as T;
  }

  return value;
}

/**
 * Merges option-like plain objects without mutating either input.
 *
 * Arrays are replaced, not concatenated. Undefined patch values are ignored.
 * Plain objects are merged recursively. Functions and non-plain objects are
 * copied by reference.
 *
 * @param base - Base object.
 * @param patch - Partial object applied on top of the base object.
 * @param mergedValues - Patch objects currently merged, used to close recursive cycles.
 * @returns Merged object.
 */
function mergeOptions<T extends Record<string, unknown>, U extends Record<string, unknown>>(
  base: T,
  patch: U,
  mergedValues: WeakMap<object, object> = new WeakMap(),
): T & U {
  return mergeOptionsWithContext(base, patch, mergedValues, []);
}

/**
 * Merges one recursive options branch with its active graph context.
 *
 * @param base - Base branch.
 * @param patch - Patch branch.
 * @param mergedValues - Patch objects currently merged, used to close recursive cycles.
 * @param ancestorPatchResults - Ancestor patch-to-result mappings inherited by cloned branches.
 * @returns Merged branch.
 */
function mergeOptionsWithContext<T extends Record<string, unknown>, U extends Record<string, unknown>>(
  base: T,
  patch: U,
  mergedValues: WeakMap<object, object>,
  ancestorPatchResults: readonly (readonly [object, object])[],
): T & U {
  if (!isPlainObject(patch)) {
    return (isPlainObject(base) ? cloneValue(base) : {}) as T & U;
  }

  const existingResult = mergedValues.get(patch);

  if (existingResult !== undefined) {
    return existingResult as T & U;
  }

  const result: Record<string, unknown> = isPlainObject(base) ? cloneValue(base) : {};
  mergedValues.set(patch, result);
  const cloneContext = new WeakMap<object, object>([...ancestorPatchResults, [patch, result]]);
  const nestedAncestorPatchResults = [...ancestorPatchResults, [patch, result]] as const;

  try {
    Object.entries(patch).forEach(([key, patchValue]) => {
      if (patchValue === undefined) {
        return;
      }

      const baseValue = result[key];

      if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
        defineOwnProperty(
          result,
          key,
          mergeOptionsWithContext(baseValue, patchValue, mergedValues, nestedAncestorPatchResults),
        );
        return;
      }

      defineOwnProperty(result, key, cloneValue(patchValue, cloneContext));
    });
  } finally {
    mergedValues.delete(patch);
  }

  return result as T & U;
}

export {
  areValuesEqual,
  clonePublicRule,
  cloneValue,
  collectUnknownKeys,
  deepFreeze,
  findFirstOwnUndefinedPath,
  hasOwn,
  isPlainObject,
  mergeOptions,
  snapshotCallTimeInput,
  withRestoredDiagnosticsOutput,
};
