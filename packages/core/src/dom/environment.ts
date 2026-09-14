import type { TrackerSourceRoot } from '../types.js';
import { getOwnerDocument } from './context.js';
import { isElement } from './element.js';

/**
 * Checks whether document.createElement() is available.
 *
 * @param activeDocument - Document used for element creation checks.
 * @returns True when elements can be created.
 */
function canCreateElement(activeDocument: Document | null = getDocument()): boolean {
  const currentDocument = activeDocument;

  return currentDocument !== null && typeof currentDocument.createElement === 'function';
}

/**
 * Returns the current document object when available.
 *
 * @returns Current document or null.
 */
function getDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

/**
 * Returns the current window object when available.
 *
 * @returns Current window or null.
 */
function getWindow(): Window | null {
  return typeof window === 'undefined' ? null : window;
}

/**
 * Checks whether window event listeners are available.
 *
 * @param activeWindow - Window used for event listener checks.
 * @returns True when window.addEventListener() can be used.
 */
function hasWindowEvents(activeWindow: Window | null = getWindow()): boolean {
  const currentWindow = activeWindow;

  return currentWindow !== null && typeof currentWindow.addEventListener === 'function';
}

/**
 * Checks whether a value is a ShadowRoot without relying on an ambient realm constructor.
 *
 * @param value - Shadow-root candidate.
 * @returns True when the value has the platform ShadowRoot shape.
 */
function isShadowRoot(value: unknown): value is ShadowRoot {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { host?: unknown; mode?: unknown; nodeType?: unknown };

  return (
    candidate.nodeType === 11 && (candidate.mode === 'open' || candidate.mode === 'closed') && isElement(candidate.host)
  );
}

/**
 * Checks whether a value can be used as a selector query root.
 *
 * Intentionally checks querySelectorAll() only: query consumers call
 * querySelectorAll(), while selector syntax validation uses the separate
 * isSelectorValidationRoot() contract based on querySelector().
 *
 * @param value - Query root candidate.
 * @returns True when querySelectorAll() is available.
 */
function isSourceRoot(value: unknown): value is TrackerSourceRoot {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as Record<string, unknown>).querySelectorAll !== 'function'
  ) {
    return false;
  }

  if (isElement(value)) {
    return true;
  }

  const nodeType = (value as { nodeType?: unknown }).nodeType;

  if (nodeType === 9) {
    return getOwnerDocument(value) === value;
  }

  return isShadowRoot(value) && value.mode === 'open';
}

export { canCreateElement, getDocument, getWindow, hasWindowEvents, isShadowRoot, isSourceRoot };
