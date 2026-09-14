import { isInComposedSubtree } from '../dom/composedTree.js';
import { isElement, isHTMLElement, isNode } from '../dom/element.js';
import { hasWindowEvents, isShadowRoot } from '../dom/environment.js';
import { cancelFrame, scheduleFrame } from '../dom/frame.js';
import { getInternalDomRegistry } from '../dom/internalDomRegistry.js';
import { RENDER_TARGETS } from '../schedule/renderTargets.js';
import { createDebounced } from '../utils/debounce.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import { areValuesEqual, hasOwn } from '../utils/object.js';
import { getNull, noop } from '../utils/function.js';
import { describeObserverTargetCandidate, resolveObserverTargets } from './resolveObserverTargets.js';
import type {
  TrackerDiagnosticCode,
  TrackerObserverTargetsReason,
  TrackerObserverTargetsResolver,
  TrackerRenderReason,
  TrackerRenderTarget,
  TrackerResolvedMutationUpdateOptions,
  TrackerResolvedOptions,
} from '../types.js';
import type { TrackerRuntimeContext } from '../tracker/mountContext.js';

interface ObserverControllerDiagnostics {
  /** Warning reporter. */
  warn?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
  /** Observer stats reporter. */
  recordObserverEvent?: (observerName: 'mutation' | 'resize' | 'scroll' | 'interval') => void;
}

interface ObserverControllerContext {
  /** Render scheduler. */
  scheduler: { request: (target: TrackerRenderTarget, reason?: TrackerRenderReason) => void };
  /** Diagnostics layer. */
  diagnostics?: ObserverControllerDiagnostics | null;
  /** Tracker root provider. */
  getRoot?: () => HTMLElement | null;
  /** Staged or committed runtime-context provider. */
  getRuntimeContext?: () => TrackerRuntimeContext | null;
}

interface ObserverUpdateOptionsSnapshot {
  /** Mutation observer options. */
  mutation: {
    enabled: boolean;
    targets: TrackerObserverTargetsResolver | undefined;
    options: MutationObserverInit;
    debounce: number;
  };
  /** Resize observer options. */
  resize: {
    enabled: boolean;
    targets: TrackerObserverTargetsResolver | undefined;
    debounce: number;
  };
  /** Scroll listener options. */
  scroll: { enabled: boolean };
  /** Interval update options. */
  interval: { enabled: boolean; delay: number };
}

/** Debounced void callback returned by createDebounced. */
type DebouncedVoidFn = (() => void) & { cancel: () => void; flush: () => void };

/** Resize sources coalesced by the shared resize request debouncer. */
type ResizeRenderSource = 'resize-observer' | 'window-resize';

/**
 * Runs one observer cleanup step without preventing subsequent cleanup.
 *
 * @param cleanup - Cleanup operation.
 * @param errors - Ordered cleanup errors.
 */
function attemptObserverCleanup(cleanup: () => void, errors: unknown[]): void {
  try {
    cleanup();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * Reports observer cleanup failures after all resources have been attempted.
 *
 * @param errors - Ordered cleanup errors.
 */
function throwObserverCleanupErrors(errors: unknown[]): void {
  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, 'Observer cleanup failed in multiple steps.');
  }
}

/**
 * Checks whether all nodes in a NodeList belong to the root subtree.
 *
 * Empty node lists return false so an empty childList record is not classified
 * as own mutation solely by added/removed node checks.
 *
 * @param nodes - Nodes to check.
 * @param root - Tracker root element.
 * @returns True when all nodes belong to Tracker DOM.
 */
function areAllNodesInRoot(nodes: NodeList, root: HTMLElement): boolean {
  if (!nodes || nodes.length === 0) {
    return false;
  }

  return Array.from(nodes).every((node) => isNodeInRoot(node, root));
}

/**
 * Checks whether two MutationObserver option objects are equivalent.
 *
 * @param left - First options object.
 * @param right - Second options object.
 * @returns True when options are equivalent.
 */
function areMutationObserverOptionsEqual(left: MutationObserverInit, right: MutationObserverInit): boolean {
  return (
    left.childList === right.childList &&
    left.subtree === right.subtree &&
    left.attributes === right.attributes &&
    areValuesEqual(copyArray(left.attributeFilter), copyArray(right.attributeFilter)) &&
    left.attributeOldValue === right.attributeOldValue &&
    left.characterData === right.characterData &&
    left.characterDataOldValue === right.characterDataOldValue
  );
}

