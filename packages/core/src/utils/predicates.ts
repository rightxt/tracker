/**
 * Checks whether a value is a finite number.
 *
 * @param value - Value to check.
 * @returns True when the value is finite.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Checks whether a value is a non-empty string.
 *
 * @param value - Value to check.
 * @returns True when the value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Checks whether a value is a valid opacity.
 *
 * @param value - Value to check.
 * @returns True when the value is a number from 0 to 1.
 */
function isOpacity(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

export { isFiniteNumber, isNonEmptyString, isOpacity };
