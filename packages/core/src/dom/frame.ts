import { getWindow } from './environment.js';

/**
 * Cancels a scheduled animation frame or timeout fallback.
 *
 * @param frameId - Frame or timeout id.
 * @param activeWindow - Window used when the frame was scheduled.
 */
function cancelFrame(frameId: number | null, activeWindow: Window | null | undefined = undefined): void {
  if (frameId === null) {
    return;
  }

  const frameWindow = activeWindow === undefined ? getWindow() : activeWindow;

  if (hasAnimationFrame(frameWindow)) {
    frameWindow!.cancelAnimationFrame(frameId);
    return;
  }

  if (frameWindow === null) {
    clearTimeout(frameId);
  } else {
    frameWindow.clearTimeout(frameId);
  }
}

/**
 * Checks whether requestAnimationFrame and cancelAnimationFrame are available.
 *
 * @param activeWindow - Window that may provide animation-frame APIs.
 * @returns True when animation frame APIs are available.
 */
function hasAnimationFrame(activeWindow: Window | null | undefined = undefined): boolean {
  const frameWindow = activeWindow === undefined ? getWindow() : activeWindow;

  return (
    frameWindow !== null &&
    typeof frameWindow.requestAnimationFrame === 'function' &&
    typeof frameWindow.cancelAnimationFrame === 'function'
  );
}

/**
 * Schedules a callback on the next animation frame or timeout fallback.
 *
 * @param callback - Callback to schedule.
 * @param activeWindow - Window that owns the animation frame.
 * @returns Frame or timeout id.
 */
function scheduleFrame(callback: FrameRequestCallback, activeWindow: Window | null | undefined = undefined): number {
  const frameWindow = activeWindow === undefined ? getWindow() : activeWindow;

  if (hasAnimationFrame(frameWindow)) {
    return frameWindow!.requestAnimationFrame(callback);
  }

  if (frameWindow === null) {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  }

  return frameWindow.setTimeout(() => callback(frameWindow.performance.now()), 0);
}

export { cancelFrame, scheduleFrame };
