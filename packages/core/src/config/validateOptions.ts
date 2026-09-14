import type {
  TrackerDiagnosticCode,
  TrackerObserverTargetsResolver,
  TrackerOptions,
  TrackerOptionsValidationContext,
  TrackerOptionsValidationResult,
  TrackerOrientation,
  TrackerPlacement,
  TrackerValidationDiagnostic,
} from '../types.js';
import { ORIENTATIONS, PLACEMENTS } from '../constants.js';
import { createDefaultOptions } from './defaultOptions.js';
import {
  getCssVariableNameError,
  isCssVariableMap,
  isRootCssVariableValue,
  normalizeRootCssVariables,
} from './cssVariables.js';
import { normalizeMarkerAttributes } from './markerAttributes.js';
import type { TrackerMarkerAttributeIssue } from './markerAttributes.js';
import { ALLOWED_OPTIONS_SHAPE } from './optionSchema.js';
import { createDiagnostic } from '../utils/diagnostic.js';
import { cloneValue, collectUnknownKeys, hasOwn, isPlainObject } from '../utils/object.js';
import { deletePath, getPath, hasPath, setPath } from '../utils/path.js';
import { isFiniteNumber, isNonEmptyString } from '../utils/predicates.js';
import { getReservedClassToken, normalizeUserClassName } from '../utils/className.js';

/** Fallback placement for each orientation. */
const DEFAULT_PLACEMENT_BY_ORIENTATION: Readonly<Record<TrackerOrientation, TrackerPlacement>> = Object.freeze({
  [ORIENTATIONS.VERTICAL]: PLACEMENTS.LEFT,
  [ORIENTATIONS.HORIZONTAL]: PLACEMENTS.TOP,
});

/** Valid placement values for each orientation. */
const PLACEMENTS_BY_ORIENTATION: Readonly<Record<TrackerOrientation, ReadonlyArray<TrackerPlacement>>> = Object.freeze({
  [ORIENTATIONS.VERTICAL]: Object.freeze([PLACEMENTS.LEFT, PLACEMENTS.RIGHT]),
  [ORIENTATIONS.HORIZONTAL]: Object.freeze([PLACEMENTS.TOP, PLACEMENTS.BOTTOM]),
});

/**
 * Checks whether a diagnostics output is null or a sink with optional
 * function methods.
 *
 * An own `warn` or `error` property is rejected unless its value is a
 * function; omitting the property entirely is the only way to skip it.
 */
function isDiagnosticsOutput(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const sink = value as { error?: unknown; warn?: unknown };

  const isValidSinkMethod = (key: 'error' | 'warn'): boolean => !hasOwn(sink, key) || typeof sink[key] === 'function';

  return isValidSinkMethod('warn') && isValidSinkMethod('error');
}

interface ValidateOptionsPathContext {
  previousOptions: Partial<TrackerOptions>;
  validOptions: Partial<TrackerOptions>;
}

interface ValidateOptionsPathParams extends ValidateOptionsPathContext {
  code: TrackerDiagnosticCode;
  diagnostics: TrackerValidationDiagnostic[];
  message: string;
  path: string;
}

/**
 * Checks whether a value is a valid MutationObserver attributeFilter.
 *
 * @param value - Value to check.
 * @returns True when value is an array of non-empty strings.
 */
function isAttributeFilter(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    Array.from(
      { length: value.length },
      (_, index) => index in value && typeof value[index] === 'string' && value[index] !== '',
    ).every(Boolean)
  );
}

/**
 * Restores a valid mutation observer configuration when no observation type is enabled.
 *
 * @param validOptions - Mutable validated options candidate.
 * @param previousOptions - Previously committed options.
 * @param diagnostics - Mutable validation diagnostics.
 */
