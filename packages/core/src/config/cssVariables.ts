import type { TrackerCssVariablePatch, TrackerCssVariableValue, TrackerRuleCssVariables } from '../types.js';
import { isPlainObject } from '../utils/object.js';

/** Public CSS custom-property scopes accepted by configuration validation. */
type TrackerCssVariableScope = 'root' | 'rule-marker';

/** Restricted public custom-property name grammar. */
const CSS_VARIABLE_NAME_PATTERN = /^--[A-Za-z_][A-Za-z0-9_-]*$/u;

/** Reserved public Tracker custom properties accepted at root scope. */
const ROOT_CSS_VARIABLE_NAMES: ReadonlySet<string> = new Set([
  '--rxtt-track-thickness',
  '--rxtt-track-offset',
  '--rxtt-track-start',
  '--rxtt-track-end',
  '--rxtt-track-bg',
  '--rxtt-track-border-color',
  '--rxtt-track-border-style',
  '--rxtt-track-border-width',
  '--rxtt-track-z-index',
  '--rxtt-track-overflow',
  '--rxtt-track-contain',
  '--rxtt-viewport-bg',
  '--rxtt-marker-min-size',
  '--rxtt-marker-bg',
  '--rxtt-marker-ring-color',
  '--rxtt-marker-ring-width',
  '--rxtt-marker-border-color',
  '--rxtt-marker-border-style',
  '--rxtt-marker-border-width',
  '--rxtt-marker-border-radius',
  '--rxtt-marker-hover-ring-color',
  '--rxtt-marker-hover-ring-width',
  '--rxtt-marker-selected-ring-color',
  '--rxtt-marker-selected-ring-width',
  '--rxtt-marker-opacity',
  '--rxtt-cluster-bg',
  '--rxtt-cluster-font-size',
  '--rxtt-cluster-text-color',
  '--rxtt-cluster-content',
  '--rxtt-focus-outline-color',
  '--rxtt-focus-outline-offset',
  '--rxtt-focus-outline-style',
  '--rxtt-focus-outline-width',
]);

/** Public Tracker custom properties accepted on marker and cluster items. */
const RULE_MARKER_CSS_VARIABLE_NAMES: ReadonlySet<string> = new Set([
  '--rxtt-marker-min-size',
  '--rxtt-marker-bg',
  '--rxtt-marker-ring-color',
  '--rxtt-marker-ring-width',
  '--rxtt-marker-border-color',
  '--rxtt-marker-border-style',
  '--rxtt-marker-border-width',
  '--rxtt-marker-border-radius',
  '--rxtt-marker-hover-ring-color',
  '--rxtt-marker-hover-ring-width',
  '--rxtt-marker-selected-ring-color',
  '--rxtt-marker-selected-ring-width',
  '--rxtt-marker-opacity',
  '--rxtt-cluster-bg',
  '--rxtt-cluster-font-size',
  '--rxtt-cluster-text-color',
  '--rxtt-cluster-content',
]);

/** Renderer-owned geometry variables rejected from public configuration. */
const RENDERER_CSS_VARIABLE_NAMES: ReadonlySet<string> = new Set([
  '--rxtt-viewport-start',
  '--rxtt-viewport-size',
  '--rxtt-marker-start',
  '--rxtt-marker-size',
]);

/** Reserved namespace for public and renderer-owned Tracker custom properties. */
const TRACKER_CSS_VARIABLE_PREFIX = '--rxtt-';

/**
 * Defines one own record property without invoking the legacy `__proto__` setter.
 *
 * @param record - Record receiving the property.
 * @param name - Property name.
 * @param value - Property value.
 */
function defineRecordValue(record: Record<string, string>, name: string, value: string): void {
  Object.defineProperty(record, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Returns a validation error for a custom-property name.
 *
 * Application-owned names outside the exact `--rxtt-` namespace are accepted
 * in both public scopes.
 *
 * @param name - Custom-property name.
 * @param scope - Public configuration scope.
 * @returns Error description or null when the name is accepted.
 */
function getCssVariableNameError(name: string, scope: TrackerCssVariableScope): string | null {
  if (!CSS_VARIABLE_NAME_PATTERN.test(name)) {
    return `CSS custom property "${name}" does not match the supported name grammar.`;
  }

  if (RENDERER_CSS_VARIABLE_NAMES.has(name)) {
    return `CSS custom property "${name}" is owned by the renderer.`;
  }

  if (!name.startsWith(TRACKER_CSS_VARIABLE_PREFIX)) {
    return null;
  }

  const allowedNames = scope === 'root' ? ROOT_CSS_VARIABLE_NAMES : RULE_MARKER_CSS_VARIABLE_NAMES;

  if (allowedNames.has(name)) {
    return null;
  }

  if (ROOT_CSS_VARIABLE_NAMES.has(name)) {
    return `CSS custom property "${name}" is not accepted at rule marker scope.`;
  }

  return `CSS custom property "${name}" is not a known public Tracker variable.`;
}

/**
 * Checks a root custom-property patch value.
 *
 * @param value - Value candidate.
 * @returns True for a string (forwarded verbatim, including empty) or a deletion tombstone.
 */
function isRootCssVariableValue(value: unknown): value is TrackerCssVariableValue | null {
  return value === null || typeof value === 'string';
}

/**
 * Checks a complete rule custom-property value.
 *
 * @param value - Value candidate.
 * @returns True for a string, forwarded verbatim including empty.
 */
function isRuleCssVariableValue(value: unknown): value is TrackerCssVariableValue {
  return typeof value === 'string';
}

/**
 * Removes root deletion tombstones after validation.
 *
 * @param variables - Validated root patch candidate.
 * @returns Complete normalized string map.
 */
function normalizeRootCssVariables(variables: unknown): Record<string, TrackerCssVariableValue> {
  if (!isPlainObject(variables)) {
    return {};
  }

  return Object.entries(variables).reduce<Record<string, TrackerCssVariableValue>>((result, [name, value]) => {
    if (typeof value === 'string') {
      defineRecordValue(result, name, value);
    }

    return result;
  }, {});
}

/**
 * Copies a validated complete rule custom-property map.
 *
 * @param variables - Rule map candidate.
 * @returns Complete normalized string map.
 */
function normalizeRuleCssVariables(variables: unknown): TrackerRuleCssVariables {
  if (!isPlainObject(variables)) {
    return {};
  }

  return Object.entries(variables).reduce<TrackerRuleCssVariables>((result, [name, value]) => {
    if (typeof value === 'string') {
      defineRecordValue(result, name, value);
    }

    return result;
  }, {});
}

/**
 * Checks whether a candidate is a plain custom-property map.
 *
 * @param variables - Map candidate.
 * @returns True for a plain record.
 */
function isCssVariableMap(variables: unknown): variables is TrackerCssVariablePatch {
  return isPlainObject(variables);
}

export {
  ROOT_CSS_VARIABLE_NAMES,
  getCssVariableNameError,
  isCssVariableMap,
  isRootCssVariableValue,
  isRuleCssVariableValue,
  normalizeRootCssVariables,
  normalizeRuleCssVariables,
};
export type { TrackerCssVariableScope };
