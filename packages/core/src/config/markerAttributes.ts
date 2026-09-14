import type {
  TrackerNormalizedMarkerAttributes,
  TrackerNormalizedUserAttributes,
  TrackerUserAttributeInputValue,
  TrackerUserAttributes,
} from '../types.js';
import { isPlainObject } from '../utils/object.js';

/** Supported application marker attribute grammar after ASCII lowercasing. */
const MARKER_ATTRIBUTE_NAME_PATTERN = /^(?:data|aria)-[a-z0-9_.:-]+$/u;

/** Reserved marker attributes owned by the browser integration or Tracker. */
const RESERVED_MARKER_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(['class', 'style', 'id', 'tabindex', 'title']);

/** Issue produced while normalizing one public marker attribute map. */
interface TrackerMarkerAttributeIssue {
  /** Stable issue category used by validation diagnostics. */
  kind: 'collision' | 'name' | 'reserved' | 'value';
  /** Original input name. */
  name: string;
  /** Normalized name when available. */
  normalizedName: string;
  /** Original input value. */
  value: unknown;
}

/** Marker attribute normalization result used by options and rule validation. */
interface TrackerMarkerAttributeNormalizationResult {
  /** Normalized renderer-facing attributes. */
  attributes: TrackerNormalizedMarkerAttributes;
  /** Validation issues found in the input map. */
  issues: TrackerMarkerAttributeIssue[];
}

/**
 * Converts ASCII uppercase letters to lowercase without changing other code points.
 *
 * @param value - Input string.
 * @returns ASCII-lowercase string.
 */
function toAsciiLowercase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

/**
 * Defines one own attribute property without invoking the legacy `__proto__` setter.
 *
 * @param record - Record receiving the property.
 * @param name - Attribute name.
 * @param value - Serialized attribute value.
 */
function defineAttributeValue(record: Record<string, string>, name: string, value: string): void {
  Object.defineProperty(record, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Checks whether a normalized attribute name is owned by Tracker.
 *
 * @param name - ASCII-lowercase attribute name.
 * @returns True for a reserved name.
 */
function isReservedMarkerAttributeName(name: string): boolean {
  return RESERVED_MARKER_ATTRIBUTE_NAMES.has(name) || name.startsWith('data-rxtt-');
}

/**
 * Serializes one non-null public marker attribute value.
 *
 * `role` is trimmed; other accepted values retain their original string form.
 *
 * @param name - Normalized attribute name.
 * @param value - Public value candidate.
 * @returns Serialized value or null when invalid.
 */
function serializeMarkerAttributeValue(name: string, value: unknown): string | null {
  if (name === 'role') {
    if (typeof value !== 'string') {
      return null;
    }

    const role = value.trim();

    return role === '' ? null : role;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

/**
 * Normalizes a global or rule marker attribute map.
 *
 * Null values become removals. Callers decide whether removals delete global
 * patch keys or remain persistent rule-level suppressions.
 *
 * @param input - Public attribute map candidate.
 * @returns Normalized values, removals, and validation issues.
 */
function normalizeMarkerAttributes(input: unknown): TrackerMarkerAttributeNormalizationResult {
  const values: Record<string, string> = {};
  const removals = new Set<string>();
  const issues: TrackerMarkerAttributeIssue[] = [];

  if (!isPlainObject(input)) {
    return {
      attributes: { values, removals },
      issues:
        input === undefined
          ? []
          : [
              {
                kind: 'value',
                name: '',
                normalizedName: '',
                value: input,
              },
            ],
    };
  }

  const normalizedNames = new Set<string>();

  Object.entries(input).forEach(([name, value]) => {
    const normalizedName = toAsciiLowercase(name);

    if (normalizedNames.has(normalizedName)) {
      issues.push({ kind: 'collision', name, normalizedName, value });
      return;
    }

    normalizedNames.add(normalizedName);

    if (isReservedMarkerAttributeName(normalizedName)) {
      issues.push({ kind: 'reserved', name, normalizedName, value });
      return;
    }

    if (normalizedName !== 'role' && !MARKER_ATTRIBUTE_NAME_PATTERN.test(normalizedName)) {
      issues.push({ kind: 'name', name, normalizedName, value });
      return;
    }

    if (value === null) {
      removals.add(normalizedName);
      return;
    }

    const serializedValue = serializeMarkerAttributeValue(normalizedName, value);

    if (serializedValue === null) {
      issues.push({ kind: 'value', name, normalizedName, value });
      return;
    }

    defineAttributeValue(values, normalizedName, serializedValue);
  });

  return {
    attributes: {
      values: values as TrackerNormalizedUserAttributes,
      removals,
    },
    issues,
  };
}

/**
 * Checks whether a value already has the normalized renderer-facing shape.
 *
 * @param value - Attribute value candidate.
 * @returns True for string values plus a string removal set.
 */
function isNormalizedMarkerAttributes(value: unknown): value is TrackerNormalizedMarkerAttributes {
  if (!isPlainObject(value) || !isPlainObject(value.values) || !(value.removals instanceof Set)) {
    return false;
  }

  return (
    Object.values(value.values).every((item) => typeof item === 'string') &&
    [...value.removals].every((item) => typeof item === 'string')
  );
}

/**
 * Copies normalized marker attributes for revalidation.
 *
 * @param attributes - Normalized attribute data.
 * @returns Detached values and removal set.
 */
function cloneNormalizedMarkerAttributes(
  attributes: TrackerNormalizedMarkerAttributes,
): TrackerNormalizedMarkerAttributes {
  return {
    values: { ...attributes.values },
    removals: new Set(attributes.removals),
  };
}

/**
 * Creates a round-trip-safe public attribute map from normalized rule data.
 *
 * @param attributes - Normalized rule attributes.
 * @returns Public values with null tombstones.
 */
function createPublicMarkerAttributes(attributes: TrackerNormalizedMarkerAttributes): TrackerUserAttributes {
  const result: TrackerUserAttributes = {};

  Object.entries(attributes.values).forEach(([name, value]) => {
    Object.defineProperty(result, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  });

  attributes.removals.forEach((name) => {
    Object.defineProperty(result, name, {
      configurable: true,
      enumerable: true,
      value: null satisfies TrackerUserAttributeInputValue,
      writable: true,
    });
  });

  return result;
}

/**
 * Compares two normalized marker attribute sets by values and removals.
 *
 * @param left - First normalized attribute set.
 * @param right - Second normalized attribute set.
 * @returns True when both sets have identical content.
 */
function areNormalizedMarkerAttributesEqual(
  left: TrackerNormalizedMarkerAttributes,
  right: TrackerNormalizedMarkerAttributes,
): boolean {
  const leftEntries = Object.entries(left.values);
  const rightKeys = Object.keys(right.values);

  return (
    leftEntries.length === rightKeys.length &&
    leftEntries.every(([name, value]) => right.values[name] === value) &&
    areStringSetsEqual(left.removals, right.removals)
  );
}

/**
 * Compares two string sets by content.
 *
 * @param left - First set.
 * @param right - Second set.
 * @returns True when both sets contain the same strings.
 */
function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export {
  areNormalizedMarkerAttributesEqual,
  areStringSetsEqual,
  cloneNormalizedMarkerAttributes,
  createPublicMarkerAttributes,
  isNormalizedMarkerAttributes,
  normalizeMarkerAttributes,
  toAsciiLowercase,
};
export type { TrackerMarkerAttributeIssue, TrackerMarkerAttributeNormalizationResult };
