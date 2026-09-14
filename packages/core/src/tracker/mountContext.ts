import { isInComposedSubtree } from '../dom/composedTree.js';
import { getOwnerDocument, getOwnerWindow } from '../dom/context.js';
import { isElement, isHTMLElement } from '../dom/element.js';
import { isSourceRoot } from '../dom/environment.js';
import { TrackerLifecycleError } from '../errors.js';
import type { TrackerScrollContext } from '../scroll/scrollContext.js';
import type {
  TrackerIntegrationMountRequest,
  TrackerRendererMountTarget,
  TrackerScrollMode,
  TrackerSourceRoot,
} from '../types.js';
import type { TrackerInstance } from './createTrackerInstance.js';

/** Fully normalized non-null mount input used by lifecycle acquisition. */
interface TrackerNormalizedMountRequest {
  /** Authoritative source query root. */
  sourceRoot: TrackerSourceRoot;
  /** Normalized page or element scroll root. */
  scrollRoot: Window | HTMLElement;
  /** Explicit renderer ownership target. */
  rendererTarget: TrackerRendererMountTarget;
  /** Common owner document. */
  document: Document;
  /** Common owner window. */
  window: Window;
  /** Normalized runtime mode. */
  scrollMode: TrackerScrollMode;
}

/** Committed runtime identities and authoritative scroll boundary. */
interface TrackerRuntimeContext {
  /** Common owner document. */
  document: Document;
  /** Common owner window. */
  window: Window;
  /** Authoritative source query root. */
  sourceRoot: TrackerSourceRoot;
  /** Normalized page or element scroll root. */
  scrollRoot: Window | HTMLElement;
  /** Normalized runtime mode. */
  scrollMode: TrackerScrollMode;
  /** Validated actual renderer output root. */
  renderRoot: HTMLElement;
  /** Authoritative geometry and scroll boundary. */
  scrollContext: TrackerScrollContext;
}

/**
 * Returns staged runtime identities during mount, otherwise committed identities.
 *
 * @param instance - Internal Tracker instance.
 * @returns Active internal runtime context or null.
 */
function getActiveTrackerRuntimeContext(instance: TrackerInstance): TrackerRuntimeContext | null {
  return instance.stagedRuntimeContext ?? instance.runtimeContext;
}

/**
 * Creates a lifecycle error for an invalid mount identity or realm.
 *
 * @param message - Human-readable failure description.
 * @param code - Stable public error code.
 * @param cause - Optional underlying failure.
 * @returns Lifecycle error.
 */
