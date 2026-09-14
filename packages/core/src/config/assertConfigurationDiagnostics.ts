import { TrackerConfigurationError } from '../errors.js';

import type { TrackerValidationDiagnostic } from '../types.js';

/**
 * Rejects a configuration candidate containing any recoverable validation diagnostic.
 *
 * @param diagnostics - Diagnostics produced without committing candidate state.
 * @param subject - Human-readable configuration subject.
 * @throws TrackerConfigurationError when at least one diagnostic exists.
 */
function assertConfigurationDiagnostics(
  diagnostics: readonly TrackerValidationDiagnostic[],
  subject = 'Tracker configuration',
): void {
  const [firstDiagnostic] = diagnostics;

  if (firstDiagnostic === undefined) {
    return;
  }

  const remainingCount = diagnostics.length - 1;
  const suffix = remainingCount > 0 ? ` (${remainingCount} additional issue${remainingCount === 1 ? '' : 's'}.)` : '';

  throw new TrackerConfigurationError(`${subject} is invalid: ${firstDiagnostic.message}${suffix}`, {
    cause: diagnostics,
    code: 'ERR_TRACKER_INVALID_CONFIGURATION',
  });
}

export { assertConfigurationDiagnostics };
