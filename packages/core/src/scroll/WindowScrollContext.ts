import { getOwnerDocument, getOwnerWindow } from '../dom/context.js';
import { isElement } from '../dom/element.js';
import { hasWindowEvents } from '../dom/environment.js';
import { getWindowAxisExtents, readWindowPhysicalOffset, writeWindowPhysicalOffset } from '../dom/physicalAxis.js';
import {
  consumeWindowFallbackWarning,
  createWindowFallbackDedupState,
  resolveWindowNativeAlignment,
  resolveWindowPrincipalFlow,
  updateWindowFallbackDedupState,
} from '../dom/windowPrincipalFlow.js';
import { noop } from '../utils/function.js';
import {
  getOrientationAxis,
  isActiveDocumentRealm,
  normalizeActivationBehavior,
  normalizeAlignment,
  normalizeExecutionBehavior,
  normalizeMetric,
} from './contextShared.js';

import type { TrackerOrientation } from '../types.js';
import type { WindowFallbackDedupState, WindowPrincipalFlowResolution } from '../dom/windowPrincipalFlow.js';
import type {
  TrackerElementCoordinates,
  TrackerPhysicalAxis,
  TrackerScrollActivationOptions,
  TrackerScrollContext,
  TrackerScrollExecutionBehavior,
  TrackerScrollMetrics,
  TrackerScrollMode,
} from './scrollContext.js';

/** Internal Window alignment diagnostics options. */
interface WindowScrollContextOptions {
  /** Called once for each currently unresolved principal-flow profile. */
  onAlignmentFallback?: (resolution: WindowPrincipalFlowResolution) => void;
}

/** Native activation options with the modern ancestor-containment extension. */
interface ContainedScrollIntoViewOptions extends ScrollIntoViewOptions {
  /** Limits a framed document's request to its own nearest scrolling viewport. */
  container?: 'nearest';
}

/** Window-mode implementation of the internal physical scroll contract. */
class WindowScrollContext implements TrackerScrollContext {
  /** Active mode. */
  readonly mode: TrackerScrollMode = 'window';

  /** Authoritative native scroll root. */
  readonly root: Window;

  /** Document captured for this mount cycle. */
  readonly document: Document;

  /** Window captured for this mount cycle. */
  readonly window: Window;

  /** Finite fallback state with no profile history. */
  readonly #fallbackState: WindowFallbackDedupState = createWindowFallbackDedupState();

  /** Public diagnostic bridge for actual fallback activation. */
  readonly #onAlignmentFallback: ((resolution: WindowPrincipalFlowResolution) => void) | null;

  /**
   * @param window - Active mount-cycle Window.
   * @param options - Internal fallback diagnostics options.
   */
  constructor(window: Window, options: WindowScrollContextOptions = {}) {
    this.root = window;
    this.document = window.document;
    this.window = window;
    this.#onAlignmentFallback = typeof options.onAlignmentFallback === 'function' ? options.onAlignmentFallback : null;
  }

  /**
   * Returns normalized Window metrics for one represented orientation.
   *
   * @param orientation - Tracker orientation.
   * @returns Normalized physical metrics.
   */
  getMetrics(orientation: TrackerOrientation): TrackerScrollMetrics {
    const axis = getOrientationAxis(orientation);

    if (!this.#isActiveRealm()) {
      return {
        axis,
        contentSize: 0,
        viewportSize: 0,
        scrollOffset: 0,
        maxOffset: 0,
      };
    }

    this.#refreshPrincipalFlow();

    return this.#readMetrics(axis);
  }

  /**
   * Returns document coordinates along one physical axis.
   *
   * @param element - Same-document source element.
   * @param orientation - Tracker orientation.
   * @returns Physical coordinates, or null for an invalid source.
   */
  getElementCoordinates(element: Element, orientation: TrackerOrientation): TrackerElementCoordinates | null {
    if (
      !this.#isActiveRealm() ||
      !isElement(element) ||
      !element.isConnected ||
      getOwnerDocument(element) !== this.document ||
      getOwnerWindow(element) !== this.window
    ) {
      return null;
    }

    const axis = getOrientationAxis(orientation);
    const metrics = this.#readMetrics(axis);
    const rect = element.getBoundingClientRect();
    const documentElement = this.document.documentElement;

    if (documentElement === null) {
      return null;
    }

    const clientBorder = normalizeMetric(axis === 'x' ? documentElement.clientLeft : documentElement.clientTop);
    const rectStart = axis === 'x' ? rect.left : rect.top;
    const rectSize = axis === 'x' ? rect.width : rect.height;
    const start = rectStart + metrics.scrollOffset - clientBorder;
    const end = start + normalizeMetric(rectSize);

    return {
      start,
      end,
      center: start + (end - start) / 2,
    };
  }