function validateMutationObservationTypes(
  validOptions: Partial<TrackerOptions>,
  previousOptions: Partial<TrackerOptions>,
  diagnostics: TrackerValidationDiagnostic[],
): void {
  const mutationOptions = validOptions.updates?.mutation?.options;

  const attributesEnabled =
    mutationOptions?.attributes === true ||
    Array.isArray(mutationOptions?.attributeFilter) ||
    mutationOptions?.attributeOldValue === true;
  const characterDataEnabled =
    mutationOptions?.characterData === true || mutationOptions?.characterDataOldValue === true;

  if (mutationOptions?.childList !== false || attributesEnabled || characterDataEnabled) {
    return;
  }

  setPath(
    validOptions as unknown as Record<string, unknown>,
    'updates.mutation.options',
    cloneValue(previousOptions.updates?.mutation?.options),
  );
  diagnostics.push(
    createDiagnostic(
      'warning',
      'invalid-option-value',
      'updates.mutation.options must enable childList, attributes, or characterData. Previous value was restored.',
      { path: 'updates.mutation.options' },
    ),
  );
}

/**
 * Checks whether a value is an observer target resolver function.
 *
 * @param value - Value to check.
 */
function isObserverTargetResolver(value: unknown): value is TrackerObserverTargetsResolver {
  return typeof value === 'function';
}

/**
 * Removes keys that are not present in the allowed options shape.
 *
 * The function keeps invalid known values so validators can restore them from
 * the previous valid state and emit precise diagnostics. Only unknown keys are
 * pruned.
 *
 * @param value - Options candidate.
 * @param allowedShape - Allowed shape.
 * @returns Object containing only known option keys.
 */
function pruneUnknownOptions(value: unknown, allowedShape: Record<string, unknown>): Partial<TrackerOptions> {
  if (!isPlainObject(value) || !isPlainObject(allowedShape)) {
    return {};
  }

  return Object.keys(allowedShape).reduce<Record<string, unknown>>((result, key) => {
    if (!hasOwn(value, key)) {
      return result;
    }

    const allowedValue = allowedShape[key];
    const inputValue = value[key];

    if (isPlainObject(allowedValue) && isPlainObject(inputValue)) {
      result[key] = pruneUnknownOptions(inputValue, allowedValue);
      return result;
    }

    result[key] = cloneValue(inputValue);
    return result;
  }, {}) as Partial<TrackerOptions>;
}

/**
 * Restores a nested path from previous options or removes it when no previous
 * valid value exists.
 *
 * @param validOptions - Mutable valid options object.
 * @param previousOptions - Previous valid options object.
 * @param path - Dot-separated path.
 */
function restorePath(
  validOptions: Partial<TrackerOptions>,
  previousOptions: Partial<TrackerOptions>,
  path: string,
): void {
  if (hasPath(previousOptions as unknown as Record<string, unknown>, path)) {
    setPath(
      validOptions as unknown as Record<string, unknown>,
      path,
      getPath(previousOptions as unknown as Record<string, unknown>, path),
    );
    return;
  }

  deletePath(validOptions as unknown as Record<string, unknown>, path);
}

/**
 * Restores option containers that were replaced with a non-object value.
 *
 * Walks the allowed options shape recursively; whenever a shape branch is
 * itself an object (not a leaf marker), the corresponding path in
 * validOptions must also be a plain object or absent. Any other value (e.g.
 * `null`) is rejected and the previous valid value is restored, mirroring
 * the existing behavior for invalid leaf values.
 *
 * @param validOptions - Mutable option candidate.
 * @param previousOptions - Previously committed options.
 * @param allowedShape - Allowed options shape (or a nested branch of it).
 * @param diagnostics - Mutable validation diagnostics.
 * @param basePath - Dot-separated path prefix for the current shape branch.
 */
function restoreInvalidOptionContainers(
  validOptions: Partial<TrackerOptions>,
  previousOptions: Partial<TrackerOptions>,
  allowedShape: Record<string, unknown>,
  diagnostics: TrackerValidationDiagnostic[],
  basePath = '',
): void {
  Object.keys(allowedShape).forEach((key) => {
    const allowedValue = allowedShape[key];

    if (!isPlainObject(allowedValue)) {
      return;
    }

    const path = basePath ? `${basePath}.${key}` : key;

    if (!hasPath(validOptions as unknown as Record<string, unknown>, path)) {
      return;
    }

    const value = getPath(validOptions as unknown as Record<string, unknown>, path);

    if (!isPlainObject(value)) {
      restorePath(validOptions, previousOptions, path);
      diagnostics.push(
        createDiagnostic('warning', 'invalid-option-value', `${path} must be a plain object.`, { path, value }),
      );
      return;
    }

    restoreInvalidOptionContainers(validOptions, previousOptions, allowedValue, diagnostics, path);
  });
}

