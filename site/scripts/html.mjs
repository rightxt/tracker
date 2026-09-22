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

/**
 * Serializes attributes in deterministic lexicographic order with HTML escaping.
 *
 * @param {Record<string, string>} attributes Attribute names and decoded values.
 * @returns {string} Escaped attributes including their leading spaces.
 */
function serializeAttributes(attributes) {
  return Object.keys(attributes)
    .sort()
    .map((name) => ` ${name}="${escapeHtml(attributes[name])}"`)
    .join('');
}

export { escapeHtml, serializeAttributes };
