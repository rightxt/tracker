import { ORIENTATIONS } from '../constants.js';
import { createDefaultOptions } from '../config/defaultOptions.js';
import { isKeyboardAccessibilityEnabled } from '../config/interactionOptions.js';
import { isInComposedSubtree } from '../dom/composedTree.js';
import { isInActiveDocument } from '../dom/context.js';
import { isElement, isHTMLElement } from '../dom/element.js';
import { focusElement, resolveFocusTarget, resolveScrollTarget } from '../dom/scroll.js';
import { EVENT_NAMES } from '../events/eventNames.js';
import { DATA_ATTRIBUTES } from '../render-contract/names.js';
import { getPrimaryMarkerRecord, isClusterRenderRecord, isMarkerRenderRecord } from '../tracker/renderRecords.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import { getEmptyArray, getNull } from '../utils/function.js';
import type {
  TrackerClusterRenderRecord,
  TrackerDiagnosticCode,
  TrackerEventMarker,
  TrackerEventName,
  TrackerEventPayloadMap,
  TrackerMarkerRecord,
  TrackerRenderRecord,
  TrackerResolvedOptions,
} from '../types.js';
import type { TrackerScrollContext, TrackerScrollExecutionBehavior } from '../scroll/scrollContext.js';

interface InteractionControllerDiagnostics {
  /** Warning reporter. */
  warn?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
  /** Error reporter. */
  error?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
}

interface InteractionControllerContext {
  /** Active normalized scroll and geometry boundary. */
  scrollContext?: TrackerScrollContext | null;
  /** Event emitter. */
  events?: {
    emit: <TEventName extends TrackerEventName>(
      eventName: TEventName,
      payload?: TrackerEventPayloadMap[TEventName],
    ) => void;
  } | null;
  /** Diagnostics layer. */
  diagnostics?: InteractionControllerDiagnostics | null;
  /** Render record provider by key. */
  getRenderRecordByKey?: (key: string) => TrackerRenderRecord | null;
  /** Render records provider. */
  getRenderRecords?: () => readonly TrackerRenderRecord[];
  /**
   * Fallback root provider for manual activation helpers when no delegated
   * root is connected (state integrations with host-owned roots).
   */
  getFallbackRoot?: () => HTMLElement | null;
  /**
   * Current-geometry provider. While geometry is suspended, marker, cluster,
   * track, keyboard, and drag activation return false.
   */
  getGeometryAvailable?: () => boolean;
  /** Whether keyboard events may enter a stable Core lifecycle operation. */
  canHandleKeyboardEvent?: () => boolean;
  /** Core-owned coordinator entrypoint for keyboard selection requests. */
  onSelectionRequest?: (request: TrackerSelectionRequest) => void;
  /**
   * Runs an activation body inside the Tracker instance's core operation
   * coordinator so a reentrant destroy()/replaceOptions() triggered by an
   * activation event listener is deferred instead of running mid-activation.
   */
  coordinateActivation?: <TResult>(run: () => TResult, deferredResult: TResult) => TResult;
}

/** Navigation keys that can commit a keyboard selection transition. */
type TrackerSelectionNavigationKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/** Revalidated keyboard selection request. */
interface TrackerSelectionRequest {
  readonly navigationKey: TrackerSelectionNavigationKey;
}

/** Committed key transition returned by selection synchronization. */
interface TrackerSelectionTransition {
  readonly previousKey: string | null;
  readonly nextKey: string | null;
}

/**
 * Keys that can activate the currently selected marker in accessibility mode.
 */
const ACTIVATION_KEYS: ReadonlySet<string> = Object.freeze(new Set(['Enter', ' ']));

/**
 * Distance in CSS pixels after which pointer movement is treated as drag.
 */
const DRAG_THRESHOLD = 3;

/**
 * Keys that move marker selection in accessibility mode.
 */
const NAVIGATION_KEYS: ReadonlySet<string> = Object.freeze(
  new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']),
);

/** Delegated handler names owned by the interaction controller. */
type InteractionBindingName =
  'click' | 'keydown' | 'lostpointercapture' | 'pointercancel' | 'pointerdown' | 'pointermove' | 'pointerup';

/** Document-level terminal pointer binding. */
type PointerEndBindingName = 'pointerup' | 'pointercancel';

/**
 * Runs one interaction cleanup step without preventing subsequent cleanup.
 *
 * @param cleanup - Cleanup operation.
 * @param errors - Ordered cleanup errors.
 */
function attemptInteractionCleanup(cleanup: () => void, errors: unknown[]): void {
  try {
    cleanup();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * Reports interaction cleanup failures after all resources have been attempted.
 *
 * @param errors - Ordered cleanup errors.
 */
function throwInteractionCleanupErrors(errors: unknown[]): void {
  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, 'Interaction cleanup failed in multiple steps.');
  }
}

/**
 * Converts a marker record into public event data.
 *
 * @param marker - Marker record.
 * @returns Public marker payload.
 */
function createPublicMarkerPayload(marker: TrackerMarkerRecord): TrackerEventMarker {
  return {
    key: marker.key,
    element: marker.element,
    ruleIndex: marker.ruleIndex,
    selector: marker.selector,
    label: marker.label,
  };
}

/**
 * Returns a render record key from a marker DOM element.
 *
 * @param markerElement - Marker DOM element.
 * @returns Render record key.
 */
function getMarkerElementKey(markerElement: Element): string | null {
  return markerElement.getAttribute(DATA_ATTRIBUTES.KEY);
}

/**
 * Returns the closest marker DOM element from an event target.
 *
 * @param target - Event target.
 * @param root - Tracker root.
 * @returns Marker element or null.
 */
function findMarkerElement(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!isElement(target)) {
    return null;
  }

  const markerElement = target.closest(`[${DATA_ATTRIBUTES.KEY}]`);

  return isHTMLElement(markerElement) && root.contains(markerElement) ? markerElement : null;
}

/**
 * Returns pointer coordinate along the configured orientation.
 *
 * @param event - Source event.
 * @param orientation - Tracker orientation.
 * @returns Pointer coordinate.
 */
