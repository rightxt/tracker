import { CLASS_NAMES, CSS_VARIABLES, DATA_ATTRIBUTES, toPercent } from '@rightxt/tracker-core/renderer';
import type {
  TrackerDiagnosticsSink,
  TrackerMarkerDefaultsSnapshot,
  TrackerReadonlyOptions,
  TrackerRenderRecord,
  TrackerRendererContext,
  TrackerRendererMountContext,
  TrackerViewportLayoutRecord,
} from '@rightxt/tracker-core/renderer';
import { StyleController } from './StyleController.js';
import { getClassTokens, isHtmlElement, setNullableAttribute } from './domUtilities.js';

/**
 * Applies percentage geometry through runtime CSS custom properties.
 *
 * CSS applies the correct physical/logical properties according to orientation.
 *
 * @param element - Target element.
 * @param layout - Layout or render record.
 * @param startVariable - CSS custom property for start.
 * @param sizeVariable - CSS custom property for size.
 */
function applyRuntimeGeometry(
  element: HTMLElement,
  layout: TrackerRenderRecord | TrackerViewportLayoutRecord,
  startVariable: string,
  sizeVariable: string,
): void {
  element.style.setProperty(startVariable, toPercent(layout?.start));
  element.style.setProperty(sizeVariable, toPercent(layout?.size));
}

/**
 * Clears runtime geometry CSS custom properties from an element.
 *
 * @param element - Target element.
 * @param startVariable - CSS custom property for start.
 * @param sizeVariable - CSS custom property for size.
 */
function clearRuntimeGeometry(element: HTMLElement, startVariable: string, sizeVariable: string): void {
  element.style.removeProperty(startVariable);
  element.style.removeProperty(sizeVariable);
}

/**
 * Creates an HTMLElement with a class name.
 *
 * @param ownerDocument - Document that owns the renderer mount target.
 * @param className - Class name.
 * @returns Created element.
 */
function createElement(ownerDocument: Document, className: string): HTMLElement {
  const element = ownerDocument.createElement('div');

  element.classList.add(className);

  return element;
}

/**
 * Returns the marker element key for a render record.
 *
 * @param renderRecord - Marker or cluster render record.
 * @returns Marker DOM key.
 */
function getRenderRecordKey(renderRecord: TrackerRenderRecord): string {
  return String(renderRecord.key);
}

/**
 * Applies a user className while preserving the service class.
 *
 * @param element - Target element.
 * @param serviceClassName - Service class that must remain.
 * @param nextClassName - Next user class string.
 */
function syncUserClassName(element: HTMLElement, serviceClassName: string, nextClassName: string): void {
  const nextTokens = getClassTokens(nextClassName);

  element.className = [serviceClassName, ...nextTokens].join(' ');
}

/**
 * Creates, updates and destroys the Tracker DOM structure.
 *
 * DomRenderer owns DOM nodes. It does not query source page elements, calculate
 * layout, handle user interaction or attach per-marker listeners.
 */
class DomRenderer {
  /** Active diagnostics sink; released by `destroy()`. */
  #diagnostics: TrackerDiagnosticsSink | null = null;

  /** Marker elements by render record key. */
  #markerElements: Map<string, HTMLElement> = new Map();

  /** Renderer-owned marker layer; null while unmounted. */
  #markers: HTMLElement | null = null;

  /** Renderer-owned root; null while unmounted. */
  #root: HTMLElement | null = null;

  /** Style controller replaced during unmount state reset. */
  #styleController: StyleController = new StyleController();

  /** Renderer-owned viewport element; null while unmounted. */
  #viewport: HTMLElement | null = null;

  /** Last viewport layout record. */
  #viewportLayout: TrackerViewportLayoutRecord | null = null;

  /**
   * Returns the root DOM element.
   *
   * @returns Root element.
   */
  get root(): HTMLElement | null {
    return this.#root;
  }

  /**
   * Returns the last viewport layout record.
   *
   * @returns Viewport layout record or null.
   */
  get viewportLayout(): TrackerViewportLayoutRecord | null {
    return this.#viewportLayout;
  }

