/**
 * Creates a test-owned element and connects it to the live document body.
 *
 * @param tagName - Element tag name.
 * @returns Connected element.
 */
function createConnectedElement(tagName = 'div'): HTMLElement {
  const element = document.createElement(tagName);

  document.body.appendChild(element);

  return element;
}

export { createConnectedElement };
