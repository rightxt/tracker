/** Returns a nearest-rank percentile from a non-empty numeric series. */
function getPercentile(values, percentile) {
  const sortedValues = [...values].sort((left, right) => left - right);
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * percentile) - 1));

  return sortedValues[index];
}

/** Returns the median from a non-empty numeric series. */
function median(values) {
  return getPercentile(values, 0.5);
}

/**
 * Summarizes durations without implying population precision.
 *
 * Deliberately omits a p90: both current callers sample too few runs (5-9)
 * for the nearest-rank percentile to differ from `maxMs`, which would make a
 * published p90 redundant rather than a distinct statistic.
 */
function summarizeDurations(values) {
  return {
    maxMs: Math.max(...values),
    medianMs: median(values),
    minMs: Math.min(...values),
  };
}

export { getPercentile, median, summarizeDurations };
