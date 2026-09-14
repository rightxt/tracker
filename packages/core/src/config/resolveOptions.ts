import type { TrackerResolvedOptions } from '../types.js';
import { TrackerConfigurationError } from '../errors.js';
import { findFirstOwnUndefinedPath } from '../utils/object.js';
import { hasPath } from '../utils/path.js';
import { assertConfigurationDiagnostics } from './assertConfigurationDiagnostics.js';
import { createDefaultOptions } from './defaultOptions.js';
import { normalizeOptions } from './normalizeOptions.js';
import { ALLOWED_OPTIONS_SHAPE } from './optionSchema.js';
import { validateOptions } from './validateOptions.js';

/** Context accepted by resolveTrackerOptions(). */
interface TrackerOptionsResolutionContext {
  /**
   * Committed options used as the validation baseline for restoring invalid
   * fields. Defaults are used when omitted, which is the constructor case.
   */
  previousOptions?: TrackerResolvedOptions;
  /**
   * Whether the input replaces the whole configuration from defaults. Patch
   * updates merge into {@link previousOptions} instead.
   */
  replace?: boolean;
}

/**
 * Option paths guaranteed to exist on committed options.
 *
 * Mirrors the required fields of {@link TrackerResolvedOptions}. Nested paths
 * imply their parent branches, so listing leaves is enough. Native
 * MutationObserver fields are intentionally absent: only the forwarded options
 * object itself is guaranteed.
 */
const RESOLVED_OPTION_PATHS: readonly string[] = Object.freeze([
  'orientation',
  'placement',
  'cssVariables',
  'track.className',
  'viewport.enabled',
  'viewport.className',
  'markerLayer.className',
  'marker.attributes',
  'marker.className',
  'marker.title',
  'clustering.enabled',
  'clustering.threshold',
  'updates.mutation.enabled',
  'updates.mutation.targets',
  'updates.mutation.options',
  'updates.mutation.debounce',
  'updates.resize.enabled',
  'updates.resize.targets',
  'updates.resize.debounce',
  'updates.scroll.enabled',
  'updates.interval.enabled',
  'updates.interval.delay',
  'interaction.activation',
  'interaction.drag',
  'a11y.enabled',
  'a11y.keyboard',
  'a11y.label',
  'diagnostics.warnings',
  'diagnostics.metrics',
]);

/**
 * Asserts that a validated options candidate is structurally complete.
 *
 * Guards the {@link TrackerResolvedOptions} contract at the single boundary
 * where it is established, so a normalization or validation regression that
 * drops a guaranteed branch fails loudly here instead of surfacing later as an
 * unexpected `undefined` in code that trusts the resolved type.
 *
 * @param options - Validated options candidate.
 * @throws TrackerConfigurationError when a guaranteed option path is missing.
 */
function assertResolvedTrackerOptions(options: unknown): asserts options is TrackerResolvedOptions {
  const source = options as Record<string, unknown>;
  const missingPaths = RESOLVED_OPTION_PATHS.filter((path) => !hasPath(source, path));

  if (missingPaths.length > 0) {
    throw new TrackerConfigurationError(
      `Tracker options resolution produced incomplete options: ${missingPaths.join(', ')}.`,
      { code: 'ERR_TRACKER_INVALID_CONFIGURATION' },
    );
  }
}

/**
 * Normalizes, validates and commits user option input in one step.
 *
 * This is the only boundary that turns partial {@link TrackerOptions} input
 * into complete {@link TrackerResolvedOptions}. Completeness comes from
 * merging into a complete baseline before validation: the default options for
 * a replacement, the committed options for a patch.
 *
 * @param inputOptions - Raw user option input.
 * @param context - Resolution context.
 * @returns Complete validated options.
 * @throws TrackerConfigurationError when validation reports errors, a known
 * option field is explicitly `undefined`, or the resolved result is
 * incomplete.
 */
function resolveTrackerOptions(
  inputOptions: unknown,
  context: TrackerOptionsResolutionContext = {},
): TrackerResolvedOptions {
  const undefinedOptionPath = findFirstOwnUndefinedPath(inputOptions, ALLOWED_OPTIONS_SHAPE);

  if (undefinedOptionPath !== null) {
    throw new TrackerConfigurationError(`Tracker option "${undefinedOptionPath}" must not be undefined.`, {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const { replace = true } = context;
  const defaultOptions = createDefaultOptions();
  const previousOptions = context.previousOptions ?? defaultOptions;
  const normalizedOptions = normalizeOptions(
    inputOptions,
    replace ? { baseOptions: defaultOptions } : { currentOptions: previousOptions },
  );
  const validationResult = validateOptions(normalizedOptions, { previousOptions, inputOptions });

  assertConfigurationDiagnostics(validationResult.diagnostics);

  const resolvedOptions = validationResult.options;

  assertResolvedTrackerOptions(resolvedOptions);

  return resolvedOptions;
}

export { assertResolvedTrackerOptions, resolveTrackerOptions };
export type { TrackerOptionsResolutionContext };