function getMainAxisClientPosition(event: Pick<MouseEvent, 'clientX' | 'clientY'>, orientation: string): number {
  return orientation === ORIENTATIONS.HORIZONTAL ? event.clientX : event.clientY;
}

/**
 * Computes the clamped 0-1 activation ratio of a pointer event along the
 * track's main axis, relative to the root's bounding box.
 *
 * @param root - Tracker root.
 * @param event - Pointer or mouse event.
 * @param orientation - Tracker orientation.
 * @returns Clamped 0-1 ratio, or null when the root has no measurable size.
 */
function getTrackActivationRatio(
  root: HTMLElement,
  event: PointerEvent | MouseEvent,
  orientation: TrackerResolvedOptions['orientation'],
): number | null {
  const rect = root.getBoundingClientRect();
  const trackStart = orientation === ORIENTATIONS.HORIZONTAL ? rect.left : rect.top;
  const trackSize = orientation === ORIENTATIONS.HORIZONTAL ? rect.width : rect.height;

  if (!Number.isFinite(trackSize) || trackSize <= 0) {
    return null;
  }

  const pointerPosition = getMainAxisClientPosition(event, orientation);

  return Math.min(1, Math.max(0, (pointerPosition - trackStart) / trackSize));
}

/**
 * Checks whether a resolved element-mode target leaves the authoritative subtree.
 *
 * Window mode keeps document-level target resolution, so only an element
 * scroll context enforces composed containment in its root subtree.
 *
 * @param target - Resolved scroll or focus target.
 * @param scrollContext - Active normalized scroll boundary.
 * @returns True when the target must be skipped with a warning.
 */
function isOutsideAuthoritativeSubtree(target: Element, scrollContext: TrackerScrollContext | null): boolean {
  return (
    scrollContext !== null &&
    scrollContext.mode === 'element' &&
    isHTMLElement(scrollContext.root) &&
    !isInComposedSubtree(target, scrollContext.root)
  );
}

/**
 * Activates marker behavior: scroll first, focus after that.
 *
 * In element mode, resolved scroll and focus targets are validated
 * independently against the authoritative scroll subtree: an outside target
 * warns and no-ops only its own phase without searching for another match.
 *
 * @param marker - Marker record.
 * @param sourceEvent - Source event.
 * @param diagnostics - Diagnostics layer.
 * @param activeDocument - Document of the mounted runtime realm.
 * @param scrollContext - Active normalized scroll boundary.
 * @param orientation - Represented Tracker orientation.
 */
function activateMarkerBehavior(
  marker: TrackerMarkerRecord,
  sourceEvent: Event | null,
  diagnostics: InteractionControllerDiagnostics | null,
  activeDocument: Document | null,
  scrollContext: TrackerScrollContext | null,
  orientation: import('../types.js').TrackerOrientation,
): void {
  if (!marker || !isElement(marker.element)) {
    return;
  }

  if (marker.scroll?.enabled !== false) {
    const scrollTarget = resolveScrollTarget(
      marker.element,
      marker.scroll?.target || 'self',
      diagnostics,
      activeDocument,
    );

    if (scrollTarget !== null && scrollContext !== null) {
      if (isOutsideAuthoritativeSubtree(scrollTarget, scrollContext)) {
        diagnostics?.warn?.(
          'WARN_TRACKER_SCROLL_TARGET_OUTSIDE_ROOT',
          'Tracker element-mode scroll target is outside the authoritative scroll subtree.',
          { selector: marker.selector, scrollMode: scrollContext.mode },
        );
      } else {
        try {
          scrollContext.scrollElement(scrollTarget, orientation, {
            behavior: marker.scroll?.behavior || 'auto',
            align: marker.scroll?.align || 'start',
          });
        } catch (error) {
          diagnostics?.error?.('scroll-into-view-error', 'Tracker scroll activation failed unexpectedly.', {
            selector: marker.selector,
            scrollMode: scrollContext.mode,
            error: getErrorMessage(error),
          });
        }
      }
    }
  }

  if (marker.focus?.enabled === true) {
    const focusTarget = resolveFocusTarget(marker.element, marker.focus?.target || 'self', diagnostics, activeDocument);

    if (focusTarget !== null) {
      if (isOutsideAuthoritativeSubtree(focusTarget, scrollContext)) {
        diagnostics?.warn?.(
          'WARN_TRACKER_FOCUS_TARGET_OUTSIDE_ROOT',
          'Tracker element-mode focus target is outside the authoritative scroll subtree.',
          { selector: marker.selector, scrollMode: scrollContext?.mode },
        );
      } else {
        focusElement(focusTarget, activeDocument, {
          allowPlainFocusFallback: scrollContext?.mode !== 'element',
          diagnostics,
        });
      }
    }
  }

  sourceEvent?.preventDefault?.();
}

/**
 * Controls delegated user interaction with the Tracker DOM.
 *
 * This controller does not attach listeners to individual markers. It uses root
 * delegation and resolves render records by marker DOM keys.
 */
class InteractionController {
  /**
   * Diagnostics layer.
   */
  #diagnostics: InteractionControllerDiagnostics | null = null;

  /** Active normalized scroll and geometry boundary. */
  #scrollContext: TrackerScrollContext | null = null;

  /**
   * Event emitter.
   */
  #events: InteractionControllerContext['events'] = null;

  /**
   * Render record provider by key.
   */
  #getRenderRecordByKey: (key: string) => TrackerRenderRecord | null = getNull;

  /**
   * Render records provider.
   */
  #getRenderRecords: () => readonly TrackerRenderRecord[] = getEmptyArray;

  /**
   * Fallback root provider for manual activation helpers.
   */
  #getFallbackRoot: () => HTMLElement | null = getNull;

  /**
   * Current-geometry provider used to gate activation while suspended.
   */
  #getGeometryAvailable: () => boolean = () => true;

  /** Stable lifecycle gate for keyboard event delivery. */
  #canHandleKeyboardEvent: () => boolean = () => false;

