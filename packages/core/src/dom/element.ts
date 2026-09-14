import { getClassTokens } from '../utils/className.js';
import { getOwnerWindow } from './context.js';

/** DOM constructor names used for realm-aware type checks. */
type DomConstructorName = 'Element' | 'HTMLElement' | 'Node';

/** Window properties required for realm-aware DOM type checks. */
type DomConstructorWindow = Window & {
  Element?: typeof Element;
  HTMLElement?: typeof HTMLElement;
  Node?: typeof Node;
};

/**
 * Returns a DOM constructor from an element's owner window.
 *
 * @param ownerWindow - Window associated with the candidate DOM value.
 * @param constructorName - Required DOM constructor name.
 * @returns DOM constructor or undefined when unavailable.
 */
function getOwnerDomConstructor(
  ownerWindow: DomConstructorWindow | null,
  constructorName: DomConstructorName,
): typeof Element | typeof HTMLElement | typeof Node | undefined {
  if (constructorName === 'Element') {
    return ownerWindow?.Element;
  }

  if (constructorName === 'HTMLElement') {
    return ownerWindow?.HTMLElement;
  }

  return ownerWindow?.Node;
}

/**
 * Checks a DOM value against the constructor from its owner window.
 *
 * @param value - Candidate DOM value.
 * @param constructorName - DOM constructor name.
 * @returns True when the value is an instance in its own DOM realm.
 */
function isInstanceOfOwnerConstructor(value: unknown, constructorName: DomConstructorName): boolean {
  const ownerWindow = getOwnerWindow(value) as DomConstructorWindow | null;
  const constructor = getOwnerDomConstructor(ownerWindow, constructorName);

  try {
    return typeof constructor === 'function' && value instanceof constructor;
  } catch {
    return false;
  }
}

/**
 * Adds a whitespace-separated class string to an element.
 *
 * Empty class names are ignored.
 *
 * @param element - Target element.
 * @param className - Class string.
 */
function addClassName(element: Element, className: string | null | undefined): void {
  if (!isElement(element)) {
    return;
  }

  const classNames = getClassTokens(className);

  if (classNames.length === 0) {
    return;
  }

  element.classList.add(...classNames);
}

/**
 * Checks whether a value is an Element.
 *
 * @param value - Value to check.
 * @returns True when value is an Element.
 */
function isElement(value: unknown): value is Element {
  return isInstanceOfOwnerConstructor(value, 'Element');
}

/**
 * Checks whether a value is an HTMLElement.
 *
 * @param value - Value to check.
 * @returns True when value is an HTMLElement.
 */
function isHTMLElement(value: unknown): value is HTMLElement {
  return isInstanceOfOwnerConstructor(value, 'HTMLElement');
}

/**
 * Checks whether a value is a Node.
 *
 * @param value - Value to check.
 * @returns True when value is a Node.
 */
function isNode(value: unknown): value is Node {
  return isInstanceOfOwnerConstructor(value, 'Node');
}

/**
 * Removes a whitespace-separated class string from an element.
 *
 * Empty class names are ignored.
 *
 * @param element - Target element.
 * @param className - Class string.
 */
function removeClassName(element: Element, className: string | null | undefined): void {
  if (!isElement(element)) {
    return;
  }

  const classNames = getClassTokens(className);

  if (classNames.length === 0) {
    return;
  }

  element.classList.remove(...classNames);
}

/**
 * Sets or removes an attribute on an element.
 *
 * Null and undefined remove the attribute. Other values are converted to string.
 *
 * @param element - Target element.
 * @param name - Attribute name.
 * @param value - Attribute value.
 */
function setAttribute(element: Element, name: string, value: unknown): void {
  if (!isElement(element) || typeof name !== 'string' || name === '') {
    return;
  }

  if (value == null) {
    element.removeAttribute(name);
    return;
  }

  element.setAttribute(name, String(value));
}

export { addClassName, isElement, isHTMLElement, isNode, removeClassName, setAttribute };