/**
 * Checks whether two update option snapshots are equivalent.
 *
 * @param left - First snapshot.
 * @param right - Second snapshot.
 * @returns True when snapshots are equivalent.
 */
function areUpdateOptionsSnapshotsEqual(
  left: ObserverUpdateOptionsSnapshot | null,
  right: ObserverUpdateOptionsSnapshot | null,
): boolean {
  if (left === null || right === null) {
    return false;
  }

  return (
    left.mutation.enabled === right.mutation.enabled &&
    Object.is(left.mutation.targets, right.mutation.targets) &&
    left.mutation.debounce === right.mutation.debounce &&
    areMutationObserverOptionsEqual(left.mutation.options, right.mutation.options) &&
    left.resize.enabled === right.resize.enabled &&
    Object.is(left.resize.targets, right.resize.targets) &&
    left.resize.debounce === right.resize.debounce &&
    left.scroll.enabled === right.scroll.enabled &&
    left.interval.enabled === right.interval.enabled &&
    left.interval.delay === right.interval.delay
  );
}

/**
 * Copies an array option for snapshots.
 *
 * @param value - Array candidate.
 * @returns Array copy or null.
 */
function copyArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? [...value] : null;
}

/**
 * Creates a comparable snapshot of update-related options.
 *
 * @param options - Committed Tracker options.
 * @returns Update options snapshot.
 */
function createUpdateOptionsSnapshot(options: TrackerResolvedOptions): ObserverUpdateOptionsSnapshot {
  const { mutation, resize, scroll, interval } = options.updates;

  return {
    mutation: {
      enabled: mutation.enabled,
      targets: mutation.targets,
      options: getMutationObserverOptions(mutation),
      debounce: mutation.debounce,
    },
    resize: {
      enabled: resize.enabled,
      targets: resize.targets,
      debounce: resize.debounce,
    },
    scroll: {
      enabled: scroll.enabled,
    },
    interval: {
      enabled: interval.enabled,
      delay: interval.delay,
    },
  };
}

/**
 * Returns default mutation observer targets.
 *
 * @param runtimeContext - Active source, scroll, and renderer identities.
 * @returns Default mutation targets.
 */
function getDefaultMutationTargets(runtimeContext: TrackerRuntimeContext): Node[] {
  return [runtimeContext.sourceRoot];
}

/**
 * Returns default resize observer targets.
 *
 * @param runtimeContext - Active source, scroll, and renderer identities.
 * @returns Default resize targets.
 */
function getDefaultResizeTargets(runtimeContext: TrackerRuntimeContext): Element[] {
  const { sourceRoot, scrollRoot, renderRoot } = runtimeContext;
  const candidates: Element[] = [];

  if (sourceRoot.nodeType === 1) {
    candidates.push(sourceRoot as Element);
  } else if (sourceRoot.nodeType === 11) {
    candidates.push((sourceRoot as ShadowRoot).host);
  }

  if (isHTMLElement(scrollRoot)) {
    candidates.push(scrollRoot);
  }

  candidates.push(renderRoot);

  return [...new Set(candidates)];
}

/**
 * Returns normalized MutationObserver options.
 *
 * Optional old-value and attribute filter fields are included only when present
 * in validated options. `attributes` and `characterData` are auto-enabled when
 * dependent fields require them, mirroring the MutationObserver.observe() spec
 * behavior. Dependent fields take precedence over both omitted and explicitly
 * false parent flags; otherwise observe() would throw because the flags are
 * always set explicitly here.
 *
 * @param mutationOptions - Mutation update options.
 * @returns MutationObserver options.
 */
