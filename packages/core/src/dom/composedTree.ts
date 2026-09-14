import { isElement } from './element.js';

/**
 * Checks composed containment through ordinary parents and open shadow hosts.
 *
 * Traversal crosses a ShadowRoot boundary through its host only. Automatic
 * slot-assignment traversal is intentionally outside the supported profile.
 *
 * @param node - Candidate composed descendant.
 * @param root - Candidate composed ancestor.
 * @returns True when the node is the root or a supported composed descendant.
 */
function isInComposedSubtree(node: Node | null | undefined, root: Node | null | undefined): boolean {
  if (node == null || root == null) {
    return false;
  }

  let current: Node | null = node;

  while (current !== null) {
    if (current === root) {
      return true;
    }

    if (current.parentNode !== null) {
      current = current.parentNode;
      continue;
    }

    if (current.nodeType === 11 && isElement((current as ShadowRoot).host)) {
      current = (current as ShadowRoot).host;
      continue;
    }

    return false;
  }

  return false;
}

export { isInComposedSubtree };
