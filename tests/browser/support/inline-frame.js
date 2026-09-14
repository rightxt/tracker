/**
 * Loads same-origin markup in an iframe with a deterministic viewport.
 *
 * @param {string} markup - Complete frame markup.
 * @returns {Promise<HTMLIFrameElement>} Loaded frame.
 */
export function loadInlineFrame(markup) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');

    iframe.style.width = '400px';
    iframe.style.height = '300px';
    iframe.addEventListener('load', () => resolve(iframe), { once: true });
    iframe.addEventListener('error', () => reject(new Error('Failed to load the inline browser-test frame.')), {
      once: true,
    });
    iframe.srcdoc = markup;
    document.body.appendChild(iframe);
  });
}