function getMutationObserverOptions(mutationOptions: TrackerResolvedMutationUpdateOptions): MutationObserverInit {
  const sourceOptions = mutationOptions.options;
  const hasAttributeFilter = Array.isArray(sourceOptions.attributeFilter) && sourceOptions.attributeFilter.length > 0;
  const observerOptions: MutationObserverInit = {
    childList: sourceOptions.childList !== false,
    subtree: sourceOptions.subtree !== false,
    attributes: sourceOptions.attributes === true || hasAttributeFilter || sourceOptions.attributeOldValue === true,
    characterData: sourceOptions.characterData === true || sourceOptions.characterDataOldValue === true,
  };

  if (hasAttributeFilter) {
    observerOptions.attributeFilter = [...sourceOptions.attributeFilter!];
  }

  if (hasOwn(sourceOptions, 'attributeOldValue')) {
    observerOptions.attributeOldValue = sourceOptions.attributeOldValue === true;
  }

  if (hasOwn(sourceOptions, 'characterDataOldValue')) {
    observerOptions.characterDataOldValue = sourceOptions.characterDataOldValue === true;
  }

  return observerOptions;
}

/**
 * Returns the MutationObserver constructor from one window.
 *
 * @param activeWindow - Window that owns the observer constructor.
 * @returns MutationObserver constructor or null when unavailable.
 */
function getMutationObserverConstructor(activeWindow: Window | null): typeof MutationObserver | null {
  const MutationObserverConstructor = (activeWindow as (Window & { MutationObserver?: typeof MutationObserver }) | null)
    ?.MutationObserver;

  return typeof MutationObserverConstructor === 'function' ? MutationObserverConstructor : null;
}

/**
 * Returns the ResizeObserver constructor from one window.
 *
 * @param activeWindow - Window that owns the observer constructor.
 * @returns ResizeObserver constructor or null when unavailable.
 */
function getResizeObserverConstructor(activeWindow: Window | null): typeof ResizeObserver | null {
  const ResizeObserverConstructor = (activeWindow as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)
    ?.ResizeObserver;

  return typeof ResizeObserverConstructor === 'function' ? ResizeObserverConstructor : null;
}

/**
 * Checks whether a node is the root or belongs to the root subtree.
 *
 * @param node - Node to check.
 * @param root - Tracker root element.
 * @returns True when node belongs to Tracker DOM.
 */
function isNodeInRoot(node: Node, root: HTMLElement): boolean {
  return node === root || root.contains(node);
}

/**
 * Checks whether a childList mutation only changes Tracker-owned nodes.
 *
 * @param mutation - Mutation record.
 * @param root - Tracker root element.
 * @returns True when childList mutation is internal to Tracker DOM.
 */
function isOwnChildListMutation(mutation: MutationRecord, root: HTMLElement): boolean {
  if (mutation.type !== 'childList') {
    return false;
  }

  const hasAddedNodes = mutation.addedNodes.length > 0;
  const hasRemovedNodes = mutation.removedNodes.length > 0;

  if (!hasAddedNodes && !hasRemovedNodes) {
    return false;
  }

  const addedNodesAreOwn = !hasAddedNodes || areAllNodesInRoot(mutation.addedNodes, root);
  const removedNodesAreOwn = !hasRemovedNodes || areAllNodesInRoot(mutation.removedNodes, root);

  return addedNodesAreOwn && removedNodesAreOwn;
}

/**
 * Checks whether a mutation belongs to the Tracker's own DOM subtree.
 *
 * @param mutation - Mutation record.
 * @param root - Tracker root element.
 * @returns True when mutation should be ignored.
 */
function isOwnMutation(mutation: MutationRecord, root: HTMLElement | null): boolean {
  if (!isNode(mutation.target)) {
    return false;
  }

  const ownerDocument = (mutation.target as Node).ownerDocument;

  if (ownerDocument !== null && getInternalDomRegistry(ownerDocument).isMutationInternal(mutation)) {
    return true;
  }

  if (!root) {
    return false;
  }

  if (isNodeInRoot(mutation.target as Node, root)) {
    return true;
  }

  return isOwnChildListMutation(mutation, root);
}

/**
 * Controls DOM observer, window listener and interval update sources.
 *
 * The controller never renders directly. It requests render targets from
 * RenderScheduler.
 */
class ObserverController {
  /**
   * Whether observers are currently connected.
   */
  #connected = false;

  /** Generation used to invalidate animation-frame callbacks from obsolete connections. */
  #connectionGeneration = 0;

  /** Window used to construct observers, listeners and animation frames. */
  #connectedWindow: Window | null = null;

  /**
   * Debounced mutation handler.
   */
  #debouncedMutationRequest: DebouncedVoidFn | null = null;