  /**
   * Permanently releases renderer resources.
   *
   * Releases the diagnostics reference even when `unmount()` throws, so a
   * caller holding a stateful sink (a buffer, socket, etc.) is not kept
   * alive by a failed cleanup.
   */
  destroy(): void {
    try {
      this.unmount();
    } finally {
      this.#diagnostics = null;
    }
  }

  /**
   * Removes the rendered DOM structure while preserving remount capability.
   *
   * Private state is always reset, even when DOM/style cleanup throws, so a
   * failed unmount cannot leave the renderer believing it is still mounted
   * and corrupt the next `mount()` call. The cleanup error still propagates
   * to the caller.
   */
  unmount(): void {
    const root = this.#root;

    try {
      if (root !== null) {
        this.#styleController.clearRootVariables(root);
        this.#styleController.clearMarkerStates();
        root.remove();
      }
    } finally {
      this.#resetState();
    }
  }

  /** Resets all internal renderer state. */
  #resetState(): void {
    this.#markerElements.clear();
    this.#root = null;
    this.#styleController = new StyleController();
    this.#viewport = null;
    this.#viewportLayout = null;
    this.#markers = null;
  }

  /**
   * Creates the root DOM structure and appends it to the target.
   *
   * @param context - Explicit host target and active DOM realm.
   * @param options - Current committed Tracker options.
   * @returns Root element or null when mount failed.
   */
  mount(context: TrackerRendererMountContext, options: TrackerReadonlyOptions): HTMLElement | null {
    if (this.#root !== null) {
      this.#diagnostics?.warn?.('renderer-already-mounted', 'Tracker renderer is already mounted.');

      return this.#root;
    }

    const target = context?.target?.kind === 'host' ? context.target.host : null;

    if (!isHtmlElement(target)) {
      this.#diagnostics?.error?.('invalid-mount-target', 'Tracker DOM renderer requires an HTMLElement host target.', {
        target,
      });

      return null;
    }

    const ownerDocument = target.ownerDocument;

    if (typeof ownerDocument.createElement !== 'function') {
      this.#diagnostics?.error?.('dom-unavailable', 'DOM is unavailable. Tracker cannot be mounted.');

      return null;
    }

    this.#root = createElement(ownerDocument, CLASS_NAMES.ROOT);
    this.#viewport = createElement(ownerDocument, CLASS_NAMES.VIEWPORT);
    this.#markers = createElement(ownerDocument, CLASS_NAMES.MARKERS);

    this.#root.append(this.#viewport, this.#markers);
    target.appendChild(this.#root);

    this.renderTrack(options);

    return this.#root;
  }

  /**
   * Synchronizes marker and cluster DOM elements.
   *
   * Elements are reused by render record key. Obsolete elements are removed.
   * Existing elements move only when their current DOM position differs from
   * the render record order.
   *
   * @param renderRecords - Marker and cluster render records.
   */
  renderMarkers(
    renderRecords: readonly TrackerRenderRecord[],
    _options?: TrackerReadonlyOptions,
    markerOptions?: TrackerMarkerDefaultsSnapshot,
  ): void {
    const ownerDocument = this.#markers?.ownerDocument ?? null;

    if (this.#markers === null || ownerDocument === null || typeof ownerDocument.createElement !== 'function') {
      return;
    }

    const records = Array.isArray(renderRecords) ? renderRecords : [];
    const nextKeys = new Set(records.map(getRenderRecordKey));

    this.#markers.hidden = this.#root?.getAttribute(DATA_ATTRIBUTES.GEOMETRY) !== 'available';

    this.#markerElements.forEach((element, key) => {
      if (!nextKeys.has(key)) {
        element.remove();
        this.#markerElements.delete(key);
      }
    });

    let cursor = this.#markers.firstElementChild;

    records.forEach((record) => {
      const key = getRenderRecordKey(record);
      let markerElement = this.#markerElements.get(key);

      if (!markerElement) {
        markerElement = createElement(ownerDocument, CLASS_NAMES.MARKER);
        this.#markerElements.set(key, markerElement);
      }

      this.#styleController.applyMarkerAttributes(markerElement, record, markerOptions);
      applyRuntimeGeometry(markerElement, record, CSS_VARIABLES.MARKER_START, CSS_VARIABLES.MARKER_SIZE);

      if (markerElement !== cursor) {
        this.#markers!.insertBefore(markerElement, cursor);
      }

      cursor = markerElement.nextElementSibling;
    });
  }

  /**
   * Reapplies application presentation to existing keyed marker nodes.
   *
   * @param renderRecords - Current marker and cluster records.
   * @param markerOptions - Normalized global marker defaults.
   */
  renderMarkerPresentation(
    renderRecords: readonly TrackerRenderRecord[],
    markerOptions?: TrackerMarkerDefaultsSnapshot,
  ): void {
    renderRecords.forEach((record) => {
      const markerElement = this.#markerElements.get(getRenderRecordKey(record));

      if (markerElement !== undefined) {
        this.#styleController.applyMarkerPresentation(markerElement, record, markerOptions);
      }
    });
  }

  /**
   * Synchronizes selected state through keyed constant-time lookup.
   *
   * @param previousKey - Previously selected record key.
   * @param nextKey - Newly selected record key.
   */
  renderSelection(previousKey: string | null, nextKey: string | null): void {
    if (previousKey !== null) {
      this.#markerElements.get(previousKey)?.removeAttribute(DATA_ATTRIBUTES.SELECTED);
    }

    if (nextKey !== null) {
      const nextElement = this.#markerElements.get(nextKey);

      if (nextElement !== undefined) {
        setNullableAttribute(nextElement, DATA_ATTRIBUTES.SELECTED, 'true');
      }
    }
  }

  /**
   * Synchronizes root classes, service attributes, accessibility attributes and
   * CSS custom properties.
   *
   * @param options - Current committed Tracker options.
   */
  renderTrack(options: TrackerReadonlyOptions): void {
    if (this.#root === null) {
      return;
    }

    syncUserClassName(this.#root, CLASS_NAMES.ROOT, options.track.className);

    setNullableAttribute(this.#root, DATA_ATTRIBUTES.ORIENTATION, options.orientation);
    setNullableAttribute(this.#root, DATA_ATTRIBUTES.PLACEMENT, options.placement);

    if (options.interaction.drag) {
      setNullableAttribute(this.#root, DATA_ATTRIBUTES.DRAG, 'true');
    } else {
      this.#root.removeAttribute(DATA_ATTRIBUTES.DRAG);
    }

    if (options.a11y.enabled) {
      this.#root.removeAttribute('aria-hidden');
      setNullableAttribute(this.#root, 'aria-label', options.a11y.label);

      if (options.a11y.keyboard) {
        setNullableAttribute(this.#root, 'tabindex', '0');
      } else {
        this.#root.removeAttribute('tabindex');
      }
    } else {
      setNullableAttribute(this.#root, 'aria-hidden', 'true');
      this.#root.removeAttribute('aria-label');
      this.#root.removeAttribute('tabindex');
    }

    this.#styleController.applyRootVariables(this.#root, options);

    if (this.#viewport !== null) {
      syncUserClassName(this.#viewport, CLASS_NAMES.VIEWPORT, options.viewport.className);
    }

    if (this.#markers !== null) {
      syncUserClassName(this.#markers, CLASS_NAMES.MARKERS, options.markerLayer.className);
    }
  }

  /**
   * Synchronizes the viewport indicator geometry and visibility.
   *
   * @param viewportLayout - Viewport layout record.
   * @param options - Current committed Tracker options.
   */
  renderViewport(viewportLayout: TrackerViewportLayoutRecord, options: TrackerReadonlyOptions): void {
    if (this.#viewport === null) {
      return;
    }

    this.#viewportLayout = viewportLayout || null;

    const visible = options.viewport.enabled && viewportLayout?.visible === true;

    if (!visible) {
      this.#viewport.hidden = true;
      clearRuntimeGeometry(this.#viewport, CSS_VARIABLES.VIEWPORT_START, CSS_VARIABLES.VIEWPORT_SIZE);
      return;
    }

    this.#viewport.hidden = false;

    applyRuntimeGeometry(this.#viewport, viewportLayout, CSS_VARIABLES.VIEWPORT_START, CSS_VARIABLES.VIEWPORT_SIZE);
  }

  /**
   * Updates renderer context.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<TrackerRendererContext> = {}): void {
    if ('diagnostics' in context) {
      this.#diagnostics = context.diagnostics || null;
    }
  }
}

export { DomRenderer };
