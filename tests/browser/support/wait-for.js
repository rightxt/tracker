/**
 * Polls a browser-visible condition until it becomes true or a timeout elapses.
 *
 * @param {() => boolean} condition - Success condition.
 * @param {string} description - Failure description used in the timeout error.
 * @param {{timeoutMs?: number}} [options] - Polling options.
 * @returns {Promise<void>}
 */
export async function waitFor(condition, description, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for: ${description}`);
}
