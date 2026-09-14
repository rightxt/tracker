/** Reports a consumer-owned failure without returning it into Core. */
function reportHostError(error: unknown): void {
  const reporter = Reflect.get(globalThis, 'reportError') as unknown;

  if (typeof reporter === 'function') {
    try {
      Reflect.apply(reporter, globalThis, [error]);
      return;
    } catch (reporterError) {
      queueMicrotask(() => {
        throw reporterError;
      });
    }
  }

  queueMicrotask(() => {
    throw error;
  });
}

export { reportHostError };
