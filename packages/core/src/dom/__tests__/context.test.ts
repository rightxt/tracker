// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { getOwnerDocument, getOwnerWindow, isInActiveDocument } from '../context.js';
import { isElement, isHTMLElement, isNode } from '../element.js';

/**
 * Creates a same-origin iframe with its own DOM realm.
 *
 * @returns Frame element and its document.
 */
function createFrame(): { document: Document; iframe: HTMLIFrameElement } {
  const iframe = document.createElement('iframe');

  document.body.appendChild(iframe);

  if (iframe.contentDocument === null) {
    throw new Error('Expected iframe content document.');
  }

  return {
    document: iframe.contentDocument,
    iframe,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('core DOM context helpers', () => {
  it('recognizes DOM nodes from their owner realm', () => {
    const frame = createFrame();
    const childElement = frame.document.createElement('section');

    frame.document.body.appendChild(childElement);

    expect(childElement).not.toBeInstanceOf(HTMLElement);
    expect(isElement(childElement)).toBe(true);
    expect(isHTMLElement(childElement)).toBe(true);
    expect(isNode(childElement)).toBe(true);
    expect(isNode(frame.document)).toBe(true);
    expect(getOwnerDocument(childElement)).toBe(frame.document);
    expect(getOwnerDocument(frame.document)).toBe(frame.document);
    expect(getOwnerWindow(childElement)).toBe(frame.document.defaultView);

    frame.iframe.remove();
  });

  it('binds active-document checks to one runtime realm', () => {
    const frame = createFrame();
    const childTarget = frame.document.createElement('div');
    const parentTarget = document.createElement('div');

    frame.document.body.appendChild(childTarget);
    document.body.appendChild(parentTarget);

    expect(isInActiveDocument(childTarget, frame.document)).toBe(true);
    expect(isInActiveDocument(parentTarget, frame.document)).toBe(false);
    expect(isInActiveDocument(parentTarget, null)).toBe(true);

    frame.iframe.remove();
  });

  it('rejects hostile Proxy values without throwing during realm checks', () => {
    const hostileValue = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('hostile proxy');
        },
      },
    );

    expect(isElement(hostileValue)).toBe(false);
    expect(isHTMLElement(hostileValue)).toBe(false);
    expect(isNode(hostileValue)).toBe(false);
  });
});
