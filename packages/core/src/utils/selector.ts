import { toError } from './diagnostic.js';
import type { TrackerSourceRoot } from '../types.js';

/**
 * Returns a selector syntax error when validation can be performed.
 *
 * When selectorRoot is null, validation is intentionally skipped. This keeps
 * constructor-time rule processing independent from the global document. Mounted
 * Tracker instances revalidate selectors later with a real document root.
 *
 * @param selector - CSS selector candidate.
 * @param selectorRoot - Selector validation root.
 * @returns Selector error or null when valid or not validated.
 */
function getSelectorError(selector: unknown, selectorRoot: TrackerSourceRoot | null = null): Error | null {
  const normalizedSelector = normalizeSelector(selector);

  if (normalizedSelector === '') {
    return new Error('Selector must be a non-empty string.');
  }

  if (!isSelectorValidationRoot(selectorRoot)) {
    return null;
  }

  try {
    selectorRoot.querySelector(normalizedSelector);
    return null;
  } catch (error) {
    return toError(error);
  }
}

/**
 * Checks whether a value can validate CSS selectors through querySelector().
 *
 * Intentionally checks querySelector() only: syntax validation calls
 * querySelector(), while marker queries use the separate isSourceRoot()
 * contract based on querySelectorAll().
 *
 * @param value - Query root candidate.
 * @returns True when querySelector() is available.
 */
function isSelectorValidationRoot(value: unknown): value is TrackerSourceRoot {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).querySelector === 'function'
  );
}

/**
 * Normalizes a selector for internal storage and selector uniqueness checks.
 *
 * The normalization is intentionally limited to trim(). It does not parse,
 * rewrite or otherwise transform CSS selectors.
 *
 * @param selector - Selector candidate.
 * @returns Normalized selector.
 */
function normalizeSelector(selector: unknown): string {
  return typeof selector === 'string' ? selector.trim() : '';
}

export { getSelectorError, normalizeSelector };
