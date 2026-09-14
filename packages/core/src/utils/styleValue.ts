import { isPlainObject } from './object.js';

/**
 * Returns a CSS variable value when it is a usable string or number.
 *
 * @param value - CSS value candidate.
 * @returns CSS value or null.
 */
function toCssValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }

  return null;
}

/**
 * Copies a plain object into a CSS value map.
 *
 * @param map - CSS value map candidate.
 * @returns CSS value map.
 */
function createCssValueMap(map: unknown): Record<string, string> {
  if (!isPlainObject(map)) {
    return {};
  }

  return Object.entries(map).reduce<Record<string, string>>((result, [name, value]) => {
    const cssValue = toCssValue(value);

    if (typeof name === 'string' && name !== '' && cssValue !== null) {
      result[name] = cssValue;
    }

    return result;
  }, {});
}

/**
 * Returns a finite non-negative percentage number.
 *
 * @param value - Percentage candidate.
 * @returns Percentage number.
 */
function getPercentNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Converts a percent number candidate to a CSS percentage value.
 *
 * @param value - Percentage candidate.
 * @returns CSS percentage value.
 */
function toPercent(value: unknown): string {
  return `${getPercentNumber(value)}%`;
}

export { createCssValueMap, getPercentNumber, toCssValue, toPercent };