/**
 * Validates and canonicalizes one application class-name path.
 *
 * @param validOptions - Mutable option candidate.
 * @param previousOptions - Previously committed options.
 * @param diagnostics - Mutable validation diagnostics.
 * @param path - Class-name option path.
 */
function validateAndNormalizeClassName(
  validOptions: Partial<TrackerOptions>,
  previousOptions: Partial<TrackerOptions>,
  diagnostics: TrackerValidationDiagnostic[],
  path: string,
): void {
  if (!hasPath(validOptions as unknown as Record<string, unknown>, path)) {
    return;
  }

  const value = getPath(validOptions as unknown as Record<string, unknown>, path);

  if (typeof value !== 'string') {
    restorePath(validOptions, previousOptions, path);
    diagnostics.push(
      createDiagnostic('warning', 'invalid-option-value', `${path} must be a string.`, {
        path,
        value,
      }),
    );
    return;
  }

  const reservedToken = getReservedClassToken(value);

  if (reservedToken !== null) {
    restorePath(validOptions, previousOptions, path);
    diagnostics.push(
      createDiagnostic(
        'warning',
        'reserved-class-name',
        `${path} contains reserved service class token "${reservedToken}".`,
        { path, token: reservedToken },
      ),
    );
    return;
  }

  setPath(validOptions as unknown as Record<string, unknown>, path, normalizeUserClassName(value));
}

/**
 * Validates and normalizes the root custom-property patch.
 *
 * Per-entry issues are detected from the raw input map when this call
 * supplied one directly, not from the merged candidate. The generic options
 * merge treats an own `undefined` patch value as omission and drops it before
 * this validator runs, which would otherwise silently accept an explicit
 * `undefined` custom-property value as a no-op instead of rejecting it.
 *
 * @param validOptions - Mutable option candidate.
 * @param previousOptions - Previously committed options.
 * @param inputOptions - Raw public options input.
 * @param diagnostics - Mutable validation diagnostics.
 */
function validateRootCssVariables(
  validOptions: Partial<TrackerOptions>,
  previousOptions: Partial<TrackerOptions>,
  inputOptions: Record<string, unknown>,
  diagnostics: TrackerValidationDiagnostic[],
): void {
  if (!hasOwn(validOptions, 'cssVariables')) {
    return;
  }

  const variables = validOptions.cssVariables;

  if (!isCssVariableMap(variables)) {
    restorePath(validOptions, previousOptions, 'cssVariables');
    diagnostics.push(
      createDiagnostic('warning', 'invalid-css-variables', 'cssVariables must be a plain object.', {
        path: 'cssVariables',
        value: variables,
      }),
    );
    return;
  }

  const rawVariables = hasOwn(inputOptions, 'cssVariables') ? inputOptions.cssVariables : undefined;
  const sourceVariables = isCssVariableMap(rawVariables) ? rawVariables : variables;

  const variableDiagnostics = Object.entries(sourceVariables).reduce<TrackerValidationDiagnostic[]>(
    (entries, [name, value]) => {
      const nameError = getCssVariableNameError(name, 'root');

      if (nameError !== null) {
        entries.push(
          createDiagnostic('warning', 'invalid-css-variable-name', nameError, {
            name,
            path: `cssVariables.${name}`,
          }),
        );
      }

      if (!isRootCssVariableValue(value)) {
        entries.push(
          createDiagnostic('warning', 'invalid-css-variable-value', `cssVariables.${name} must be a string or null.`, {
            name,
            path: `cssVariables.${name}`,
            value,
          }),
        );
      }

      return entries;
    },
    [],
  );

  if (variableDiagnostics.length > 0) {
    restorePath(validOptions, previousOptions, 'cssVariables');
    diagnostics.push(...variableDiagnostics);
    return;
  }

  validOptions.cssVariables = normalizeRootCssVariables(variables);
}

/**
 * Validates global marker attributes and removes patch tombstones.
 *
 * Raw input is inspected separately so differently cased keys that normalize
 * to one HTML attribute cannot silently overwrite each other.
 *
 * @param validOptions - Mutable option candidate.
 * @param previousOptions - Previously committed options.
 * @param inputOptions - Raw public options input.
 * @param diagnostics - Mutable validation diagnostics.
 */
