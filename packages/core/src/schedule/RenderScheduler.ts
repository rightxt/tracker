import { RENDER_TARGETS, isRenderTarget, mergeRenderTargets } from './renderTargets.js';
import { cancelFrame, scheduleFrame } from '../dom/frame.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import { noop } from '../utils/function.js';
import type {
  TrackerDiagnosticCode,
  TrackerRenderControl,
  TrackerRenderReason,
  TrackerRenderTarget,
} from '../types.js';

interface RenderSchedulerDiagnostics {
  /** Warning reporter. */
  warn?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
  /** Render requested counter. */
  recordRenderRequested?: (amount?: number) => void;
  /** Render cancelled counter. */
  recordRenderCancelled?: (amount?: number) => void;
  /** Render skipped counter. */
  recordRenderSkipped?: (amount?: number) => void;
}

interface RenderSchedulerContext {
  /**
   * Internal render function.
   *
   * Receives a {@link TrackerRenderControl} whose `signal` is aborted if this
   * run is superseded while still in flight; see the type's JSDoc for the
   * cooperative-cancellation contract and its residual limitations.
   */
  render?: (
    target: TrackerRenderTarget,
    reason?: TrackerRenderReason,
    control?: TrackerRenderControl,
  ) => void | Promise<void>;
  /** Diagnostics layer. */
  diagnostics?: RenderSchedulerDiagnostics | null;
  /** Window that owns animation-frame scheduling for the mounted runtime. */
  window?: Window | null;
  /** Notifies the owner after an asynchronous render reaches terminal state. */
  onAsyncSettled?: (() => void) | null;
}

/**
 * Stores render reasons in a compact form.
 *
 * @param reasons - Existing reasons.
 * @param reason - New reason.
 * @returns Updated reasons.
 */
function appendReason(
  reasons: TrackerRenderReason[],
  reason: TrackerRenderReason | null | undefined,
): TrackerRenderReason[] {
  if (reason == null) {
    return reasons;
  }

  if (reason.source === undefined && Array.isArray(reason.reasons)) {
    reasons.push(...reason.reasons);
  } else {
    reasons.push(reason);
  }

  if (reasons.length > 10) {
    reasons.splice(0, reasons.length - 10);
  }

  return reasons;
}

/**
 * Batches internal render requests through animation frames.
 *
 * The scheduler prevents overlapping render runs and coalesces multiple target
 * requests into the minimal broader target required for correctness.
 */
class RenderScheduler {
  /**
   * Whether scheduler has been destroyed.
   */
  #destroyed = false;

  /**
   * Diagnostics layer.
   */
  #diagnostics: RenderSchedulerDiagnostics | null = null;

  /**
   * Scheduled animation frame id.
   */
  #frameId: number | null = null;

  /** Window used to create the current animation frame. */
  #frameWindow: Window | null = null;

  /** One-to-one logical owner of the current scheduled frame callback. */
  #frameToken: number | null = null;

  /** Monotonic source for scheduled frame ownership tokens. */
  #nextFrameToken = 0;

  /**
   * Generation counter bumped by cancel().
   *
   * Lets a stale async render's continuations detect that cancel() ran while
   * they were still in flight, so they no longer mutate #running/#reportedRunning
   * or finalize a run that no longer represents the current scheduler state.
   */
  #generation = 0;

  /** Abort controller for the render run currently in flight, if any. */
  #activeAbortController: AbortController | null = null;

  /**
   * Pending render reasons.
   */
  #pendingReasons: TrackerRenderReason[] = [];

  /**
   * Pending target to render.
   */
  #pendingTarget: TrackerRenderTarget | null = null;

