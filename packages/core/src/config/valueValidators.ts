/**
 * Converts a clustering threshold candidate to percentage points.
 *
 * @param value - Threshold candidate.
 * @returns Threshold in percentage points, or null when invalid.
 */
function toClusteringThreshold(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Checks whether a value can represent a non-negative clustering threshold.
 *
 * @param value - Threshold candidate.
 * @returns True when value is a finite non-negative number.
 */
function isClusteringThreshold(value: unknown): boolean {
  return toClusteringThreshold(value) !== null;
}

export { isClusteringThreshold, toClusteringThreshold };