function validateGlobalMarkerAttributes(
  validOptions: Partial<TrackerOptions>,
  previousOptions: Partial<TrackerOptions>,
  inputOptions: Record<string, unknown>,
  diagnostics: TrackerValidationDiagnostic[],
): void {
  if (!hasPath(validOptions as unknown as Record<string, unknown>, 'marker.attributes')) {
    return;
  }

  const rawAttributes =
    isPlainObject(inputOptions.marker) && hasOwn(inputOptions.marker, 'attributes')
      ? inputOptions.marker.attributes
      : undefined;
  const rawResult = normalizeMarkerAttributes(rawAttributes);
  const candidateResult = normalizeMarkerAttributes(validOptions.marker?.attributes);
  const issues = rawAttributes === undefined ? candidateResult.issues : rawResult.issues;

  if (issues.length > 0) {
    restorePath(validOptions, previousOptions, 'marker.attributes');
    issues.forEach((issue) => {
      diagnostics.push(createGlobalMarkerAttributeDiagnostic(issue));
    });
    return;
  }

  validOptions.marker!.attributes = { ...candidateResult.attributes.values };
}

/**
 * Creates a stable diagnostic for one global marker attribute issue.
 *
 * @param issue - Attribute normalization issue.
 * @returns Validation diagnostic.
 */
function createGlobalMarkerAttributeDiagnostic(issue: TrackerMarkerAttributeIssue): TrackerValidationDiagnostic {
  const details = {
    name: issue.name,
    normalizedName: issue.normalizedName,
    path: 'marker.attributes',
    value: issue.value,
  };
  const issueName = issue.name || 'marker.attributes';

  if (issue.kind === 'collision') {
    return createDiagnostic(
      'warning',
      'invalid-marker-attribute-collision',
      `Marker attribute "${issueName}" collides with another key after ASCII lowercasing.`,
      details,
    );
  }

  if (issue.kind === 'reserved') {
    return createDiagnostic(
      'warning',
      'invalid-marker-attribute-reserved',
      `Marker attribute "${issueName}" is reserved by Tracker.`,
      details,
    );
  }

  if (issue.kind === 'name') {
    return createDiagnostic(
      'warning',
      'invalid-marker-attribute-name',
      `Marker attribute "${issueName}" does not match the supported attribute grammar.`,
      details,
    );
  }

  return createDiagnostic(
    'warning',
    'invalid-marker-attribute-value',
    `Marker attribute "${issueName}" has an invalid value.`,
    details,
  );
}

/**
 * Validates an enum option and restores the previous value if invalid.
 */
function validateEnumPath({
  validOptions,
  previousOptions,
  path,
  values,
  diagnostics,
}: ValidateOptionsPathContext & {
  diagnostics: TrackerValidationDiagnostic[];
  path: string;
  values: ReadonlyArray<string>;
}): void {
  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: `Invalid option value at "${path}". Previous valid value was preserved.`,
    path,
    predicate: (value) => typeof value === 'string' && values.includes(value),
    previousOptions,
    validOptions,
  });
}

/**
 * Validates an optional option path only when it exists on validOptions.
 *
 * If the value is invalid, the previous valid value is restored. When no
 * previous value exists, the path is removed.
 */
function validateOptionalPath({
  code,
  diagnostics,
  message,
  path,
  predicate,
  previousOptions,
  validOptions,
}: ValidateOptionsPathParams & { predicate: (value: unknown) => boolean }): void {
  if (!hasPath(validOptions as unknown as Record<string, unknown>, path)) {
    return;
  }

  validatePath({
    code,
    diagnostics,
    message,
    path,
    predicate,
    previousOptions,
    validOptions,
  });
}

/**
 * Validates options and separates applicable values from invalid values.
 *
 * Unknown keys are reported as warnings and pruned from the returned options.
 * Invalid known values are restored from the previous valid state so they do not
 * overwrite existing configuration.
 *
 * @param options - Normalized options candidate.
 * @param context - Validation context.
 */
