type DebouncedFunction<T extends (...args: unknown[]) => unknown> = ((...args: Parameters<T>) => void) & {
  cancel: () => void;
  flush: () => void;
};

/**
 * Creates a cancellable debounced function.
 *
 * The debounced function uses the latest arguments and latest this-context.
 * The wrapper exposes cancel() and flush() methods for lifecycle cleanup.
 *
 * @param fn - Function to debounce.
 * @param delay - Delay in milliseconds.
 * @param activeWindow - Window that owns the timer, or null for the ambient timer API.
 * @returns Debounced function.
 * @throws {TypeError} When fn is not a function.
 */
function createDebounced<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number,
  activeWindow: Window | null = null,
): DebouncedFunction<T> {
  if (typeof fn !== 'function') {
    throw new TypeError('createDebounced expected a function.');
  }

  let timerId: number | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastThis: unknown = null;

  /**
   * Clears a pending timer.
   */
  function clearTimer(): void {
    const pendingTimerId = timerId;

    if (pendingTimerId === null) {
      return;
    }

    timerId = null;

    if (activeWindow === null) {
      clearTimeout(pendingTimerId);
    } else {
      activeWindow.clearTimeout(pendingTimerId);
    }
  }

  /**
   * Runs the wrapped function with the latest call context.
   */
  function invoke(): void {
    const args = lastArgs;
    const context = lastThis;

    lastArgs = null;
    lastThis = null;

    clearTimer();

    if (args !== null) {
      fn.apply(context, args);
    }
  }

  /**
   * Debounced function wrapper.
   *
   * @param args - Arguments forwarded to the wrapped function.
   */
  function debounced(this: unknown, ...args: Parameters<T>): void {
    lastArgs = args;
    lastThis = this;

    clearTimer();

    timerId =
      activeWindow === null
        ? (setTimeout(invoke, Math.max(0, Number(delay) || 0)) as unknown as number)
        : activeWindow.setTimeout(invoke, Math.max(0, Number(delay) || 0));
  }

  /**
   * Cancels a pending debounced call.
   */
  debounced.cancel = (): void => {
    lastArgs = null;
    lastThis = null;

    clearTimer();
  };

  /**
   * Executes a pending debounced call immediately.
   */
  debounced.flush = (): void => {
    if (timerId === null) {
      return;
    }

    invoke();
  };

  return debounced;
}

export { createDebounced };
