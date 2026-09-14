/**
 * Escapes text for HTML text and quoted attributes.
 *
 * @param {string} value Text to encode.
 * @returns {string} HTML-safe text.
 */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export { escapeHtml };