  /** Shared debounced handler for element and window resize signals. */
  #debouncedResizeRequest: DebouncedVoidFn | null = null;

  /**
   * Diagnostics layer.
   */
  #diagnostics: ObserverControllerDiagnostics | null = null;

  /** Staged or committed runtime-context provider. */
  #getRuntimeContext: () => TrackerRuntimeContext | null = getNull;

  /**
   * Tracker root provider.
   */
  #getRoot: () => HTMLElement | null = getNull;

  /**
   * Active interval id.
   */
  #intervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Active MutationObserver.
   */
  #mutationObserver: MutationObserver | null = null;

  /**
   * Bound scroll handler.
   */
  #onScroll: (() => void) | null = null;

  /** Idempotent authoritative scroll-listener cleanup. */
  #scrollUnsubscribe: (() => void) | null = null;

  /** Bound capture-phase descendant-scroll handler. */
  #onDescendantScroll: ((event: Event) => void) | null = null;

  /** Event targets holding active descendant-scroll listeners. */
  #descendantScrollTargets: EventTarget[] = [];

  /** Descendant-scroll animation frame id. */
  #descendantScrollFrameId: number | null = null;

  /**
   * Bound window resize handler.
   */
  #onWindowResize: (() => void) | null = null;

  /** Resize sources accumulated during the active debounce window. */
  #pendingResizeSources = new Set<ResizeRenderSource>();

  /**
   * Active ResizeObserver.
   */
  #resizeObserver: ResizeObserver | null = null;

  /**
   * Render scheduler.
   */
  #scheduler: { request: (target: TrackerRenderTarget, reason?: TrackerRenderReason) => void } = { request: noop };

  /**
   * Scroll animation frame id.
   */
  #scrollFrameId: number | null = null;

  /**
   * Last connected update options snapshot.
   */
  #updateOptionsSnapshot: ObserverUpdateOptionsSnapshot | null = null;

  /**
   * @param context - Render scheduler, active DOM context, diagnostics and
   * root/mount target providers. References are retained for the controller lifetime.
   * No observers or listeners are created until connect(); disconnect() or
   * destroy() is required for cleanup after connect().
   */
  constructor(context: ObserverControllerContext) {
    this.#scheduler = context.scheduler;
    this.#diagnostics = context.diagnostics || null;
    this.#getRuntimeContext = typeof context.getRuntimeContext === 'function' ? context.getRuntimeContext : getNull;
    this.#getRoot = typeof context.getRoot === 'function' ? context.getRoot : getNull;
  }

  /**
   * Indicates whether update sources are connected.
   *
   * @returns True when connected.
   */
  get connected(): boolean {
    return this.#connected;
  }

  /**
   * Connects update sources according to current options.
   *
   * @param options - Committed Tracker options.
   * @param reason - Observer target resolution reason.
   */
  connect(options: TrackerResolvedOptions, reason: TrackerObserverTargetsReason = 'mount'): void {
    const snapshot = createUpdateOptionsSnapshot(options);

    this.disconnect();
    this.#updateOptionsSnapshot = snapshot;

    const runtimeContext = this.#getRuntimeContext();

    if (runtimeContext === null) {
      return;
    }

    this.#connectedWindow = runtimeContext.window;

    this.#connected = true;
    try {
      this.#connectResizeRequest(snapshot);

      this.#connectMutation(snapshot, reason);
      this.#connectResizeObserver(snapshot, reason);
      this.#connectScroll(snapshot);
      this.#connectWindowResize(snapshot);
      this.#connectInterval(snapshot);
    } catch (error) {
      const errors: unknown[] = [error];

      attemptObserverCleanup(() => this.disconnect(), errors);
      throwObserverCleanupErrors(errors);
    }
  }

  /**
   * Creates the shared request channel for element and window resize signals.
   *
   * @param snapshot - Update options snapshot.
   */
  #connectResizeRequest(snapshot: ObserverUpdateOptionsSnapshot): void {
    if (snapshot.resize.enabled === false) {
      return;
    }

