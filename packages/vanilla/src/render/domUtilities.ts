/** Splits a class string with HTML ASCII-whitespace semantics. */
function getClassTokens(className: unknown): string[] {
  if (typeof className !== 'string') {
    return [];
  }

  return [...new Set(className.split(/[ \t\n\f\r]+/u).filter(Boolean))];
}

/** Checks an HTMLElement against the constructor from its owner realm. */
function isHtmlElement(value: unknown): value is HTMLElement {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  try {
    const constructor = (value as HTMLElement).ownerDocument?.defaultView?.HTMLElement;

    return typeof constructor === 'function' && value instanceof constructor;
  } catch {
    return false;
  }
}

/** Sets an attribute, or removes it for nullish values. */
function setNullableAttribute(element: Element, name: string, value: unknown): void {
  if (value === null || value === undefined) {
    element.removeAttribute(name);
    return;
  }

  element.setAttribute(name, String(value));
}

export { getClassTokens, isHtmlElement, setNullableAttribute };
