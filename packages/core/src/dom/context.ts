/**
 * Checks whether a value has the minimum shape of a DOM Document.
 *
 * This intentionally avoids global `instanceof Document` checks because a
 * document can belong to another same-origin DOM realm.
 *
 * @param value - Candidate document value.
 * @returns True when the value can be used as a Document.
 */
function isDocumentLike(value: unknown): value is Document {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  try {
    const candidate = value as { createElement?: unknown; nodeType?: unknown };

    return candidate.nodeType === 9 && typeof candidate.createElement === 'function';
  } catch {
    return false;
  }
}

/**
 * Returns the owner document for a DOM node-like value.
 *
 * Documents are returned directly because their `ownerDocument` is normally
 * null. Access is guarded so diagnostics and validation can safely inspect
 * unexpected values.
 *
 * @param value - Candidate DOM value.
 * @returns Owner document or null when it cannot be resolved.
 */
function getOwnerDocument(value: unknown): Document | null {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return null;
  }

  try {
    const ownerDocument = (value as { ownerDocument?: unknown }).ownerDocument;

    if (isDocumentLike(ownerDocument)) {
      return ownerDocument;
    }

    return isDocumentLike(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Returns the owning window for a DOM node-like value.
 *
 * @param value - Candidate DOM value.
 * @returns Owner window or null when the document has no usable default view.
 */
function getOwnerWindow(value: unknown): Window | null {
  const ownerDocument = getOwnerDocument(value);

  if (ownerDocument === null) {
    return null;
  }

  try {
    const ownerWindow = ownerDocument.defaultView;

    return ownerWindow !== null && typeof ownerWindow === 'object' ? (ownerWindow as Window) : null;
  } catch {
    return null;
  }
}

/**
 * Checks whether a DOM value belongs to the active runtime document.
 *
 * A missing document preserves standalone helper behavior. Runtime callers
 * pass the mounted realm's document so foreign-document elements cannot be
 * measured or activated as though they shared one coordinate space.
 *
 * @param value - Candidate DOM value.
 * @param activeDocument - Document of the mounted runtime realm.
 * @returns True when the value belongs to the active document.
 */
function isInActiveDocument(value: unknown, activeDocument: Document | null | undefined): boolean {
  return activeDocument == null || getOwnerDocument(value) === activeDocument;
}

export { getOwnerDocument, getOwnerWindow, isInActiveDocument };