    this.#debouncedResizeRequest = createDebounced(
      () => {
        const sources = [...this.#pendingResizeSources];

        this.#pendingResizeSources.clear();

        if (sources.length === 0) {
          return;
        }

        const reason: TrackerRenderReason =
          sources.length === 1
            ? { source: sources[0] }
            : {
                reasons: sources.map((source) => ({ source })),
              };

        this.#scheduler.request(RENDER_TARGETS.MARKERS, reason);
      },
      snapshot.resize.debounce,
      this.#connectedWindow,
    );
  }

  /**
   * Adds a resize source to the current debounce window.
   *
   * @param source - Resize signal source.
   */
  #requestResize(source: ResizeRenderSource): void {
    this.#pendingResizeSources.add(source);
    this.#debouncedResizeRequest?.();
  }

  /**
   * Connects interval updates.
   *
   * @param snapshot - Update options snapshot.
   */
  #connectInterval(snapshot: ObserverUpdateOptionsSnapshot): void {
    if (snapshot.interval.enabled === false) {
      return;
    }

    const connectedWindow = this.#connectedWindow;

    if (connectedWindow === null) {
      return;
    }

    const connectionGeneration = this.#connectionGeneration;

    this.#intervalId = connectedWindow.setInterval(() => {
      if (!this.#connected || connectionGeneration !== this.#connectionGeneration) {
        return;
      }

      this.#diagnostics?.recordObserverEvent?.('interval');
      this.#scheduler.request(RENDER_TARGETS.MARKERS, {
        source: 'interval',
      });
    }, snapshot.interval.delay) as unknown as ReturnType<typeof setInterval>;
  }

  /**
   * Connects MutationObserver updates.
   *
   * @param snapshot - Update options snapshot.
   * @param reason - Observer target resolution reason.
   */
  #connectMutation(snapshot: ObserverUpdateOptionsSnapshot, reason: TrackerObserverTargetsReason): void {
    if (snapshot.mutation.enabled === false) {
      return;
    }

    const MutationObserverConstructor = getMutationObserverConstructor(this.#connectedWindow);

    if (MutationObserverConstructor === null) {
      this.#diagnostics?.warn?.(
        'mutation-observer-unavailable',
        'MutationObserver is unavailable. Mutation updates were not connected.',
      );

      return;
    }

    const runtimeContext = this.#getRuntimeContext();
    const root = this.#getRoot() ?? runtimeContext?.renderRoot ?? null;

    if (root === null || runtimeContext === null) {
      return;
    }

    const targets = resolveObserverTargets({
      targets: snapshot.mutation.targets,
      defaultTargets: getDefaultMutationTargets(runtimeContext),
      runtimeContext,
      reason,
      observerType: 'mutation',
      diagnostics: this.#diagnostics,
    });

    if (targets.length === 0) {
      this.#diagnostics?.warn?.(
        'WARN_TRACKER_OBSERVER_EMPTY_TARGETS',
        'MutationObserver was not connected because resolved targets list is empty.',
        { observerType: 'mutation' },
      );

      return;
    }

    this.#debouncedMutationRequest = createDebounced(
      () => {
        this.#scheduler.request(RENDER_TARGETS.MARKERS, {
          source: 'mutation',
        });
      },
      snapshot.mutation.debounce,
      this.#connectedWindow,
    );

    const connectionGeneration = this.#connectionGeneration;

    this.#mutationObserver = new MutationObserverConstructor((mutations) => {
      if (!this.#connected || connectionGeneration !== this.#connectionGeneration) {
        return;
      }

      const currentRoot = this.#getRoot();
      const hasExternalMutation = mutations.some((mutation) => !isOwnMutation(mutation, currentRoot));

      if (!hasExternalMutation) {
        return;
      }

      this.#diagnostics?.recordObserverEvent?.('mutation');
      this.#debouncedMutationRequest?.();
    });

    let successfulTargets = 0;

    targets.forEach((target) => {
      try {
        this.#mutationObserver?.observe(target as Node, snapshot.mutation.options);
        successfulTargets += 1;
      } catch (error) {
        this.#diagnostics?.warn?.(
          'mutation-observer-observe-failed',
          'MutationObserver failed to observe a resolved target.',
          {
            target: describeObserverTargetCandidate(target, runtimeContext.document),
            error: getErrorMessage(error),
          },
        );
      }
    });

    if (successfulTargets === 0) {
      const mutationObserver = this.#mutationObserver;
      const debouncedMutationRequest = this.#debouncedMutationRequest;
      const cleanupErrors: unknown[] = [];

      this.#mutationObserver = null;
      this.#debouncedMutationRequest = null;
      attemptObserverCleanup(() => mutationObserver?.disconnect(), cleanupErrors);
      attemptObserverCleanup(() => debouncedMutationRequest?.cancel(), cleanupErrors);
      throwObserverCleanupErrors(cleanupErrors);
      this.#diagnostics?.warn?.(
        'WARN_TRACKER_OBSERVER_EMPTY_TARGETS',
        'MutationObserver was not connected because no resolved target could be observed.',
        { observerType: 'mutation', reason: 'observe-failed' },
      );
    }
  }

  /**
   * Connects ResizeObserver updates.
   *
   * @param snapshot - Update options snapshot.
   * @param reason - Observer target resolution reason.
   */
  #connectResizeObserver(snapshot: ObserverUpdateOptionsSnapshot, reason: TrackerObserverTargetsReason): void {
    if (snapshot.resize.enabled === false) {
      return;
    }

    const ResizeObserverConstructor = getResizeObserverConstructor(this.#connectedWindow);

    if (ResizeObserverConstructor === null) {
      this.#diagnostics?.warn?.(
        'resize-observer-unavailable',
        'ResizeObserver is unavailable. Element resize updates were not connected.',
      );

      return;
    }

    const runtimeContext = this.#getRuntimeContext();
    const root = this.#getRoot() ?? runtimeContext?.renderRoot ?? null;

    if (root === null || runtimeContext === null) {
      return;
    }

    const targets = resolveObserverTargets({
      targets: snapshot.resize.targets,
      defaultTargets: getDefaultResizeTargets(runtimeContext),
      runtimeContext,
      reason,
      observerType: 'resize',
      diagnostics: this.#diagnostics,
    });

    if (targets.length === 0) {
      this.#diagnostics?.warn?.(
        'WARN_TRACKER_OBSERVER_EMPTY_TARGETS',
        'ResizeObserver was not connected because resolved targets list is empty.',
        { observerType: 'resize' },
      );

      return;
    }

    const connectionGeneration = this.#connectionGeneration;

    this.#resizeObserver = new ResizeObserverConstructor(() => {
      if (!this.#connected || connectionGeneration !== this.#connectionGeneration) {
        return;
      }

      this.#diagnostics?.recordObserverEvent?.('resize');
      this.#requestResize('resize-observer');
    });

    let successfulTargets = 0;

    targets.forEach((target) => {
      try {
        this.#resizeObserver?.observe(target as Element);
        successfulTargets += 1;
      } catch (error) {
        this.#diagnostics?.warn?.(
          'resize-observer-observe-failed',
          'ResizeObserver failed to observe a resolved target.',
          {
            target: describeObserverTargetCandidate(target, runtimeContext.document),
            error: getErrorMessage(error),
          },
        );
      }
    });

    if (successfulTargets === 0) {
      const resizeObserver = this.#resizeObserver;
      const cleanupErrors: unknown[] = [];

      this.#resizeObserver = null;
      attemptObserverCleanup(() => resizeObserver?.disconnect(), cleanupErrors);
      throwObserverCleanupErrors(cleanupErrors);
      this.#diagnostics?.warn?.(
        'WARN_TRACKER_OBSERVER_EMPTY_TARGETS',
        'ResizeObserver was not connected because no resolved target could be observed.',
        { observerType: 'resize', reason: 'observe-failed' },
      );
    }
  }

  /**
   * Connects scroll updates.
   *
   * Scroll updates are coalesced through animation frames and request marker
   * geometry because sticky and fixed sources can move in content coordinates.
   * Marker rendering also synchronizes the viewport indicator.
   *
   * @param snapshot - Update options snapshot.
   */
  #connectScroll(snapshot: ObserverUpdateOptionsSnapshot): void {
    const runtimeContext = this.#getRuntimeContext();
    const scrollContext = runtimeContext?.scrollContext ?? null;

    if (snapshot.scroll.enabled === false || runtimeContext === null || scrollContext === null) {
      return;
    }

    const connectionGeneration = this.#connectionGeneration;

    this.#onScroll = () => {
      if (!this.#connected || connectionGeneration !== this.#connectionGeneration) {
        return;
      }

      if (this.#scrollFrameId !== null) {
        return;
      }

      this.#scrollFrameId = scheduleFrame(() => {
        if (!this.#connected || connectionGeneration !== this.#connectionGeneration) {
          return;
        }

        this.#scrollFrameId = null;
        this.#diagnostics?.recordObserverEvent?.('scroll');
        this.#scheduler.request(RENDER_TARGETS.MARKERS, {
          source: 'scroll',
        });
      }, scrollContext.window);
    };

    this.#scrollUnsubscribe = scrollContext.connectScrollListener(this.#onScroll);
    this.#connectDescendantScroll(runtimeContext);
  }

  /**
   * Connects descendant-scroll invalidation for the active document and source tree.
   *
   * Capture-phase passive listeners catch scroll events from nested scrollable
   * elements inside the source or scroll subtree. A containing ShadowRoot is
   * observed directly because scroll events do not cross its boundary. The
   * handler performs bounded ancestor validation and scheduler enqueueing
   * only; a synchronous burst coalesces to at most one marker render request
   * per animation frame.
   *
   * @param runtimeContext - Active source, scroll, and renderer identities.
   */
  #connectDescendantScroll(runtimeContext: TrackerRuntimeContext): void {
    const { document: activeDocument, window: activeWindow, sourceRoot, scrollRoot } = runtimeContext;
    const connectionGeneration = this.#connectionGeneration;

    this.#onDescendantScroll = (event: Event) => {
      if (!this.#connected || connectionGeneration !== this.#connectionGeneration) {
        return;
      }

      const target = event.target;

      // Window/document scroll is covered by the authoritative scroll listener.
      if (!isElement(target) || target === scrollRoot) {
        return;
      }

      const isInScrollSubtree = isHTMLElement(scrollRoot) && isInComposedSubtree(target, scrollRoot);

      if (!isInScrollSubtree && !isInComposedSubtree(target, sourceRoot)) {
        return;
      }

      if (getInternalDomRegistry(activeDocument).isNodeExcluded(target)) {
        return;
      }

      if (this.#descendantScrollFrameId !== null) {
        return;
      }

      this.#descendantScrollFrameId = scheduleFrame(() => {
        if (!this.#connected || connectionGeneration !== this.#connectionGeneration) {
          return;
        }

        this.#descendantScrollFrameId = null;
        this.#diagnostics?.recordObserverEvent?.('scroll');
        this.#scheduler.request(RENDER_TARGETS.MARKERS, {
          source: 'scroll',
        });
      }, activeWindow);
    };

    const sourceTreeRoot = sourceRoot.getRootNode();
    const listenerTargets: EventTarget[] = [activeDocument, ...(isShadowRoot(sourceTreeRoot) ? [sourceTreeRoot] : [])];

    listenerTargets.forEach((target) => {
      target.addEventListener('scroll', this.#onDescendantScroll!, {
        capture: true,
        passive: true,
      });
      this.#descendantScrollTargets.push(target);
    });
  }

  /**
   * Connects window resize updates.
   *
   * Window resize can affect viewport and marker geometry, so it requests marker
   * synchronization.
   *
   * @param snapshot - Update options snapshot.
   */
  #connectWindowResize(snapshot: ObserverUpdateOptionsSnapshot): void {
    const activeWindow = this.#connectedWindow;

    if (snapshot.resize.enabled === false || !hasWindowEvents(activeWindow) || activeWindow === null) {
      return;
    }

    const connectionGeneration = this.#connectionGeneration;

    this.#onWindowResize = () => {
      if (!this.#connected || connectionGeneration !== this.#connectionGeneration) {
        return;
      }

      this.#diagnostics?.recordObserverEvent?.('resize');
      this.#requestResize('window-resize');
    };

    activeWindow.addEventListener('resize', this.#onWindowResize, {
      passive: true,
    });
  }

  /**
   * Disconnects all update sources and cancels delayed work.
   */
  disconnect(): void {
    const connectedWindow = this.#connectedWindow;
    const mutationObserver = this.#mutationObserver;
    const resizeObserver = this.#resizeObserver;
    const debouncedMutationRequest = this.#debouncedMutationRequest;
    const debouncedResizeRequest = this.#debouncedResizeRequest;
    const intervalId = this.#intervalId;
    const scrollFrameId = this.#scrollFrameId;
    const scrollUnsubscribe = this.#scrollUnsubscribe;
    const descendantScrollFrameId = this.#descendantScrollFrameId;
    const descendantScrollTargets = this.#descendantScrollTargets;
    const onDescendantScroll = this.#onDescendantScroll;
    const onWindowResize = this.#onWindowResize;
    const errors: unknown[] = [];

    this.#connected = false;
    this.#connectionGeneration += 1;
    this.#updateOptionsSnapshot = null;
    this.#mutationObserver = null;
    this.#resizeObserver = null;
    this.#debouncedMutationRequest = null;
    this.#debouncedResizeRequest = null;
    this.#intervalId = null;
    this.#scrollFrameId = null;
    this.#scrollUnsubscribe = null;
    this.#onScroll = null;
    this.#descendantScrollFrameId = null;
    this.#descendantScrollTargets = [];
    this.#onDescendantScroll = null;
    this.#onWindowResize = null;
    this.#connectedWindow = null;
    this.#pendingResizeSources.clear();

    if (mutationObserver !== null) {
      attemptObserverCleanup(() => mutationObserver.disconnect(), errors);
    }

    if (resizeObserver !== null) {
      attemptObserverCleanup(() => resizeObserver.disconnect(), errors);
    }

    if (debouncedMutationRequest !== null) {
      attemptObserverCleanup(() => debouncedMutationRequest.cancel?.(), errors);
    }

    if (debouncedResizeRequest !== null) {
      attemptObserverCleanup(() => debouncedResizeRequest.cancel?.(), errors);
    }

    if (intervalId !== null) {
      attemptObserverCleanup(() => connectedWindow?.clearInterval(intervalId as unknown as number), errors);
    }

    if (scrollFrameId !== null) {
      attemptObserverCleanup(() => cancelFrame(scrollFrameId, connectedWindow), errors);
    }

    if (scrollUnsubscribe !== null) {
      attemptObserverCleanup(scrollUnsubscribe, errors);
    }

    if (descendantScrollFrameId !== null) {
      attemptObserverCleanup(() => cancelFrame(descendantScrollFrameId, connectedWindow), errors);
    }

    if (onDescendantScroll !== null) {
      descendantScrollTargets.forEach((target) => {
        attemptObserverCleanup(
          () => target.removeEventListener('scroll', onDescendantScroll, { capture: true }),
          errors,
        );
      });
    }

    if (hasWindowEvents(connectedWindow) && onWindowResize !== null) {
      attemptObserverCleanup(() => connectedWindow!.removeEventListener('resize', onWindowResize), errors);
    }

    throwObserverCleanupErrors(errors);
  }

  /**
   * Releases observer dependencies after permanent instance destruction.
   */
  destroy(): void {
    const errors: unknown[] = [];

    attemptObserverCleanup(() => this.disconnect(), errors);
    this.#diagnostics = null;
    this.#getRuntimeContext = getNull;
    this.#getRoot = getNull;
    this.#scheduler = { request: noop };
    throwObserverCleanupErrors(errors);
  }

  /**
   * Reconnects update sources when update-related options changed.
   *
   * @param options - Committed Tracker options.
   */
  update(options: TrackerResolvedOptions): void {
    const nextSnapshot = createUpdateOptionsSnapshot(options);

    if (areUpdateOptionsSnapshotsEqual(this.#updateOptionsSnapshot, nextSnapshot)) {
      return;
    }

    this.connect(options, 'options:update');
  }

  /**
   * Updates observer context.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<ObserverControllerContext> = {}): void {
    if (context.scheduler) {
      this.#scheduler = context.scheduler;
    }

    if ('diagnostics' in context) {
      this.#diagnostics = context.diagnostics || null;
    }

    if (typeof context.getRuntimeContext === 'function') {
      this.#getRuntimeContext = context.getRuntimeContext;
    }

    if (typeof context.getRoot === 'function') {
      this.#getRoot = context.getRoot;
    }
  }
}

export { ObserverController };
export type { ObserverControllerContext, ObserverControllerDiagnostics };
