/**
 * Best-effort asynchronous surfacing that never leaks host transport failure.
 *
 * @param error - Value to throw asynchronously when the host accepts scheduling.
 */
function scheduleHostError(error: unknown): void {
  try {
    const enqueueMicrotask = Reflect.get(globalThis, 'queueMicrotask') as unknown;

    if (typeof enqueueMicrotask === 'function') {
      Reflect.apply(enqueueMicrotask, globalThis, [
        () => {
          throw error;
        },
      ]);
      return;
    }
  } catch {
    // Continue to the timer transport.
  }

  try {
    const scheduleTimeout = Reflect.get(globalThis, 'setTimeout') as unknown;

    if (typeof scheduleTimeout === 'function') {
      Reflect.apply(scheduleTimeout, globalThis, [
        () => {
          throw error;
        },
        0,
      ]);
    }
  } catch {
    // Host error reporting is best-effort and must never cross into Core.
  }
}

/**
 * Reports a consumer-owned failure through the current host environment.
 *
 * The function intentionally returns normally so a notification failure cannot
 * cross back into Core. Browsers receive the original value through the
 * standard reportError() channel; non-browser hosts observe an asynchronous
 * throw with the same value.
 *
 * @param error - Consumer-owned failure.
 */
function reportHostError(error: unknown): void {
  let reporter: unknown;

  try {
    reporter = Reflect.get(globalThis, 'reportError') as unknown;
  } catch {
    scheduleHostError(error);
    return;
  }

  if (typeof reporter === 'function') {
    try {
      Reflect.apply(reporter, globalThis, [error]);
      return;
    } catch (reporterError) {
      scheduleHostError(reporterError);
    }
  }

  scheduleHostError(error);
}

export { reportHostError };