  /**
   * Internal render function.
   */
  #render: (
    target: TrackerRenderTarget,
    reason?: TrackerRenderReason,
    control?: TrackerRenderControl,
  ) => void | Promise<void> = noop;

  /** Owner callback used to publish terminal async scheduler state. */
  #onAsyncSettled: (() => void) | null = null;

  /**
   * Whether a render is currently running.
   */
  #running = false;

  /**
   * Publicly reported render-running state.
   *
   * Kept separate from #running so internal render functions can report
   * completion (via notifyRenderSettled()) before the reentrancy guard
   * itself clears, letting terminal render events/snapshots observe
   * `running: false` accurately.
   */
  #reportedRunning = false;

  /** Active window supplied by the mounted Tracker DOM context. */
  #window: Window | null = null;

  /**
   * @param context - Scheduler context.
   */
  constructor(context: RenderSchedulerContext) {
    this.updateContext(context);
  }

  /**
   * Indicates whether a render is waiting to run.
   *
   * @returns True when pending work exists.
   */
  get pending(): boolean {
    return this.#pendingTarget !== null || this.#frameId !== null;
  }

  /**
   * Indicates whether a render is currently running.
   *
   * @returns True when render execution is active.
   */
  get running(): boolean {
    return this.#reportedRunning;
  }

  /**
   * Cancels pending scheduled work without destroying the scheduler.
   */
  cancel(): void {
    const frameId = this.#frameId;
    const frameWindow = this.#frameWindow;
    const abortController = this.#activeAbortController;
    const hadPendingTarget = this.#pendingTarget !== null;

    this.#frameId = null;
    this.#frameWindow = null;
    this.#frameToken = null;
    this.#pendingTarget = null;
    this.#pendingReasons = [];
    this.#generation += 1;
    this.#running = false;
    this.#reportedRunning = false;
    this.#activeAbortController = null;

    if (frameId !== null) {
      cancelFrame(frameId, frameWindow);
    }

    if (hadPendingTarget) {
      this.#diagnostics?.recordRenderCancelled?.();
    }

    if (abortController !== null) {
      abortController.abort();
    }
  }

  /**
   * Cancels pending work and permanently disables the scheduler.
   */
  destroy(): void {
    try {
      this.cancel();
    } finally {
      this.#destroyed = true;
      this.#diagnostics = null;
      this.#onAsyncSettled = null;
      this.#render = noop;
      this.#window = null;
    }
  }

  /**
   * Finalizes a render run and schedules a follow-up frame if needed.
   */
  #finishRun(): void {
    this.#running = false;
    this.#reportedRunning = false;
    this.#activeAbortController = null;

    if (!this.#destroyed && this.#pendingTarget !== null) {
      this.#schedule();
    }
  }

  /**
   * Marks the in-flight render as settled before #finishRun() runs.
   *
   * Internal render functions call this immediately before emitting their
   * terminal completion event/snapshot so `running` accurately reports
   * false by the time listeners observe render completion, without
   * weakening the `#running` reentrancy guard used by flush()/#runPending().
   */
  notifyRenderSettled(): void {
    this.#reportedRunning = false;
  }

  /**
   * Immediately runs the pending render when there is one.
   */
  flush(): void {
    if (this.#destroyed || this.#running || this.#pendingTarget === null) {
      return;
    }

    if (this.#frameId !== null) {
      cancelFrame(this.#frameId, this.#frameWindow);
      this.#frameId = null;
      this.#frameWindow = null;
      this.#frameToken = null;
    }

    this.#runPending();
  }

  /**
   * Requests an internal render target.
   *
   * Multiple requests before the next frame are merged into one target.
   *
   * @param target - Internal render target. Default: RENDER_TARGETS.ALL
   * @param reason - Render reason.
   */
  request(target: TrackerRenderTarget = RENDER_TARGETS.ALL, reason: TrackerRenderReason | undefined = undefined): void {
    if (this.#destroyed) {
      return;
    }

    if (!isRenderTarget(target)) {
      this.#diagnostics?.warn?.('invalid-render-target', `Invalid internal render target "${String(target)}".`, {
        target,
      });

      return;
    }

    this.#diagnostics?.recordRenderRequested?.();

    this.#pendingTarget = mergeRenderTargets(this.#pendingTarget, target);
    appendReason(this.#pendingReasons, reason);

    if (this.#running) {
      return;
    }

    this.#schedule();
  }

  /**
   * Runs the current pending render target.
   *
   * If a new request arrives during render execution, another frame is scheduled
   * after the current run finishes.
   */
  #runPending(): void {
    if (this.#destroyed || this.#running) {
      return;
    }

    const target = this.#pendingTarget;
    const reasons = this.#pendingReasons;

    this.#pendingTarget = null;
    this.#pendingReasons = [];

    if (target === null) {
      this.#diagnostics?.recordRenderSkipped?.();
      return;
    }

    const runGeneration = this.#generation;
    const abortController = new AbortController();

    this.#activeAbortController = abortController;
    this.#running = true;
    this.#reportedRunning = true;

    try {
      const result = this.#render(
        target,
        {
          scheduled: true,
          reasons,
        },
        { signal: abortController.signal },
      );

      if (result && typeof result.then === 'function') {
        result
          .catch((error: unknown) => {
            if (this.#generation !== runGeneration) {
              return;
            }

            this.#diagnostics?.warn?.('render-error', 'Internal render failed.', {
              error: getErrorMessage(error),
            });
          })
          .finally(() => {
            if (this.#generation !== runGeneration) {
              return;
            }

            try {
              this.#finishRun();
              this.#onAsyncSettled?.();
            } catch (error) {
              this.#diagnostics?.warn?.('render-error', 'Internal render cleanup failed.', {
                error: getErrorMessage(error),
              });
            }
          });

        return;
      }
    } catch (error) {
      this.#diagnostics?.warn?.('render-error', 'Internal render failed.', {
        error: getErrorMessage(error),
      });
    }

    this.#finishRun();
  }

  /**
   * Schedules execution on the next animation frame.
   */
  #schedule(): void {
    if (this.#frameId !== null || this.#pendingTarget === null) {
      return;
    }

    const frameGeneration = this.#generation;
    const frameToken = this.#nextFrameToken + 1;
    const frameWindow = this.#window;

    this.#nextFrameToken = frameToken;
    this.#frameToken = frameToken;
    this.#frameWindow = frameWindow;

    try {
      const frameId = scheduleFrame(() => {
        if (this.#generation !== frameGeneration || this.#frameToken !== frameToken) {
          return;
        }

        this.#frameId = null;
        this.#frameWindow = null;
        this.#frameToken = null;
        this.#runPending();
      }, frameWindow);

      // A conforming animation frame is asynchronous, but retaining ownership
      // conditionally also keeps a synchronous test/platform shim from reviving
      // a callback that already consumed its token.
      if (this.#frameToken === frameToken) {
        this.#frameId = frameId;
      }
    } catch (error) {
      if (this.#frameToken === frameToken) {
        this.#frameToken = null;
        this.#frameWindow = null;
      }

      throw error;
    }
  }

  /**
   * Updates scheduler context.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<RenderSchedulerContext> = {}): void {
    if (typeof context.render === 'function') {
      this.#render = context.render;
    }

    if ('diagnostics' in context) {
      this.#diagnostics = context.diagnostics || null;
    }

    if ('window' in context) {
      this.#window = context.window || null;
    }

    if ('onAsyncSettled' in context) {
      this.#onAsyncSettled = context.onAsyncSettled ?? null;
    }
  }
}

export { RenderScheduler };
export type { RenderSchedulerContext, RenderSchedulerDiagnostics };
