/**
 * Waits for a number of animation frames in a specific Window.
 *
 * @param {Window} runtimeWindow - Window owning the animation frames.
 * @param {number} count - Frames to wait for.
 * @returns {Promise<void>}
 */
export async function settleFrames(runtimeWindow, count = 2) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => {
      runtimeWindow.requestAnimationFrame(resolve);
    });
  }
}
