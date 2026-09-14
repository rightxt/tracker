import type { TrackerRenderTarget } from '../types.js';

type RenderTargetMergeTable = Readonly<
  Record<TrackerRenderTarget, Readonly<Record<TrackerRenderTarget, TrackerRenderTarget>>>
>;

/**
 * Core render targets.
 *
 * These values are exported for integration packages, but vanilla users should
 * trigger rendering through Tracker.render() rather than selecting targets.
 */
const RENDER_TARGETS = Object.freeze({
  VIEWPORT: 'viewport',
  TRACK: 'track',
  MARKERS: 'markers',
  MARKER_PRESENTATION: 'marker-presentation',
  ALL: 'all',
} as const);

/** Core render target values. */
const RENDER_TARGET_VALUES: ReadonlyArray<TrackerRenderTarget> = Object.freeze(
  Object.values(RENDER_TARGETS) as TrackerRenderTarget[],
);

/** Valid internal render targets. */
const RENDER_TARGET_VALUE_SET = Object.freeze(new Set(RENDER_TARGET_VALUES)) as ReadonlySet<TrackerRenderTarget>;

/**
 * Target merge table.
 *
 * The table reflects Tracker internal render semantics:
 * - viewport updates only viewport;
 * - track updates track and viewport;
 * - markers updates markers and viewport;
 * - all updates everything.
 */
const TARGET_MERGE_TABLE: RenderTargetMergeTable = Object.freeze({
  [RENDER_TARGETS.VIEWPORT]: Object.freeze({
    [RENDER_TARGETS.VIEWPORT]: RENDER_TARGETS.VIEWPORT,
    [RENDER_TARGETS.TRACK]: RENDER_TARGETS.TRACK,
    [RENDER_TARGETS.MARKERS]: RENDER_TARGETS.MARKERS,
    [RENDER_TARGETS.MARKER_PRESENTATION]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.ALL]: RENDER_TARGETS.ALL,
  }),
  [RENDER_TARGETS.TRACK]: Object.freeze({
    [RENDER_TARGETS.VIEWPORT]: RENDER_TARGETS.TRACK,
    [RENDER_TARGETS.TRACK]: RENDER_TARGETS.TRACK,
    [RENDER_TARGETS.MARKERS]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.MARKER_PRESENTATION]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.ALL]: RENDER_TARGETS.ALL,
  }),
  [RENDER_TARGETS.MARKERS]: Object.freeze({
    [RENDER_TARGETS.VIEWPORT]: RENDER_TARGETS.MARKERS,
    [RENDER_TARGETS.TRACK]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.MARKERS]: RENDER_TARGETS.MARKERS,
    [RENDER_TARGETS.MARKER_PRESENTATION]: RENDER_TARGETS.MARKERS,
    [RENDER_TARGETS.ALL]: RENDER_TARGETS.ALL,
  }),
  [RENDER_TARGETS.MARKER_PRESENTATION]: Object.freeze({
    [RENDER_TARGETS.VIEWPORT]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.TRACK]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.MARKERS]: RENDER_TARGETS.MARKERS,
    [RENDER_TARGETS.MARKER_PRESENTATION]: RENDER_TARGETS.MARKER_PRESENTATION,
    [RENDER_TARGETS.ALL]: RENDER_TARGETS.ALL,
  }),
  [RENDER_TARGETS.ALL]: Object.freeze({
    [RENDER_TARGETS.VIEWPORT]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.TRACK]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.MARKERS]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.MARKER_PRESENTATION]: RENDER_TARGETS.ALL,
    [RENDER_TARGETS.ALL]: RENDER_TARGETS.ALL,
  }),
});

/**
 * Checks whether a value is a supported internal render target.
 *
 * @param target - Target candidate.
 * @returns True when target is supported.
 */
function isRenderTarget(target: unknown): target is TrackerRenderTarget {
  return typeof target === 'string' && RENDER_TARGET_VALUE_SET.has(target as TrackerRenderTarget);
}

/**
 * Merges two internal render targets into the minimal target that preserves
 * correctness.
 *
 * @param currentTarget - Existing target.
 * @param nextTarget - New target.
 * @returns Merged target.
 */
function mergeRenderTargets(
  currentTarget: TrackerRenderTarget | null,
  nextTarget: TrackerRenderTarget,
): TrackerRenderTarget {
  if (!isRenderTarget(nextTarget)) {
    return currentTarget || RENDER_TARGETS.ALL;
  }

  if (currentTarget === null) {
    return nextTarget;
  }

  if (!isRenderTarget(currentTarget)) {
    return RENDER_TARGETS.ALL;
  }

  return TARGET_MERGE_TABLE[currentTarget]?.[nextTarget] || RENDER_TARGETS.ALL;
}

export { RENDER_TARGETS, isRenderTarget, mergeRenderTargets };