function createMountLifecycleError(
  message: string,
  code: 'ERR_TRACKER_INVALID_CONTEXT' | 'ERR_TRACKER_REALM_MISMATCH' = 'ERR_TRACKER_INVALID_CONTEXT',
  cause?: unknown,
): TrackerLifecycleError {
  return new TrackerLifecycleError(message, {
    code,
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Returns the HTMLElement that establishes renderer-target ownership.
 *
 * @param target - Renderer target candidate.
 * @returns Target element.
 * @throws TrackerLifecycleError for an invalid target shape.
 */
function getRendererTargetElement(target: unknown): HTMLElement {
  if (target === null || typeof target !== 'object') {
    throw createMountLifecycleError('Tracker rendererTarget must be a host or root target.');
  }

  const candidate = target as Partial<TrackerRendererMountTarget> & Record<string, unknown>;
  const element = candidate.kind === 'host' ? candidate.host : candidate.kind === 'root' ? candidate.root : null;

  if (!isHTMLElement(element) || !element.isConnected) {
    throw createMountLifecycleError('Tracker renderer target must contain a connected HTMLElement.');
  }

  return element;
}

/**
 * Checks whether a value is the page-scroller alias of one document.
 *
 * @param value - Scroll-root candidate.
 * @param activeDocument - Candidate owner document.
 * @returns True for body, documentElement, or scrollingElement.
 */
function isPageScrollerAlias(value: unknown, activeDocument: Document): boolean {
  return (
    value === activeDocument.body ||
    value === activeDocument.documentElement ||
    value === activeDocument.scrollingElement
  );
}

/**
 * Checks whether one source root belongs to the candidate realm and is connected.
 *
 * @param value - Source-root candidate.
 * @param activeDocument - Candidate document.
 * @param activeWindow - Candidate window.
 * @returns True for a valid source root.
 */
function isSourceRootInRealm(
  value: unknown,
  activeDocument: Document,
  activeWindow: Window,
): value is TrackerSourceRoot {
  if (!isSourceRoot(value) || getOwnerDocument(value) !== activeDocument || getOwnerWindow(value) !== activeWindow) {
    return false;
  }

  if (value === activeDocument) {
    return activeDocument.defaultView === activeWindow;
  }

  if (isElement(value)) {
    return value.isConnected;
  }

  if (value.nodeType !== 11) {
    return false;
  }

  const shadowRoot = value as ShadowRoot;

  return shadowRoot.mode === 'open' && shadowRoot.host.isConnected;
}

/**
 * Normalizes and validates an advanced integration mount request without mutating runtime state.
 *
 * Root page-scroller aliases become the owner Window. Element-mode profile
 * validation is performed by its scroll-context implementation when enabled.
 *
 * @param request - Public integration mount request.
 * @returns Fully normalized Stage-A identities.
 * @throws TrackerLifecycleError when shape, connection, containment, or realm is invalid.
 */
function normalizeTrackerMountRequest(request: TrackerIntegrationMountRequest): TrackerNormalizedMountRequest {
  if (request === null || typeof request !== 'object') {
    throw createMountLifecycleError('Tracker mount request must be an object.');
  }

  const rendererTarget = (request as Partial<TrackerIntegrationMountRequest>).rendererTarget;
  const targetElement = getRendererTargetElement(rendererTarget);
  const activeDocument = getOwnerDocument(targetElement);
  const activeWindow = getOwnerWindow(targetElement);

  if (
    activeDocument === null ||
    activeWindow === null ||
    activeDocument.defaultView !== activeWindow ||
    activeWindow.document !== activeDocument
  ) {
    throw createMountLifecycleError(
      'Tracker renderer target does not belong to an active document and window.',
      'ERR_TRACKER_REALM_MISMATCH',
    );
  }

  const requestedScrollRoot = (request as Partial<TrackerIntegrationMountRequest>).scrollRoot;
  let scrollRoot: Window | HTMLElement;

  if (requestedScrollRoot === undefined || requestedScrollRoot === activeWindow) {
    scrollRoot = activeWindow;
  } else if (isPageScrollerAlias(requestedScrollRoot, activeDocument)) {
    scrollRoot = activeWindow;
  } else if (isHTMLElement(requestedScrollRoot)) {
    if (
      getOwnerDocument(requestedScrollRoot) !== activeDocument ||
      getOwnerWindow(requestedScrollRoot) !== activeWindow
    ) {
      throw createMountLifecycleError(
        'Tracker scroll root belongs to another DOM realm.',
        'ERR_TRACKER_REALM_MISMATCH',
      );
    }

    if (!requestedScrollRoot.isConnected) {
      throw createMountLifecycleError('Tracker scrollRoot must be connected.');
    }

    scrollRoot = requestedScrollRoot;
  } else {
    throw createMountLifecycleError('Tracker scrollRoot must be a Window or connected HTMLElement.');
  }

  const scrollMode: TrackerScrollMode = scrollRoot === activeWindow ? 'window' : 'element';
  const requestedSourceRoot = (request as Partial<TrackerIntegrationMountRequest>).sourceRoot;
  const sourceRoot =
    requestedSourceRoot === undefined
      ? scrollMode === 'window'
        ? activeDocument.body
        : scrollRoot
      : requestedSourceRoot;

  if (requestedSourceRoot === undefined && scrollMode === 'window' && activeDocument.body === null) {
    throw createMountLifecycleError(
      'Tracker could not resolve the default sourceRoot because document.body is unavailable. Wait for DOM readiness or pass an explicit sourceRoot.',
    );
  }

  if (!isSourceRoot(sourceRoot)) {
    throw createMountLifecycleError('Tracker sourceRoot must be a Document, Element, or open ShadowRoot.');
  }

  if (getOwnerDocument(sourceRoot) !== activeDocument || getOwnerWindow(sourceRoot) !== activeWindow) {
    throw createMountLifecycleError('Tracker sourceRoot belongs to another DOM realm.', 'ERR_TRACKER_REALM_MISMATCH');
  }

  if (!isSourceRootInRealm(sourceRoot, activeDocument, activeWindow)) {
    throw createMountLifecycleError('Tracker sourceRoot must be connected and active.');
  }

  if (scrollMode === 'element' && !isInComposedSubtree(sourceRoot, scrollRoot as HTMLElement)) {
    throw createMountLifecycleError('Tracker element-mode sourceRoot must be inside its scrollRoot.');
  }

  return {
    sourceRoot,
    scrollRoot,
    rendererTarget: rendererTarget!,
    document: activeDocument,
    window: activeWindow,
    scrollMode,
  };
}

/**
 * Compares a normalized request with the identities of one committed runtime.
 *
 * @param request - Normalized mount request.
 * @param runtime - Committed runtime context.
 * @param targetKind - Active renderer target kind.
 * @param targetElement - Active renderer host or root identity.
 * @returns True when every lifecycle identity is unchanged.
 */
function hasSameTrackerMountIdentity(
  request: TrackerNormalizedMountRequest,
  runtime: TrackerRuntimeContext,
  targetKind: TrackerRendererMountTarget['kind'],
  targetElement: HTMLElement | null,
): boolean {
  const requestTarget =
    request.rendererTarget.kind === 'host' ? request.rendererTarget.host : request.rendererTarget.root;

  return (
    request.sourceRoot === runtime.sourceRoot &&
    request.scrollRoot === runtime.scrollRoot &&
    request.document === runtime.document &&
    request.window === runtime.window &&
    request.scrollMode === runtime.scrollMode &&
    request.rendererTarget.kind === targetKind &&
    requestTarget === targetElement
  );
}

export {
  createMountLifecycleError,
  getActiveTrackerRuntimeContext,
  hasSameTrackerMountIdentity,
  isPageScrollerAlias,
  normalizeTrackerMountRequest,
};
export type { TrackerNormalizedMountRequest, TrackerRuntimeContext };
