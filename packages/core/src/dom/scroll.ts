import { getOwnerDocument, isInActiveDocument } from './context.js';
import { isElement, isHTMLElement } from './element.js';
import { isShadowRoot } from './environment.js';
import { getErrorMessage } from '../utils/diagnostic.js';
import type { TrackerDiagnosticCode } from '../types.js';

interface ScrollDiagnostics {
  /** Error reporter. */
  error?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
  /** Warning reporter. */
  warn?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
}

/**
 * Returns a resolved target only when it belongs to the active document.
 *
 * @param target - Candidate element target.
 * @param activeDocument - Document of the mounted runtime realm.
 * @param diagnostics - Diagnostics layer.
 * @returns Target element or null when unsupported.
 */
function getActiveDocumentTarget(
  target: unknown,
  activeDocument: Document | null,
  diagnostics: ScrollDiagnostics | null,
): Element | null {
  if (!isElement(target)) {
    return null;
  }

  if (!isInActiveDocument(target, activeDocument)) {
    diagnostics?.warn?.(
      'unsupported-cross-document-target',
      'Tracker ignored a scroll or focus target outside the active document.',
    );

    return null;
  }

  return target;
}

interface FocusElementOptions {
  /**
   * Whether an exceptional preventScroll failure may retry with plain focus.
   * Element mode disables the fallback because a plain focus could scroll an
   * element other than the single authoritative root.
   */
  allowPlainFocusFallback?: boolean;
  /** Diagnostics layer for exceptional preventScroll failures. */
  diagnostics?: ScrollDiagnostics | null;
}

/**
 * Focuses an HTMLElement without forcing an additional scroll jump when the
 * browser supports preventScroll.
 *
 * @param element - Focus target.
 * @param activeDocument - Document of the mounted runtime realm.
 * @param options - Fallback policy and diagnostics.
 */
function focusElement(
  element: HTMLElement,
  activeDocument: Document | null = null,
  options: FocusElementOptions = {},
): void {
  if (!isHTMLElement(element) || !isInActiveDocument(element, activeDocument) || typeof element.focus !== 'function') {
    return;
  }

  try {
    element.focus({
      preventScroll: true,
    });
  } catch (error) {
    options.diagnostics?.error?.(
      'focus-prevent-scroll-error',
      'HTMLElement.focus({ preventScroll: true }) failed unexpectedly.',
      { error: getErrorMessage(error) },
    );

    if (options.allowPlainFocusFallback !== false) {
      try {
        element.focus();
      } catch (fallbackError) {
        options.diagnostics?.error?.(
          'focus-fallback-error',
          'HTMLElement.focus() plain fallback failed unexpectedly.',
          { error: getErrorMessage(fallbackError) },
        );
      }
    }
  }
}

/**
 * Resolves a target element from a base element and target specification.
 *
 * String targets are resolved in this order:
 * 1. "self" returns the base element;
 * 2. descendant match via baseElement.querySelector();
 * 3. containing ShadowRoot match when the base belongs to one;
 * 4. document-level match via baseElement.ownerDocument.querySelector().
 *
 * @param baseElement - Source element.
 * @param targetSpec - Target specification.
 * @param diagnostics - Diagnostics layer.
 * @param activeDocument - Document of the mounted runtime realm.
 * @returns Resolved target element or null.
 */
function resolveElementTarget(
  baseElement: Element,
  targetSpec: unknown,
  diagnostics: ScrollDiagnostics | null = null,
  activeDocument: Document | null = null,
): Element | null {
  if (!isElement(baseElement)) {
    return null;
  }

  if (targetSpec === 'self' || targetSpec == null) {
    return getActiveDocumentTarget(baseElement, activeDocument, diagnostics);
  }

  if (typeof targetSpec === 'function') {
    try {
      const target = (targetSpec as (el: Element) => unknown)(baseElement);

      return getActiveDocumentTarget(target, activeDocument, diagnostics);
    } catch (error) {
      diagnostics?.error?.('target-resolver-error', 'Target resolver function failed.', {
        error: getErrorMessage(error),
      });

      return null;
    }
  }

  if (typeof targetSpec !== 'string' || targetSpec.trim() === '') {
    return null;
  }

  const selector = targetSpec.trim();

  try {
    const descendantTarget = baseElement.querySelector(selector);

    if (isElement(descendantTarget)) {
      return getActiveDocumentTarget(descendantTarget, activeDocument, diagnostics);
    }

    const treeRoot = baseElement.getRootNode();

    if (isShadowRoot(treeRoot)) {
      const shadowTarget = treeRoot.querySelector(selector);

      if (isElement(shadowTarget)) {
        return getActiveDocumentTarget(shadowTarget, activeDocument, diagnostics);
      }
    }

    const ownerDocument = getOwnerDocument(baseElement);

    if (ownerDocument !== null) {
      const documentTarget = ownerDocument.querySelector(selector);

      return getActiveDocumentTarget(documentTarget, activeDocument, diagnostics);
    }
  } catch (error) {
    diagnostics?.error?.('target-selector-error', `Target selector "${selector}" failed.`, {
      selector,
      error: getErrorMessage(error),
    });
  }

  return null;
}

/**
 * Resolves a focus target.
 *
 * @param baseElement - Source marker element.
 * @param targetSpec - Focus target specification.
 * @param diagnostics - Diagnostics layer.
 * @param activeDocument - Document of the mounted runtime realm.
 * @returns Focus target or null.
 */
function resolveFocusTarget(
  baseElement: Element,
  targetSpec: unknown,
  diagnostics: ScrollDiagnostics | null = null,
  activeDocument: Document | null = null,
): HTMLElement | null {
  const target = resolveElementTarget(baseElement, targetSpec, diagnostics, activeDocument);

  return isHTMLElement(target) ? target : null;
}

/**
 * Resolves a scroll target.
 *
 * @param baseElement - Source marker element.
 * @param targetSpec - Scroll target specification.
 * @param diagnostics - Diagnostics layer.
 * @param activeDocument - Document of the mounted runtime realm.
 * @returns Scroll target or null.
 */
function resolveScrollTarget(
  baseElement: Element,
  targetSpec: unknown,
  diagnostics: ScrollDiagnostics | null = null,
  activeDocument: Document | null = null,
): Element | null {
  return resolveElementTarget(baseElement, targetSpec, diagnostics, activeDocument);
}

export { focusElement, resolveElementTarget, resolveFocusTarget, resolveScrollTarget };
