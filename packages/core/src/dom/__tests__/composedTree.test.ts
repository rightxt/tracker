// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { isInComposedSubtree } from '../composedTree.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('isInComposedSubtree', () => {
  it('accepts the root itself and light-tree descendants', () => {
    const root = document.createElement('div');
    const child = document.createElement('p');

    root.appendChild(child);
    document.body.appendChild(root);

    expect(isInComposedSubtree(root, root)).toBe(true);
    expect(isInComposedSubtree(child, root)).toBe(true);
    expect(isInComposedSubtree(child, document)).toBe(true);
  });

  it('crosses open shadow boundaries through the host', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const shadowChild = document.createElement('p');

    shadowRoot.appendChild(shadowChild);
    root.appendChild(host);
    document.body.appendChild(root);

    expect(isInComposedSubtree(shadowChild, root)).toBe(true);
    expect(isInComposedSubtree(shadowChild, shadowRoot)).toBe(true);
    expect(isInComposedSubtree(shadowChild, document)).toBe(true);
  });

  it('rejects nodes outside the root subtree and empty inputs', () => {
    const root = document.createElement('div');
    const sibling = document.createElement('p');

    document.body.append(root, sibling);

    expect(isInComposedSubtree(sibling, root)).toBe(false);
    expect(isInComposedSubtree(null, root)).toBe(false);
    expect(isInComposedSubtree(root, null)).toBe(false);
    expect(isInComposedSubtree(undefined, undefined)).toBe(false);
  });

  it('rejects nodes whose traversal ends at a detached ordinary fragment', () => {
    const fragment = document.createDocumentFragment();
    const child = document.createElement('p');

    fragment.appendChild(child);

    expect(isInComposedSubtree(child, document)).toBe(false);
    expect(isInComposedSubtree(child, fragment)).toBe(true);
  });
});
