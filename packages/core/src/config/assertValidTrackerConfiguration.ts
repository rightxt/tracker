import { assertConfigurationDiagnostics } from './assertConfigurationDiagnostics.js';
import { createDefaultOptions } from './defaultOptions.js';
import { normalizeOptions } from './normalizeOptions.js';
import { ALLOWED_OPTIONS_SHAPE } from './optionSchema.js';
import { validateOptions } from './validateOptions.js';
import { TrackerConfigurationError } from '../errors.js';
import { validateRules } from '../rules/validateRules.js';
import { findFirstOwnUndefinedPath, isPlainObject } from '../utils/object.js';

import type { TrackerConfiguration } from '../types.js';

/**
 * Validates a complete public configuration without mutating runtime state.
 *
 * @param configuration - Complete configuration candidate.
 * @throws TypeError when the whole configuration argument is not a plain object.
 * @throws TrackerConfigurationError when any option or rule is invalid.
 */
function assertValidTrackerConfiguration(configuration: unknown): asserts configuration is TrackerConfiguration {
  if (!isPlainObject(configuration)) {
    throw new TypeError('Tracker configuration must be a plain object.');
  }

  const unknownKeys = Object.keys(configuration).filter((key) => key !== 'options' && key !== 'rules');

  if (unknownKeys.length > 0) {
    throw new TrackerConfigurationError(`Unknown Tracker configuration key "${unknownKeys[0]}".`, {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const hasOwnOptions = Object.hasOwn(configuration, 'options');
  const hasOwnRules = Object.hasOwn(configuration, 'rules');

  if ((hasOwnOptions && configuration.options === undefined) || (hasOwnRules && configuration.rules === undefined)) {
    throw new TrackerConfigurationError('Tracker configuration "options" and "rules" must not be undefined.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const options = hasOwnOptions ? configuration.options : {};
  const rules = hasOwnRules ? configuration.rules : [];

  if (!isPlainObject(options) || !Array.isArray(rules)) {
    throw new TrackerConfigurationError('Tracker configuration options must be an object and rules must be an array.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const undefinedOptionPath = findFirstOwnUndefinedPath(options, ALLOWED_OPTIONS_SHAPE);

  if (undefinedOptionPath !== null) {
    throw new TrackerConfigurationError(
      `Tracker configuration option "${undefinedOptionPath}" must not be undefined.`,
      {
        code: 'ERR_TRACKER_INVALID_CONFIGURATION',
      },
    );
  }

  const defaults = createDefaultOptions();
  const validationResult = validateOptions(normalizeOptions(options, { baseOptions: defaults }), {
    inputOptions: options,
    previousOptions: defaults,
  });

  assertConfigurationDiagnostics(validationResult.diagnostics);
  assertConfigurationDiagnostics(validateRules(rules).diagnostics, 'Tracker rules');
}

export { assertValidTrackerConfiguration };
