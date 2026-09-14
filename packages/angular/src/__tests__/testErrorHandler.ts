import { ErrorHandler } from '@angular/core';

/**
 * Error handler that rethrows the original error object so an unexpected
 * framework-caught runtime error surfaces through the Vitest callstack instead
 * of degrading to a console-only failure. It matches no console output, keeps no
 * state, and never wraps or serializes the received error.
 */
class RethrowingTestErrorHandler extends ErrorHandler {
  override handleError(error: unknown): never {
    throw error;
  }
}

/** Provider shared by package component harnesses and browser Angular fixtures. */
const RETHROWING_TEST_ERROR_HANDLER_PROVIDER = {
  provide: ErrorHandler,
  useClass: RethrowingTestErrorHandler,
};

export { RETHROWING_TEST_ERROR_HANDLER_PROVIDER };
