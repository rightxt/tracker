import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Resolves a child path and rejects traversal outside its owner directory.
 *
 * @param {string} owner Absolute owner directory.
 * @param {...string} segments Child path segments.
 * @returns {string} Validated absolute child path.
 */
function resolveOwnedPath(owner, ...segments) {
  const target = resolve(owner, ...segments);
  const relativeTarget = relative(owner, target);

  if (relativeTarget === '' || (!relativeTarget.startsWith('..') && !isAbsolute(relativeTarget))) {
    return target;
  }

  throw new Error(`Resolved path escapes its owner directory: ${target}`);
}

export { resolveOwnedPath };
