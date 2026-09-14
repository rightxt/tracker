/**
 * Removes annotation wrappers selected by a scoped selector.
 *
 * @param {HTMLElement} root Annotation scope.
 * @param {string} selector Selector for annotation wrappers to remove.
 * @returns {number} Number of removed wrappers.
 */
function clearAnnotationHighlights(root, selector = '.report-annotation') {
  const annotations = [...root.querySelectorAll(selector)];
  const parents = new Set();
  for (const annotation of annotations) {
    if (annotation.parentNode !== null) {
      parents.add(annotation.parentNode);
    }
    annotation.replaceWith(...annotation.childNodes);
  }
  for (const parent of parents) {
    parent.normalize();
  }
  return annotations.length;
}

/**
 * Wraps every selected text-node segment in one annotation group.
 *
 * Search wrappers should be removed before calling this function so the saved
 * range refers to stable report text nodes.
 *
 * @param {HTMLElement} root Annotation scope.
 * @param {Range | null} range Selected report range.
 * @param {string} annotationId Group identifier assigned by the application.
 * @returns {number} Number of annotation spans created.
 */
function createAnnotationHighlights(root, range, annotationId) {
  if (range === null) {
    return 0;
  }
  if ([...root.querySelectorAll('.report-annotation')].some((annotation) => range.intersectsNode(annotation))) {
    return 0;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const textNode = /** @type {Text} */ (node);
    if (!range.intersectsNode(textNode) || textNode.parentElement?.closest('.report-annotation') !== null) {
      continue;
    }
    const start = textNode === range.startContainer ? range.startOffset : 0;
    const end = textNode === range.endContainer ? range.endOffset : textNode.length;
    if (start < end && textNode.data.slice(start, end).trim() !== '') {
      segments.push({ end, node: textNode, start });
    }
  }

  for (const { end, node, start } of segments.reverse()) {
    const annotationRange = document.createRange();
    annotationRange.setStart(node, start);
    annotationRange.setEnd(node, end);
    const annotation = document.createElement('span');
    annotation.className = 'report-annotation';
    annotation.dataset.annotationId = annotationId;
    annotationRange.surroundContents(annotation);
  }
  return segments.length;
}

/**
 * Returns a cloned, non-empty browser selection contained by one root.
 *
 * @param {HTMLElement} root Required selection owner.
 * @returns {Range | null} Usable selection range.
 */
function getContainedSelectionRange(root) {
  const selection = getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startOwner =
    range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const endOwner =
    range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  return startOwner instanceof Node &&
    endOwner instanceof Node &&
    root.contains(startOwner) &&
    root.contains(endOwner) &&
    range.toString().trim() !== ''
    ? range.cloneRange()
    : null;
}

export { clearAnnotationHighlights, createAnnotationHighlights, getContainedSelectionRange };
