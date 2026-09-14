/**
 * Converts a document coordinate into a track percentage.
 *
 * @param value - Document coordinate.
 * @param contentSize - Content size on the main axis.
 * @returns Percentage in the 0..100 range.
 */
function toTrackPercent(value: number, contentSize: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(contentSize) || contentSize <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (value / contentSize) * 100));
}

export { toTrackPercent };
