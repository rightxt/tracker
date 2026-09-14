import type { TrackerOptions, TrackerOptionsDiff } from '../types.js';
import { areValuesEqual } from '../utils/object.js';
import { getPath } from '../utils/path.js';

/** Paths that affect diagnostics behavior. */
const DIAGNOSTICS_PATHS: ReadonlyArray<string> = Object.freeze([
  'diagnostics.warnings',
  'diagnostics.metrics',
  'diagnostics.output',
]);

/** Paths that require interaction controller updates. */
const INTERACTION_PATHS: ReadonlyArray<string> = Object.freeze([
  'orientation',
  'interaction.activation',
  'interaction.drag',
  'a11y.enabled',
  'a11y.keyboard',
]);

/**
 * Paths that require marker records, marker geometry, clustering or marker DOM
 * to be synchronized.
 */
const MARKER_PATHS: ReadonlyArray<string> = Object.freeze([
  'orientation',
  'clustering.enabled',
  'clustering.threshold',
]);

/** Paths that only require late marker-presentation resolution. */
const MARKER_PRESENTATION_PATHS: ReadonlyArray<string> = Object.freeze([
  'marker.className',
  'marker.attributes',
  'marker.title',
]);

/**
 * Paths that require observer reconnection.
 *
 * Observer changes do not imply visual render by themselves. Tracker must call
 * ObserverController.update() after mount even when replaceOptions() was called
 * with render:false.
 */
const OBSERVER_PATHS: ReadonlyArray<string> = Object.freeze([
  'updates.mutation.enabled',
  'updates.mutation.targets',
  'updates.mutation.options.childList',
  'updates.mutation.options.subtree',
  'updates.mutation.options.attributes',
  'updates.mutation.options.attributeFilter',
  'updates.mutation.options.attributeOldValue',
  'updates.mutation.options.characterData',
  'updates.mutation.options.characterDataOldValue',
  'updates.mutation.debounce',
  'updates.resize.enabled',
  'updates.resize.targets',
  'updates.resize.debounce',
  'updates.scroll.enabled',
  'updates.interval.enabled',
  'updates.interval.delay',
]);

/** Paths that affect CSS custom properties on the root element. */
const STYLE_PATHS: ReadonlyArray<string> = Object.freeze(['cssVariables']);

/**
 * Paths that affect root track state, service attributes, user classes and
 * accessibility attributes.
 */
const TRACK_PATHS: ReadonlyArray<string> = Object.freeze([
  'orientation',
  'placement',
  'track.className',
  'viewport.className',
  'markerLayer.className',
  'a11y.enabled',
  'a11y.keyboard',
  'a11y.label',
]);

/** Paths that affect viewport geometry or visibility. */
const VIEWPORT_PATHS: ReadonlyArray<string> = Object.freeze(['orientation', 'viewport.enabled']);

/**
 * Calculates which subsystems became dirty after options changed.
 *
 * The returned flags are internal and are not part of the public API.
 *
 * @param previousOptions - Previous normalized and validated options.
 * @param nextOptions - Next normalized and validated options.
 * @returns Option diff flags.
 */
function diffOptions(previousOptions: TrackerOptions, nextOptions: TrackerOptions): TrackerOptionsDiff {
  const track = hasChanged(previousOptions, nextOptions, TRACK_PATHS);
  const styles = hasChanged(previousOptions, nextOptions, STYLE_PATHS);
  const viewport = hasChanged(previousOptions, nextOptions, VIEWPORT_PATHS);
  const markers = hasChanged(previousOptions, nextOptions, MARKER_PATHS);
  const markerPresentation = hasChanged(previousOptions, nextOptions, MARKER_PRESENTATION_PATHS);
  const observers = hasChanged(previousOptions, nextOptions, OBSERVER_PATHS);
  const interaction = hasChanged(previousOptions, nextOptions, INTERACTION_PATHS);
  const diagnostics = hasChanged(previousOptions, nextOptions, DIAGNOSTICS_PATHS);

  const changed =
    track || styles || viewport || markers || markerPresentation || observers || interaction || diagnostics;

  return {
    changed,
    track,
    styles,
    viewport,
    markers,
    markerPresentation,
    observers,
    interaction,
    diagnostics,
  };
}

/**
 * Checks whether any path has changed between two option objects.
 *
 * @param previousOptions - Previous options.
 * @param nextOptions - Next options.
 * @param paths - Dot-separated paths.
 * @returns True when at least one path changed.
 */
function hasChanged(
  previousOptions: TrackerOptions,
  nextOptions: TrackerOptions,
  paths: ReadonlyArray<string>,
): boolean {
  return paths.some(
    (path) =>
      !areValuesEqual(
        getPath(previousOptions as unknown as Record<string, unknown>, path),
        getPath(nextOptions as unknown as Record<string, unknown>, path),
      ),
  );
}

export { diffOptions };
