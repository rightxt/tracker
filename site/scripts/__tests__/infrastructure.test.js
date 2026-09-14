import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT_CSS_VARIABLE_NAMES } from '../../../packages/core/src/config/cssVariables.ts';
import { THEME_VARIABLE_NAMES } from '../../tools/theme-builder/src/theme-metadata.js';
import { resolveOwnedPath } from '../paths.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..');

describe('site infrastructure helpers', () => {
  it('keeps resolved content inside its owning directory', () => {
    const owner = resolve(REPOSITORY_ROOT, 'site');

    expect(resolveOwnedPath(owner, 'shell', 'styles.css')).toBe(resolve(owner, 'shell', 'styles.css'));
    expect(() => resolveOwnedPath(owner, '..', 'package.json')).toThrow('escapes its owner directory');
  });

  it('keeps Theme Builder controls equal to the Core public root CSS-variable contract', () => {
    expect([...THEME_VARIABLE_NAMES].sort()).toEqual([...ROOT_CSS_VARIABLE_NAMES].sort());
  });
});
