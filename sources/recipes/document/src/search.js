/**
 * Removes all search wrappers while preserving and normalizing their text.
 *
 * @param {HTMLElement} root Search scope.
 * @returns {number} Number of removed wrappers.
 */
function clearSearchHighlights(root) {
  const highlights = [...root.querySelectorAll('.report-search-hit')];
  const parents = new Set();
  for (const highlight of highlights) {
    if (highlight.parentNode !== null) {
      parents.add(highlight.parentNode);
    }
    highlight.replaceWith(...highlight.childNodes);
  }
  for (const parent of parents) {
    parent.normalize();
  }
  return highlights.length;
}

/**
 * Finds and wraps literal, case-insensitive text matches below one root.
 *
 * @param {HTMLElement} root Search scope.
 * @param {string} query Non-empty query already validated by the caller.
 * @param {number} maximumResults Maximum number of wrappers to create.
 * @returns {{ count: number, overflow: boolean }} Search result summary.
 */
function createSearchHighlights(root, query, maximumResults) {
  const normalizedQuery = query.toLocaleLowerCase('en-US');
  const groups = [];
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent !== null &&
        node.data.trim() !== '' &&
        parent.closest('script, style, noscript, textarea, .report-search-hit') === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const textNode = /** @type {Text} */ (node);
    const normalizedText = textNode.data.toLocaleLowerCase('en-US');
    const ranges = [];
    let offset = 0;
    while (offset < normalizedText.length) {
      const start = normalizedText.indexOf(normalizedQuery, offset);
      if (start === -1) {
        break;
      }
      ranges.push({ start, end: start + query.length });
      count += 1;
      if (count > maximumResults) {
        return { count, overflow: true };
      }
      offset = start + query.length;
    }
    if (ranges.length > 0) {
      groups.push({ node: textNode, ranges });
    }
  }

  for (const { node, ranges } of groups) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const { start, end } of ranges) {
      fragment.append(node.data.slice(cursor, start));
      const highlight = document.createElement('span');
      highlight.className = 'report-search-hit';
      highlight.dataset.searchQuery = query;
      highlight.textContent = node.data.slice(start, end);
      fragment.append(highlight);
      cursor = end;
    }
    fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }

  return { count, overflow: false };
}

export { clearSearchHighlights, createSearchHighlights };
