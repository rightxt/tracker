import type { TrackerRendererMountContext, TrackerViewportLayoutRecord } from '../../types.js';
import { isHTMLElement } from '../../dom/element.js';
import type { TrackerStateRendererContext } from './types.js';

/**
 * Renderer implementation for state-driven integrations.
 *
 * It binds core to an integration-owned root without creating or mutating
 * marker DOM. The resulting snapshots drive Element and framework renderers.
 */
class TrackerStateRenderer {
  /**
   * Diagnostics layer.
   */
  #diagnostics: import('../../types.js').TrackerDiagnosticsSink | null;

  /**
   * Integration-owned root element.
   */
  #root: HTMLElement | null = null;

  /**
   * Last viewport layout record.
   */
  #viewportLayout: TrackerViewportLayoutRecord | null = null;

  /**
   * @param context - Renderer context.
   */
  constructor(context: TrackerStateRendererContext = {}) {
    this.#diagnostics = context.diagnostics || null;
  }

  /**
   * Returns the integration-owned root element.
   */
  get root(): HTMLElement | null {
    return this.#root;
  }

  /**
   * Returns the last viewport layout record.
   */
  get viewportLayout(): TrackerViewportLayoutRecord | null {
    return this.#viewportLayout;
  }

  /**
   * Permanently releases renderer dependencies.
   */
  destroy(): void {
    this.unmount();
    this.#diagnostics = null;
  }

  /** Reversibly detaches renderer state without touching integration-owned DOM. */
  unmount(): void {
    this.#root = null;
    this.#viewportLayout = null;
  }

  /**
   * Binds core rendering to a framework-owned root element.
   *
   * @param context - Explicit root target and active DOM realm.
   * @returns Bound root element or null when invalid.
   */
  mount(context: TrackerRendererMountContext): HTMLElement | null {
    const target = context?.target?.kind === 'root' ? context.target.root : null;

    if (!isHTMLElement(target)) {
      this.#diagnostics?.error?.(
        'invalid-mount-target',
        'Tracker state renderer requires an HTMLElement root target.',
        {
          target,
        },
      );

      return null;
    }

    this.#root = target;

    return this.#root;
  }

  /**
   * No-op hook for renderer contract compatibility.
   */
  renderMarkers(): void {}

  /**
   * No-op hook for renderer contract compatibility.
   */
  renderMarkerPresentation(): void {}

  /**
   * No-op hook for renderer contract compatibility.
   */
  renderSelection(): void {}

  /**
   * No-op hook for renderer contract compatibility.
   */
  renderTrack(): void {}

  /**
   * Stores viewport layout for later snapshot creation.
   *
   * @param viewportLayout - Viewport layout record.
   */
  renderViewport(viewportLayout: TrackerViewportLayoutRecord): void {
    this.#viewportLayout = viewportLayout || null;
  }

  /**
   * Updates renderer dependencies.
   *
   * @param context - Context patch.
   */
  updateContext(context: TrackerStateRendererContext = {}): void {
    if ('diagnostics' in context) {
      this.#diagnostics = context.diagnostics || null;
    }
  }
}

/**
 * Creates a renderer for declarative framework integrations.
 *
 * @param context - Renderer context.
 * @returns State renderer.
 */
function createTrackerStateRenderer(context: TrackerStateRendererContext = {}): TrackerStateRenderer {
  return new TrackerStateRenderer(context);
}

export { TrackerStateRenderer, createTrackerStateRenderer };