  /**
   * Scrolls the page to one normalized physical offset.
   *
   * @param offset - Requested physical offset.
   * @param orientation - Tracker orientation.
   * @param behavior - Internal execution behavior.
   */
  scrollToPhysicalOffset(
    offset: number,
    orientation: TrackerOrientation,
    behavior: TrackerScrollExecutionBehavior,
  ): void {
    if (!this.#isActiveRealm() || typeof this.window.scrollTo !== 'function') {
      return;
    }

    this.#refreshPrincipalFlow();
    writeWindowPhysicalOffset(
      this.window,
      getOrientationAxis(orientation),
      normalizeMetric(offset),
      normalizeExecutionBehavior(behavior),
    );
  }

  /**
   * Delegates element activation to native scrollIntoView without escaping a framed Window.
   *
   * @param element - Same-document activation target.
   * @param orientation - Tracker orientation.
   * @param options - Behavior and represented-axis alignment.
   * @returns True when the native request was accepted.
   */
  scrollElement(element: Element, orientation: TrackerOrientation, options: TrackerScrollActivationOptions): boolean {
    if (
      !this.#isActiveRealm() ||
      !isElement(element) ||
      !element.isConnected ||
      getOwnerDocument(element) !== this.document ||
      getOwnerWindow(element) !== this.window ||
      typeof element.scrollIntoView !== 'function'
    ) {
      return false;
    }

    const align = normalizeAlignment(options.align);
    const resolution = this.#refreshPrincipalFlow();
    const alignment = resolveWindowNativeAlignment(resolution, orientation, align);

    if (!alignment.exact && consumeWindowFallbackWarning(this.#fallbackState)) {
      this.#onAlignmentFallback?.(resolution);
    }

    const nativeOptions: ContainedScrollIntoViewOptions = {
      behavior: normalizeActivationBehavior(options.behavior),
      block: alignment.block,
      inline: alignment.inline,
    };

    if (this.window.parent !== this.window) {
      nativeOptions.container = 'nearest';
    }

    element.scrollIntoView(nativeOptions);

    return true;
  }

  /**
   * Connects the active Window scroll listener.
   *
   * @param listener - Scroll invalidation listener.
   * @returns Idempotent disconnect callback.
   */
  connectScrollListener(listener: () => void): () => void {
    if (!this.#isActiveRealm() || !hasWindowEvents(this.window) || typeof listener !== 'function') {
      return noop;
    }

    let connected = true;

    this.window.addEventListener('scroll', listener, { passive: true });

    return () => {
      if (!connected) {
        return;
      }

      connected = false;

      try {
        this.window.removeEventListener('scroll', listener);
      } catch {
        // A navigated or torn-down realm may reject listener cleanup.
      }
    };
  }

  /**
   * Reads current physical metrics without reevaluating alignment metadata.
   *
   * @param axis - Physical axis.
   * @returns Normalized physical metrics.
   */
  #readMetrics(axis: TrackerPhysicalAxis): TrackerScrollMetrics {
    const extents = getWindowAxisExtents(this.window, axis);
    const viewportSize = normalizeMetric(extents.viewportSize);
    const contentSize = Math.max(viewportSize, normalizeMetric(extents.contentSize));
    const maxOffset = Math.max(0, contentSize - viewportSize);
    const scrollOffset = Math.min(maxOffset, normalizeMetric(readWindowPhysicalOffset(this.window, axis)));

    return {
      axis,
      contentSize,
      viewportSize,
      scrollOffset,
      maxOffset,
    };
  }

  /**
   * Reevaluates the bounded principal-flow profile and finite dedup state.
   *
   * @returns Current principal-flow resolution.
   */
  #refreshPrincipalFlow(): WindowPrincipalFlowResolution {
    const resolution = resolveWindowPrincipalFlow(this.document);

    updateWindowFallbackDedupState(this.#fallbackState, resolution);

    return resolution;
  }

  /**
   * Checks that iframe navigation has not replaced the captured document.
   *
   * @returns True while the captured Window/Document identity is current.
   */
  #isActiveRealm(): boolean {
    return isActiveDocumentRealm(this.document, this.window);
  }
}

export { WindowScrollContext };
export type { WindowScrollContextOptions };