function validateOptions(
  options: unknown,
  context: TrackerOptionsValidationContext = {},
): TrackerOptionsValidationResult {
  const previousOptions = isPlainObject(context.previousOptions)
    ? (context.previousOptions as Partial<TrackerOptions>)
    : createDefaultOptions();

  const candidateOptions = isPlainObject(options) ? options : {};
  const validOptions = isPlainObject(options)
    ? pruneUnknownOptions(candidateOptions, ALLOWED_OPTIONS_SHAPE)
    : cloneValue(previousOptions);

  const diagnostics: TrackerValidationDiagnostic[] = [];

  if (!isPlainObject(options)) {
    diagnostics.push(createDiagnostic('error', 'invalid-options', 'Options must be a plain object.'));
  }
  const inputOptions = isPlainObject(context.inputOptions) ? context.inputOptions : {};

  collectUnknownKeys(inputOptions, ALLOWED_OPTIONS_SHAPE).forEach((path) => {
    diagnostics.push(
      createDiagnostic('warning', 'WARN_TRACKER_UNKNOWN_OPTION', `Unknown option "${path}" was ignored.`, { path }),
    );
  });

  restoreInvalidOptionContainers(validOptions, previousOptions, ALLOWED_OPTIONS_SHAPE, diagnostics);

  validateEnumPath({
    diagnostics,
    path: 'orientation',
    previousOptions,
    validOptions,
    values: Object.values(ORIENTATIONS),
  });

  validateEnumPath({
    diagnostics,
    path: 'placement',
    previousOptions,
    validOptions,
    values: Object.values(PLACEMENTS),
  });

  validateOrientationPlacement(validOptions, inputOptions, diagnostics);

  validateRootCssVariables(validOptions, previousOptions, inputOptions, diagnostics);

  ['track.className', 'viewport.className', 'markerLayer.className', 'marker.className'].forEach((path) => {
    validateAndNormalizeClassName(validOptions, previousOptions, diagnostics, path);
  });

  validateGlobalMarkerAttributes(validOptions, previousOptions, inputOptions, diagnostics);

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'marker.title must be a boolean.',
    path: 'marker.title',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'viewport.enabled must be a boolean.',
    path: 'viewport.enabled',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'diagnostics.output must be null or a sink with optional warn and error functions.',
    path: 'diagnostics.output',
    predicate: isDiagnosticsOutput,
    previousOptions,
    validOptions,
  });

  if (isPlainObject(validOptions.diagnostics)) {
    const candidateOutput = isPlainObject(candidateOptions.diagnostics)
      ? candidateOptions.diagnostics.output
      : undefined;
    const previousOutput = previousOptions.diagnostics?.output;

    validOptions.diagnostics.output = (
      isDiagnosticsOutput(candidateOutput) ? candidateOutput : previousOutput
    ) as never;
  }

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'clustering.enabled must be a boolean.',
    path: 'clustering.enabled',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'clustering.threshold must be a finite non-negative number in percentage points.',
    path: 'clustering.threshold',
    predicate: (value) => isFiniteNumber(value) && value >= 0,
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.mutation.enabled must be a boolean.',
    path: 'updates.mutation.enabled',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.mutation.targets must be a function.',
    path: 'updates.mutation.targets',
    predicate: isObserverTargetResolver,
    previousOptions,
    validOptions,
  });

  ['childList', 'subtree', 'attributes', 'characterData'].forEach((name) => {
    validatePath({
      code: 'invalid-option-value',
      diagnostics,
      message: `updates.mutation.options.${name} must be a boolean.`,
      path: `updates.mutation.options.${name}`,
      predicate: (value) => typeof value === 'boolean',
      previousOptions,
      validOptions,
    });
  });

  validateOptionalPath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.mutation.options.attributeFilter must be a non-empty array of non-empty strings.',
    path: 'updates.mutation.options.attributeFilter',
    predicate: isAttributeFilter,
    previousOptions,
    validOptions,
  });

  validateOptionalPath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.mutation.options.attributeOldValue must be a boolean.',
    path: 'updates.mutation.options.attributeOldValue',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validateOptionalPath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.mutation.options.characterDataOldValue must be a boolean.',
    path: 'updates.mutation.options.characterDataOldValue',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validateMutationObservationTypes(validOptions, previousOptions, diagnostics);

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.mutation.debounce must be a non-negative number.',
    path: 'updates.mutation.debounce',
    predicate: (value) => isFiniteNumber(value) && value >= 0,
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.resize.enabled must be a boolean.',
    path: 'updates.resize.enabled',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.resize.targets must be a function.',
    path: 'updates.resize.targets',
    predicate: isObserverTargetResolver,
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.resize.debounce must be a non-negative number.',
    path: 'updates.resize.debounce',
    predicate: (value) => isFiniteNumber(value) && value >= 0,
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.scroll.enabled must be a boolean.',
    path: 'updates.scroll.enabled',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.interval.enabled must be a boolean.',
    path: 'updates.interval.enabled',
    predicate: (value) => typeof value === 'boolean',
    previousOptions,
    validOptions,
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'updates.interval.delay must be a positive number.',
    path: 'updates.interval.delay',
    predicate: (value) => isFiniteNumber(value) && value > 0,
    previousOptions,
    validOptions,
  });

  [
    'interaction.activation',
    'interaction.drag',
    'a11y.enabled',
    'a11y.keyboard',
    'diagnostics.warnings',
    'diagnostics.metrics',
  ].forEach((path) => {
    validatePath({
      code: 'invalid-option-value',
      diagnostics,
      message: `${path} must be a boolean.`,
      path,
      predicate: (value) => typeof value === 'boolean',
      previousOptions,
      validOptions,
    });
  });

  validatePath({
    code: 'invalid-option-value',
    diagnostics,
    message: 'a11y.label must be a non-empty string.',
    path: 'a11y.label',
    predicate: isNonEmptyString,
    previousOptions,
    validOptions,
  });

  if (validOptions.a11y?.enabled === false && validOptions.a11y.keyboard === true) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'invalid-a11y-keyboard-combination',
        'a11y.keyboard requires a11y.enabled to be true.',
        { enabled: false, keyboard: true },
      ),
    );
  }

  return {
    diagnostics,
    errors: diagnostics.filter((item) => item.type === 'error'),
    options: validOptions as TrackerOptions,
    warnings: diagnostics.filter((item) => item.type === 'warning'),
  };
}

