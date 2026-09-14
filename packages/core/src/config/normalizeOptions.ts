import type { TrackerOptions, TrackerOptionsCandidate, TrackerOptionsNormalizationContext } from '../types.js';
import { createDefaultOptions } from './defaultOptions.js';
import { toAsciiLowercase } from './markerAttributes.js';
import { cloneValue, hasOwn, isPlainObject, mergeOptions } from '../utils/object.js';

/**
 * Normalizes a partial options object into the internal options candidate shape.
 *
 * It only merges the user object with the selected base; warnings, semantic
 * validation, DOM reads, and observer-target resolution happen elsewhere.
 *
 * Invalid known values are intentionally preserved so validateOptions() can
 * restore previous valid values and emit precise diagnostics.
 *
 * Style option objects remain in their public JS shape at this stage. They are
 * validated by validateOptions() and mapped to CSS custom properties by the
 * rendering/style layer through the style option whitelist.
 *
 * @param options - User options or partial options.
 * @param context - Normalization context.
 */
function normalizeOptions(
  options: unknown = {},
  context: TrackerOptionsNormalizationContext = {},
): TrackerOptionsCandidate {
  const baseOptions = resolveBaseOptions(context);

  if (!isPlainObject(options)) {
    return mergeOptions(baseOptions as Record<string, unknown>, {}) as TrackerOptionsCandidate;
  }

  const normalizedOptions = mergeOptions(baseOptions as Record<string, unknown>, options) as TrackerOptionsCandidate;

  normalizeMarkerAttributePatch(normalizedOptions, baseOptions, options);
  preserveDiagnosticsOutput(normalizedOptions, baseOptions, options);

  return normalizedOptions;
}

/**
 * Preserves the caller-owned diagnostics sink as an opaque callback object.
 *
 * @param result - Mutable normalized option candidate.
 * @param baseOptions - Base options selected for the update mode.
 * @param inputOptions - Raw public options object.
 */
function preserveDiagnosticsOutput(
  result: Partial<TrackerOptions>,
  baseOptions: Partial<TrackerOptions>,
  inputOptions: Record<string, unknown>,
): void {
  const inputDiagnostics = inputOptions.diagnostics;
  const hasInputOutput = isPlainObject(inputDiagnostics) && hasOwn(inputDiagnostics, 'output');
  const output = hasInputOutput ? inputDiagnostics.output : baseOptions.diagnostics?.output;

  if (isPlainObject(result.diagnostics) && output !== undefined) {
    result.diagnostics.output = output as never;
  }
}

/**
 * Applies global marker attribute patches by normalized ASCII-lowercase name.
 *
 * Generic option merging cannot treat differently cased HTML attribute names
 * as one key. Raw collisions remain visible to validateOptions() and reject the
 * complete candidate.
 *
 * @param result - Mutable normalized option candidate.
 * @param baseOptions - Base options selected for patch or replacement mode.
 * @param inputOptions - Raw public options object.
 */
function normalizeMarkerAttributePatch(
  result: Partial<TrackerOptions>,
  baseOptions: Partial<TrackerOptions>,
  inputOptions: Record<string, unknown>,
): void {
  if (!isPlainObject(inputOptions.marker) || !hasOwn(inputOptions.marker, 'attributes')) {
    return;
  }

  const inputAttributes = inputOptions.marker.attributes;

  if (!isPlainObject(inputAttributes) || !isPlainObject(result.marker)) {
    return;
  }

  const attributes = isPlainObject(baseOptions.marker?.attributes)
    ? (cloneValue(baseOptions.marker.attributes) as Record<string, unknown>)
    : {};

  Object.entries(inputAttributes).forEach(([name, value]) => {
    Object.defineProperty(attributes, toAsciiLowercase(name), {
      configurable: true,
      enumerable: true,
      value: cloneValue(value),
      writable: true,
    });
  });

  result.marker.attributes = attributes as never;
}

/**
 * Resolves base options for normalization.
 *
 * Explicit base options have priority over current options to preserve the
 * caller-selected normalization mode. Current options are used for partial
 * runtime updates when no explicit base is provided.
 *
 * @param context - Normalization context.
 */
function resolveBaseOptions(context: TrackerOptionsNormalizationContext): Partial<TrackerOptions> {
  if (isPlainObject(context.baseOptions)) {
    return context.baseOptions as Partial<TrackerOptions>;
  }

  if (isPlainObject(context.currentOptions)) {
    return context.currentOptions as Partial<TrackerOptions>;
  }

  return createDefaultOptions();
}

export { normalizeOptions };