  /** Core-owned selection request callback. */
  #onSelectionRequest: ((request: TrackerSelectionRequest) => void) | null = null;

  /** Core-owned activation coordinator; runs the activation body directly by default. */
  #coordinateActivation: <TResult>(run: () => TResult, deferredResult: TResult) => TResult = (run) => run();

  /**
   * Source events already handled by manual or delegated interaction paths.
   */
  #handledSourceEvents: WeakSet<object> = new WeakSet();

  /**
   * Current committed options.
   *
   * Defaults are used until connect() or update() commits real options, so
   * option reads never have to handle a partially initialized state.
   */
  #options: TrackerResolvedOptions = createDefaultOptions();

  /**
   * Pointer down state for optional drag behavior.
   */
  #pointerState: {
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    dragged: boolean;
    dragEligible: boolean;
  } = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    dragged: false,
    dragEligible: false,
  };

  /** Document receiving terminal events for the active pointer session. */
  #pointerEndDocument: Document | null = null;

  /** Cancels the pending document-pointer-end recovery timer, when scheduled. */
  #cancelPointerEndTimer: (() => void) | null = null;

  /** Document terminal bindings whose physical removal may still need retrying. */
  #pointerEndBindings = new Set<PointerEndBindingName>();

  /**
   * Connected root element.
   */
  #root: HTMLElement | null = null;

  /** Root that physically owns any retained delegated listener. */
  #listenerRoot: HTMLElement | null = null;

  /** Delegated bindings whose physical removal may still need retrying. */
  #listenerBindings = new Set<InteractionBindingName>();

  /**
   * Active keyboard selection index.
   */
  #selectedIndex = 0;

  /** Suppresses the semantic click generated after a completed drag. */
  #suppressNextClick = false;

  /** Window that owns the pending click-suppression reset timer. */
  #clickSuppressionWindow: Window | null = null;

  /** Pending click-suppression reset timer. */
  #clickSuppressionTimer: number | null = null;

  /**
   * @param context - Event emitter, diagnostics and render record providers.
   * References are retained for the controller lifetime and can be replaced
   * later through updateContext(). No DOM listeners are attached until
   * connect(); destroy() is required for cleanup after connect().
   */
  constructor(context: InteractionControllerContext = {}) {
    this.updateContext(context);
  }

  /**
   * Activates a marker or cluster render record by public render key.
   *
   * @param key - Marker or cluster render key.
   * @param sourceEvent - Source event.
   * @returns True when a render record was activated. False when the key was
   * invalid, no record was found, or activation was deferred due to a
   * Tracker operation already in progress.
   */
  activateRenderRecordByKey(key: string, sourceEvent: Event | null = null): boolean {
    if (this.#options.interaction?.activation === false) {
      return false;
    }

    if (typeof key !== 'string' || key === '') {
      this.#diagnostics?.warn?.('invalid-activation-key', 'Activation key must be a non-empty string.', { key });

      return false;
    }

    if (!this.#getGeometryAvailable()) {
      return false;
    }

    const renderRecord = this.#getRenderRecordByKey(key);

    if (renderRecord === null) {
      this.#diagnostics?.warn?.('unknown-activation-key', 'No rendered marker or cluster exists for activation key.', {
        key,
      });

      return false;
    }

    if (this.#hasHandledSourceEvent(sourceEvent)) {
      return false;
    }

    this.#markSourceEventHandled(sourceEvent);

    return this.#activateRenderRecord(renderRecord, sourceEvent);
  }

  /**
   * Activates track behavior from a source pointer or mouse event.
   *
   * @param sourceEvent - Source event.
   * @returns True when track activation was attempted.
   */
  activateTrack(sourceEvent: PointerEvent | MouseEvent): boolean {
    if (this.#options.interaction?.activation === false) {
      return false;
    }

    const root = this.#resolveManualTrackRoot(sourceEvent);

    if (root === null) {
      this.#diagnostics?.warn?.('interaction-not-connected', 'Tracker interaction root is not connected.');

      return false;
    }

    if (!this.#getGeometryAvailable() || this.#hasHandledSourceEvent(sourceEvent)) {
      return false;
    }

    this.#markSourceEventHandled(sourceEvent);
    this.#emitTrackActivate(this.#scrollFromTrackEvent(sourceEvent, root), sourceEvent);

    return true;
  }

  /**
   * Activates marker, cluster or track behavior from a framework-owned root event.
   *
   * The event must originate inside the tracker root/track context: when no
   * marker element is found under event.target, the event is treated as a
   * track activation and triggers track scrolling. Do not wire this method to
   * events from arbitrary outer containers.
   *
   * @param sourceEvent - Source event.
   * @returns True when an interaction was activated.
   */
  activateFromEvent(sourceEvent: PointerEvent | MouseEvent): boolean {
    const root = this.#resolveManualRoot();

    if (root === null) {
      this.#diagnostics?.warn?.('interaction-not-connected', 'Tracker interaction root is not connected.');

      return false;
    }

    return this.#activateFromEvent(sourceEvent, root);
  }

  /**
   * Handles keyboard navigation and activation from a framework-owned event.
   *
   * @param sourceEvent - Source keyboard event.
   * @returns True when the keyboard event was handled.
   */
  handleKeyboardEvent(sourceEvent: KeyboardEvent): boolean {
    if (this.#resolveManualRoot() === null) {
      this.#diagnostics?.warn?.('interaction-not-connected', 'Tracker interaction root is not connected.');

      return false;
    }

    return this.#handleKeyboardEvent(sourceEvent);
  }

  /**
   * Activates a cluster record.
   *
   * The first marker in the cluster is used as the primary navigation target.
   *
   * @param cluster - Cluster render record.
   * @param sourceEvent - Source event.
   */
  #activateCluster(cluster: TrackerClusterRenderRecord, sourceEvent: Event | null): void {
    const primaryMarker = getPrimaryMarkerRecord(cluster);

    if (primaryMarker !== null) {
      activateMarkerBehavior(
        primaryMarker,
        sourceEvent,
        this.#diagnostics,
        this.#getActiveDocument(),
        this.#scrollContext,
        this.#options.orientation,
      );
    }

    this.#events?.emit(EVENT_NAMES.CLUSTER_ACTIVATE, {
      key: cluster.key,
      count: cluster.count,
      markers: cluster.markers.map(createPublicMarkerPayload),
      primaryMarker: primaryMarker === null ? null : createPublicMarkerPayload(primaryMarker),
      sourceEvent,
    });
  }

  /**
   * Activates marker, cluster or track behavior from a user event.
   *
   * @param event - Source event.
   * @param root - Interaction root; the connected root by default.
   * @returns True when an interaction was activated.
   */
  #activateFromEvent(event: PointerEvent | MouseEvent, root: HTMLElement | null = this.#root): boolean {
    if (this.#options.interaction?.activation === false || root === null || !this.#getGeometryAvailable()) {
      return false;
    }

    if (this.#hasHandledSourceEvent(event)) {
      return false;
    }

    const markerElement = findMarkerElement(event.target, root);

    if (markerElement !== null) {
      const key = getMarkerElementKey(markerElement);
      const renderRecord = key === null ? null : this.#getRenderRecordByKey(key);

      if (renderRecord !== null) {
        this.#markSourceEventHandled(event);
        return this.#activateRenderRecord(renderRecord, event);
      }

      return false;
    }

    this.#markSourceEventHandled(event);
    this.#emitTrackActivate(this.#scrollFromTrackEvent(event, root), event);

    return true;
  }

  /**
   * Activates a single marker record.
   *
   * @param marker - Marker record.
   * @param sourceEvent - Source event.
   */
  #activateMarker(marker: TrackerMarkerRecord, sourceEvent: Event | null): void {
    activateMarkerBehavior(
      marker,
      sourceEvent,
      this.#diagnostics,
      this.#getActiveDocument(),
      this.#scrollContext,
      this.#options.orientation,
    );

    this.#events?.emit(EVENT_NAMES.MARKER_ACTIVATE, {
      ...createPublicMarkerPayload(marker),
      sourceEvent,
    });
  }

  /**
   * Activates a marker or cluster render record.
   *
   * When called while another Tracker operation is in progress, the activation
   * body is deferred by coordinateActivation and this returns false immediately,
   * since the deferred body's freshness re-check may still no-op once it runs.
   *
   * @param renderRecord - Marker or cluster render record.
   * @param sourceEvent - Source event.
   * @returns True when the record was still current and activation ran synchronously.
   */
  #activateRenderRecord(renderRecord: TrackerRenderRecord, sourceEvent: Event | null): boolean {
    return this.#coordinateActivation(() => {
      const currentRenderRecord = this.#getRenderRecordByKey(renderRecord.key);

      if (currentRenderRecord !== renderRecord) {
        return false;
      }

      if (isClusterRenderRecord(renderRecord)) {
        this.#activateCluster(renderRecord, sourceEvent);
        return true;
      }

      if (isMarkerRenderRecord(renderRecord)) {
        this.#activateMarker(renderRecord.marker, sourceEvent);
        return true;
      }

      return false;
    }, false);
  }

  /**
   * Connects delegated interaction handlers to root.
   *
   * @param root - Tracker root element.
   * @param options - Committed Tracker options.
   */
  connect(root: HTMLElement, options: TrackerResolvedOptions): void {
    this.disconnect();

    if (!isHTMLElement(root) || !isInActiveDocument(root, this.#getActiveDocument())) {
      this.#diagnostics?.error?.('invalid-interaction-root', 'InteractionController root must be an HTMLElement.', {
        root,
      });

      return;
    }

    this.#root = root;
    this.#listenerRoot = root;
    this.#options = options;
    this.#selectedIndex = 0;
    const addedBindings: InteractionBindingName[] = [];

    try {
      this.#getDesiredBindings(this.#options).forEach((binding) => {
        this.#addBinding(binding);
        addedBindings.push(binding);
      });
    } catch (error) {
      const errors: unknown[] = [error];

      [...addedBindings].reverse().forEach((binding) => {
        attemptInteractionCleanup(() => this.#removeBinding(binding), errors);
      });
      this.#root = null;
      this.#listenerRoot = this.#listenerBindings.size > 0 ? root : null;
      throwInteractionCleanupErrors(errors);
    }
  }

  /**
   * Returns delegated bindings required by an option snapshot.
   *
   * @param options - Committed Tracker options.
   * @returns Required delegated binding names.
   */
  #getDesiredBindings(options: TrackerResolvedOptions): Set<InteractionBindingName> {
    const bindings = new Set<InteractionBindingName>();

    if (options.interaction.drag) {
      bindings.add('pointerdown');
      bindings.add('pointerup');
      bindings.add('pointercancel');
      bindings.add('lostpointercapture');
      bindings.add('pointermove');
    }

    if (options.interaction.activation) {
      bindings.add('click');
    }

    if (isKeyboardAccessibilityEnabled(options)) {
      bindings.add('keydown');
    }

    return bindings;
  }

  /**
   * Adds one delegated binding to the active listener root.
   *
   * @param binding - Binding name.
   */
  #addBinding(binding: InteractionBindingName): void {
    const root = this.#listenerRoot;

    if (root === null || this.#listenerBindings.has(binding)) {
      return;
    }

    if (binding === 'click') {
      root.addEventListener(binding, this.#handleClick);
    } else if (binding === 'keydown') {
      root.addEventListener(binding, this.#handleKeyDown);
    } else if (binding === 'pointerdown') {
      root.addEventListener(binding, this.#handlePointerDown);
    } else if (binding === 'pointermove') {
      root.addEventListener(binding, this.#handlePointerMove);
    } else if (binding === 'pointerup') {
      root.addEventListener(binding, this.#handlePointerUp);
    } else if (binding === 'pointercancel') {
      root.addEventListener(binding, this.#handlePointerCancel);
    } else {
      root.addEventListener(binding, this.#handleLostPointerCapture);
    }

    this.#listenerBindings.add(binding);
  }

  /**
   * Removes one delegated binding from the retained listener root.
   *
   * @param binding - Binding name.
   */
  #removeBinding(binding: InteractionBindingName): void {
    const root = this.#listenerRoot;

    if (root === null || !this.#listenerBindings.has(binding)) {
      return;
    }

    if (binding === 'click') {
      root.removeEventListener(binding, this.#handleClick);
    } else if (binding === 'keydown') {
      root.removeEventListener(binding, this.#handleKeyDown);
    } else if (binding === 'pointerdown') {
      root.removeEventListener(binding, this.#handlePointerDown);
    } else if (binding === 'pointermove') {
      root.removeEventListener(binding, this.#handlePointerMove);
    } else if (binding === 'pointerup') {
      root.removeEventListener(binding, this.#handlePointerUp);
    } else if (binding === 'pointercancel') {
      root.removeEventListener(binding, this.#handlePointerCancel);
    } else {
      root.removeEventListener(binding, this.#handleLostPointerCapture);
    }

    this.#listenerBindings.delete(binding);
  }

  /**
   * Removes all delegated handlers and clears pointer state.
   */
  disconnect(): void {
    const root = this.#listenerRoot;
    const errors: unknown[] = [];

    this.#root = null;
    attemptInteractionCleanup(() => this.#clearClickSuppression(), errors);
    attemptInteractionCleanup(() => this.#detachPointerEndHandlers(), errors);

    if (root !== null) {
      this.#releasePointerCapture(root);
      [...this.#listenerBindings].forEach((binding) => {
        attemptInteractionCleanup(() => this.#removeBinding(binding), errors);
      });
    }

    this.#listenerRoot = this.#listenerBindings.size > 0 ? root : null;

    this.#pointerState = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      dragged: false,
      dragEligible: false,
    };

    throwInteractionCleanupErrors(errors);
  }

  /**
   * Releases interaction dependencies after permanent instance destruction.
   */
  destroy(): void {
    const errors: unknown[] = [];

    attemptInteractionCleanup(() => this.disconnect(), errors);
    this.#diagnostics = null;
    this.#scrollContext = null;
    this.#events = null;
    this.#getRenderRecordByKey = getNull;
    this.#getRenderRecords = getEmptyArray;
    this.#getFallbackRoot = getNull;
    this.#getGeometryAvailable = () => true;
    this.#canHandleKeyboardEvent = () => false;
    this.#onSelectionRequest = null;
    this.#coordinateActivation = (run) => run();
    this.#handledSourceEvents = new WeakSet();
    this.#options = createDefaultOptions();
    throwInteractionCleanupErrors(errors);
  }

  /**
   * Returns the current logical selected render-record key without mutation.
   *
   * @returns Selected key or null while selection is disabled or empty.
   */
  getSelectedKey(): string | null {
    if (!isKeyboardAccessibilityEnabled(this.#options)) {
      return null;
    }

    const records = this.#getRenderRecords();

    if (!Array.isArray(records) || records.length === 0) {
      return null;
    }

    return records[this.#selectedIndex]?.key ?? null;
  }

  /**
   * Clamps or resets selection against current options and render records.
   *
   * @param previousKey - Effective key before the enclosing state mutation.
   * @returns Real key transition or null.
   */
  synchronizeSelection(previousKey: string | null = this.getSelectedKey()): TrackerSelectionTransition | null {
    const records = this.#getRenderRecords();

    if (!isKeyboardAccessibilityEnabled(this.#options) || !Array.isArray(records) || records.length === 0) {
      this.#selectedIndex = 0;
    } else {
      const previousIndex = previousKey === null ? -1 : records.findIndex((record) => record.key === previousKey);

      this.#selectedIndex =
        previousIndex >= 0 ? previousIndex : Math.min(Math.max(0, this.#selectedIndex), records.length - 1);
    }

    const nextKey = this.getSelectedKey();

    return previousKey === nextKey ? null : { previousKey, nextKey };
  }

  /**
   * Revalidates and commits one keyboard navigation request.
   *
   * @param request - Navigation request.
   * @returns Committed key transition or null at a list boundary.
   */
  commitSelectionRequest(request: TrackerSelectionRequest): TrackerSelectionTransition | null {
    if (
      !this.#canHandleKeyboardEvent() ||
      !isKeyboardAccessibilityEnabled(this.#options) ||
      !this.#getGeometryAvailable() ||
      !this.#isNavigationKey(request?.navigationKey)
    ) {
      return null;
    }

    const records = this.#getRenderRecords();

    if (!Array.isArray(records) || records.length === 0) {
      return null;
    }

    const previousKey = this.getSelectedKey();
    const currentIndex = Math.min(Math.max(0, this.#selectedIndex), records.length - 1);
    const key = request.navigationKey;
    const orientation = this.#options.orientation;
    const isForward =
      (orientation === ORIENTATIONS.HORIZONTAL && key === 'ArrowRight') ||
      (orientation === ORIENTATIONS.VERTICAL && key === 'ArrowDown');
    const isBackward =
      (orientation === ORIENTATIONS.HORIZONTAL && key === 'ArrowLeft') ||
      (orientation === ORIENTATIONS.VERTICAL && key === 'ArrowUp');

    if (key === 'Home') {
      this.#selectedIndex = 0;
    } else if (key === 'End') {
      this.#selectedIndex = records.length - 1;
    } else if (isForward) {
      this.#selectedIndex = Math.min(records.length - 1, currentIndex + 1);
    } else if (isBackward) {
      this.#selectedIndex = Math.max(0, currentIndex - 1);
    }

    const nextKey = this.getSelectedKey();

    return previousKey === nextKey ? null : { previousKey, nextKey };
  }

  /**
   * Returns the currently selected render record for keyboard interaction.
   *
   * @returns Render record or null.
   */
  #getSelectedRenderRecord(): TrackerRenderRecord | null {
    const records = this.#getRenderRecords();

    if (!Array.isArray(records) || records.length === 0) {
      return null;
    }

    const index = Math.min(Math.max(0, this.#selectedIndex), records.length - 1);

    this.#selectedIndex = index;

    return records[index] || null;
  }

  /**
   * Checks whether a source event has already activated core interaction.
   *
   * @param sourceEvent - Source event candidate.
   * @returns True when the exact event object was already handled.
   */
  #hasHandledSourceEvent(sourceEvent: Event | null | undefined): boolean {
    return sourceEvent !== null && typeof sourceEvent === 'object' && this.#handledSourceEvents.has(sourceEvent);
  }

  /**
   * Marks a source event as handled by core interaction.
   *
   * @param sourceEvent - Source event candidate.
   */
  #markSourceEventHandled(sourceEvent: Event | null | undefined): void {
    if (sourceEvent !== null && typeof sourceEvent === 'object') {
      this.#handledSourceEvents.add(sourceEvent);
    }
  }

  /**
   * Updates controller dependencies.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<InteractionControllerContext> = {}): void {
    if ('scrollContext' in context) {
      this.#scrollContext = context.scrollContext || null;
    }

    if ('events' in context) {
      this.#events = context.events || null;
    }

    if ('diagnostics' in context) {
      this.#diagnostics = context.diagnostics || null;
    }

    if (typeof context.getRenderRecordByKey === 'function') {
      this.#getRenderRecordByKey = context.getRenderRecordByKey;
    }

    if (typeof context.getRenderRecords === 'function') {
      this.#getRenderRecords = context.getRenderRecords;
    }

    if (typeof context.getFallbackRoot === 'function') {
      this.#getFallbackRoot = context.getFallbackRoot;
    }

    if (typeof context.getGeometryAvailable === 'function') {
      this.#getGeometryAvailable = context.getGeometryAvailable;
    }

    if (typeof context.canHandleKeyboardEvent === 'function') {
      this.#canHandleKeyboardEvent = context.canHandleKeyboardEvent;
    }

    if ('onSelectionRequest' in context) {
      this.#onSelectionRequest = typeof context.onSelectionRequest === 'function' ? context.onSelectionRequest : null;
    }

    if (typeof context.coordinateActivation === 'function') {
      this.#coordinateActivation = context.coordinateActivation;
    }
  }

  /**
   * Resolves the root for manual activation helpers.
   *
   * Explicit manual calls may legitimately target a host-owned root, so the
   * fallback root is only used here and never for delegated listeners.
   *
   * @returns Connected root, fallback root, or null.
   */
  #resolveManualRoot(): HTMLElement | null {
    if (this.#root !== null) {
      return this.#root;
    }

    const fallbackRoot = this.#getFallbackRoot();

    return isHTMLElement(fallbackRoot) && isInActiveDocument(fallbackRoot, this.#getActiveDocument())
      ? fallbackRoot
      : null;
  }

  /**
   * Returns the document of the mounted authoritative scroll realm.
   *
   * @returns Active document, or null while no scroll context is mounted.
   */
  #getActiveDocument(): Document | null {
    return this.#scrollContext?.document ?? null;
  }

  /**
   * Resolves the track element used for manual track activation geometry.
   *
   * The connected delegated root always wins. Without it the event target is
   * preferred: framework wrappers forward track events only when the track
   * element itself is the target, while `currentTarget` of a native event may
   * point at a framework delegation container (for example the React root)
   * instead of the track. The fallback root (usually the mount target) is a
   * last resort and may not match the track geometry.
   *
   * @param sourceEvent - Source pointer or mouse event.
   * @returns Track element for scroll geometry or null.
   */
  #resolveManualTrackRoot(sourceEvent: PointerEvent | MouseEvent): HTMLElement | null {
    if (this.#root !== null) {
      return this.#root;
    }

    if (isHTMLElement(sourceEvent?.target) && isInActiveDocument(sourceEvent.target, this.#getActiveDocument())) {
      return sourceEvent.target;
    }

    if (
      isHTMLElement(sourceEvent?.currentTarget) &&
      isInActiveDocument(sourceEvent.currentTarget, this.#getActiveDocument())
    ) {
      return sourceEvent.currentTarget;
    }

    return this.#resolveManualRoot();
  }

  /**
   * Updates interaction options.
   *
   * Reconnection is used because enabled handlers are option-driven and the
   * handler set is small.
   *
   * @param options - Committed Tracker options.
   */
  update(options: TrackerResolvedOptions): void {
    if (this.#root === null) {
      this.#options = options;
      return;
    }

    const desiredBindings = this.#getDesiredBindings(options);
    const stagedBindings: InteractionBindingName[] = [];

    try {
      desiredBindings.forEach((binding) => {
        if (!this.#listenerBindings.has(binding)) {
          this.#addBinding(binding);
          stagedBindings.push(binding);
        }
      });
    } catch (error) {
      const errors: unknown[] = [error];

      [...stagedBindings].reverse().forEach((binding) => {
        attemptInteractionCleanup(() => this.#removeBinding(binding), errors);
      });
      throwInteractionCleanupErrors(errors);
    }

    const previousOptions = this.#options;

    this.#options = options;
    const cleanupErrors: unknown[] = [];
    const shouldCancelPointer =
      this.#pointerState.active && previousOptions.interaction.drag && !options.interaction.drag;

    if (shouldCancelPointer) {
      this.#releasePointerCapture(this.#root);
      attemptInteractionCleanup(() => this.#resetPointerState(), cleanupErrors);
    }

    [...this.#listenerBindings].forEach((binding) => {
      if (!desiredBindings.has(binding)) {
        attemptInteractionCleanup(() => this.#removeBinding(binding), cleanupErrors);
      }
    });

    if (cleanupErrors.length > 0) {
      this.#diagnostics?.warn?.(
        'interaction-update-cleanup-failure',
        'Tracker interaction update committed but obsolete listener cleanup failed.',
        { errors: cleanupErrors.map((error) => String(error)) },
      );
    }
  }

  /**
   * Handles semantic activation from click events.
   *
   * @param event - Source click event.
   */
  #handleClick = (event: MouseEvent): void => {
    if (this.#suppressNextClick) {
      this.#clearClickSuppression();
      event.preventDefault();
      return;
    }

    if (this.#options?.interaction?.activation === false) {
      return;
    }

    this.#activateFromEvent(event);
  };

  /**
   * Handles keyboard navigation and activation in accessibility mode.
   *
   * @param event - Source keyboard event.
   */
  #handleKeyDown = (event: KeyboardEvent): void => {
    this.#handleKeyboardEvent(event);
  };

  /**
   * Handles keyboard navigation and activation in accessibility mode.
   *
   * @param event - Source keyboard event.
   * @returns True when the keyboard event was handled.
   */
  #handleKeyboardEvent(event: KeyboardEvent): boolean {
    if (
      !this.#canHandleKeyboardEvent() ||
      !isKeyboardAccessibilityEnabled(this.#options) ||
      !this.#getGeometryAvailable() ||
      this.#hasHandledSourceEvent(event)
    ) {
      return false;
    }

    if (ACTIVATION_KEYS.has(event.key)) {
      if (this.#options.interaction?.activation === false) {
        return false;
      }

      const renderRecord = this.#getSelectedRenderRecord();

      if (renderRecord !== null) {
        this.#markSourceEventHandled(event);
        this.#activateRenderRecord(renderRecord, event);
        event.preventDefault();

        return true;
      }

      return false;
    }

    if (
      !this.#isNavigationKey(event.key) ||
      this.#onSelectionRequest === null ||
      this.#getRenderRecords().length === 0
    ) {
      return false;
    }

    this.#markSourceEventHandled(event);
    event.preventDefault();
    this.#onSelectionRequest({
      navigationKey: event.key as TrackerSelectionNavigationKey,
    });

    return true;
  }

  /**
   * Checks whether a key moves keyboard selection for the current orientation.
   *
   * Arrow keys of the opposite axis are not treated as handled so the host
   * page keeps their default behavior.
   *
   * @param key - Keyboard event key.
   * @returns True when the key participates in keyboard navigation.
   */
  #isNavigationKey(key: string): boolean {
    if (!NAVIGATION_KEYS.has(key)) {
      return false;
    }

    if (key === 'Home' || key === 'End') {
      return true;
    }

    return this.#options.orientation === ORIENTATIONS.HORIZONTAL
      ? key === 'ArrowLeft' || key === 'ArrowRight'
      : key === 'ArrowUp' || key === 'ArrowDown';
  }

  /**
   * Handles pointer cancellation.
   *
   * @param event - Source pointer event.
   */
  #handlePointerCancel = (event: PointerEvent): void => {
    if (!this.#pointerState.active || this.#pointerState.pointerId !== event.pointerId) {
      return;
    }

    this.#releasePointerCapture(this.#root);
    this.#resetPointerState();
  };

  /**
   * Schedules pointer-session cleanup after terminal-event dispatch completes.
   *
   * The capture-phase listener observes terminal events even when a descendant
   * stops propagation. A timer task, rather than a microtask, preserves normal
   * marker activation in browsers that perform a microtask checkpoint between
   * native event-listener callbacks.
   *
   * @param event - Source terminal pointer event.
   */
  #handleDocumentPointerEnd = (event: PointerEvent): void => {
    if (!this.#pointerState.active || this.#pointerState.pointerId !== event.pointerId) {
      return;
    }

    const pointerState = this.#pointerState;
    const resetOrphanedSession = () => {
      this.#cancelPointerEndTimer = null;

      if (this.#pointerState !== pointerState) {
        return;
      }

      this.#releasePointerCapture(this.#root);
      this.#resetPointerState();
    };
    const documentWindow = this.#pointerEndDocument?.defaultView;

    if (documentWindow !== null && documentWindow !== undefined) {
      const timer = documentWindow.setTimeout(resetOrphanedSession, 0);

      this.#cancelPointerEndTimer = () => documentWindow.clearTimeout(timer);
    } else {
      const timer = setTimeout(resetOrphanedSession, 0);

      this.#cancelPointerEndTimer = () => clearTimeout(timer);
    }
  };

  /** Resets pointer state when browser capture is released externally. */
  #handleLostPointerCapture = (event: PointerEvent): void => {
    if (this.#pointerState.active && this.#pointerState.pointerId === event.pointerId) {
      this.#resetPointerState();
    }
  };

  /**
   * Handles pointer down for optional drag behavior.
   *
   * @param event - Source pointer event.
   */
  #handlePointerDown = (event: PointerEvent): void => {
    if (
      this.#root === null ||
      this.#options.interaction?.drag !== true ||
      event.isPrimary === false ||
      event.button !== 0
    ) {
      return;
    }

    if (this.#pointerState.active) {
      this.#releasePointerCapture(this.#root);
      this.#resetPointerState();
    }

    const dragEligible =
      this.#options.interaction?.drag === true && findMarkerElement(event.target, this.#root) === null;

    this.#pointerState = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
      dragEligible,
    };
    this.#attachPointerEndHandlers(this.#root.ownerDocument);

    if (!dragEligible) {
      return;
    }

    try {
      this.#root.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional for this interaction model.
    }
  };

  /**
   * Handles pointer movement for optional track drag.
   *
   * @param event - Source pointer event.
   */
  #handlePointerMove = (event: PointerEvent): void => {
    if (
      this.#root === null ||
      this.#options?.interaction?.drag !== true ||
      !this.#pointerState.active ||
      !this.#pointerState.dragEligible ||
      this.#pointerState.pointerId !== event.pointerId ||
      !this.#getGeometryAvailable()
    ) {
      return;
    }

    const orientation = this.#options.orientation;
    const startPosition = getMainAxisClientPosition(
      { clientX: this.#pointerState.startX, clientY: this.#pointerState.startY },
      orientation,
    );
    const currentPosition = getMainAxisClientPosition(event, orientation);

    if (!this.#pointerState.dragged && Math.abs(currentPosition - startPosition) < DRAG_THRESHOLD) {
      return;
    }

    this.#pointerState.dragged = true;
    this.#scrollFromTrackEvent(event, this.#root, 'instant');
    event.preventDefault();
  };

  /**
   * Handles pointer up activation.
   *
   * @param event - Source pointer event.
   */
  #handlePointerUp = (event: PointerEvent): void => {
    if (
      this.#root === null ||
      event.isPrimary === false ||
      event.button !== 0 ||
      !this.#pointerState.active ||
      this.#pointerState.pointerId !== event.pointerId
    ) {
      return;
    }

    const wasDragged = this.#pointerState.dragged;

    this.#releasePointerCapture(this.#root);
    this.#resetPointerState();

    if (wasDragged) {
      this.#clearClickSuppression();
      this.#suppressNextClick = true;
      const activeWindow = this.#root.ownerDocument.defaultView;

      if (activeWindow === null) {
        this.#suppressNextClick = false;
      } else {
        this.#clickSuppressionWindow = activeWindow;
        this.#clickSuppressionTimer = activeWindow.setTimeout(() => {
          this.#clickSuppressionTimer = null;
          this.#clickSuppressionWindow = null;
          this.#suppressNextClick = false;
        }, 0);
      }
      event.preventDefault();
    }
  };

  /** Clears drag-click suppression and its realm-owned timer. */
  #clearClickSuppression(): void {
    const activeWindow = this.#clickSuppressionWindow;
    const timer = this.#clickSuppressionTimer;

    this.#clickSuppressionWindow = null;
    this.#clickSuppressionTimer = null;
    this.#suppressNextClick = false;

    if (activeWindow !== null && timer !== null) {
      activeWindow.clearTimeout(timer);
    }
  }

  /**
   * Clears pointer state.
   */
  #resetPointerState(): void {
    const errors: unknown[] = [];

    attemptInteractionCleanup(() => this.#detachPointerEndHandlers(), errors);
    this.#pointerState = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      dragged: false,
      dragEligible: false,
    };
    throwInteractionCleanupErrors(errors);
  }

  /** Attaches document-level terminal listeners for one active pointer session. */
  #attachPointerEndHandlers(document: Document): void {
    this.#detachPointerEndHandlers();
    this.#pointerEndDocument = document;

    try {
      this.#pointerEndBindings.add('pointerup');
      document.addEventListener('pointerup', this.#handleDocumentPointerEnd, true);
      this.#pointerEndBindings.add('pointercancel');
      document.addEventListener('pointercancel', this.#handleDocumentPointerEnd, true);
    } catch (error) {
      const errors: unknown[] = [error];

      attemptInteractionCleanup(() => this.#detachPointerEndHandlers(), errors);
      this.#pointerState = {
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        dragged: false,
        dragEligible: false,
      };
      throwInteractionCleanupErrors(errors);
    }
  }

  /** Cancels the pending document-pointer-end recovery timer, if any. */
  #clearPointerEndTimer(): void {
    const cancel = this.#cancelPointerEndTimer;

    this.#cancelPointerEndTimer = null;
    cancel?.();
  }

  /** Detaches document-level terminal listeners for the active pointer session. */
  #detachPointerEndHandlers(): void {
    this.#clearPointerEndTimer();

    const pointerEndDocument = this.#pointerEndDocument;

    if (pointerEndDocument === null) {
      return;
    }

    const errors: unknown[] = [];

    [...this.#pointerEndBindings].forEach((binding) => {
      attemptInteractionCleanup(() => {
        pointerEndDocument.removeEventListener(binding, this.#handleDocumentPointerEnd, true);
        this.#pointerEndBindings.delete(binding);
      }, errors);
    });

    if (this.#pointerEndBindings.size === 0) {
      this.#pointerEndDocument = null;
    }

    throwInteractionCleanupErrors(errors);
  }

  /**
   * Releases active pointer capture when the browser has not already done so.
   *
   * @param root - Root that may own the active capture.
   */
  #releasePointerCapture(root: HTMLElement | null): void {
    const pointerId = this.#pointerState.pointerId;

    if (root === null || !this.#pointerState.active || pointerId === null) {
      return;
    }

    try {
      if (typeof root.hasPointerCapture !== 'function' || root.hasPointerCapture(pointerId)) {
        root.releasePointerCapture(pointerId);
      }
    } catch {
      // The browser may have already released capture during lifecycle cleanup.
    }
  }

  /**
   * Scrolls the document according to a pointer position on the track.
   *
   * @param event - Source event.
   * @param root - Track element used for scroll geometry; the connected root by default.
   * @param behavior - Internal execution behavior.
   * @returns Clamped 0-1 activation ratio, or null when the root has no measurable size.
   */
  #scrollFromTrackEvent(
    event: PointerEvent | MouseEvent,
    root: HTMLElement | null = this.#root,
    behavior: TrackerScrollExecutionBehavior = 'auto',
  ): number | null {
    if (root === null) {
      return null;
    }

    const ratio = getTrackActivationRatio(root, event, this.#options.orientation);

    if (ratio === null) {
      return null;
    }

    const scrollContext = this.#scrollContext;

    if (scrollContext !== null) {
      const maxScrollPosition = scrollContext.getMetrics(this.#options.orientation).maxOffset;

      scrollContext.scrollToPhysicalOffset(maxScrollPosition * ratio, this.#options.orientation, behavior);

      event.preventDefault();
    }

    return ratio;
  }

  /**
   * Emits `track:activate` for a discrete (non drag-move) track activation gesture.
   *
   * @param ratio - Clamped 0-1 activation ratio, or null when unmeasurable.
   * @param sourceEvent - Source event.
   */
  #emitTrackActivate(ratio: number | null, sourceEvent: PointerEvent | MouseEvent): void {
    this.#events?.emit(EVENT_NAMES.TRACK_ACTIVATE, {
      position: ratio === null ? null : ratio * 100,
      sourceEvent,
    });
  }
}

export { InteractionController };
export type {
  InteractionControllerContext,
  InteractionControllerDiagnostics,
  TrackerSelectionRequest,
  TrackerSelectionTransition,
};