/**
 * Validates orientation and placement pair.
 *
 * Invalid pairs are replaced with the orientation-specific fallback placement.
 * A missing placement is not a user error: the fallback is applied silently.
 *
 * @param validOptions - Mutable valid options object.
 * @param inputOptions - Original options patch used to distinguish inherited placement.
 * @param diagnostics - Mutable diagnostics array.
 */
function validateOrientationPlacement(
  validOptions: Partial<TrackerOptions>,
  inputOptions: Record<string, unknown>,
  diagnostics: TrackerValidationDiagnostic[],
): void {
  const { orientation, placement } = validOptions;

  if (!orientation) {
    return;
  }

  const allowedPlacements = PLACEMENTS_BY_ORIENTATION[orientation];

  if (!allowedPlacements) {
    return;
  }

  const fallbackPlacement = DEFAULT_PLACEMENT_BY_ORIENTATION[orientation];

  if (placement === undefined) {
    validOptions.placement = fallbackPlacement;
    return;
  }

  if (allowedPlacements.includes(placement)) {
    return;
  }

  validOptions.placement = fallbackPlacement;

  if (!hasOwn(inputOptions, 'placement')) {
    return;
  }

  diagnostics.push(
    createDiagnostic(
      'warning',
      'invalid-orientation-placement',
      `Invalid placement "${placement}" for orientation "${orientation}". Fallback placement "${fallbackPlacement}" was applied.`,
      {
        fallbackPlacement,
        orientation,
        placement,
      },
    ),
  );
}

/**
 * Validates a scalar option and restores the previous value if invalid.
 */
function validatePath({
  code,
  diagnostics,
  message,
  path,
  predicate,
  previousOptions,
  validOptions,
}: ValidateOptionsPathParams & { predicate: (value: unknown) => boolean }): void {
  if (!hasPath(validOptions as unknown as Record<string, unknown>, path)) {
    return;
  }

  const value = getPath(validOptions as unknown as Record<string, unknown>, path);

  if (predicate(value)) {
    return;
  }

  restorePath(validOptions, previousOptions, path);

  diagnostics.push(createDiagnostic('warning', code, message, { path, value }));
}

export { validateOptions };
