// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { CSS_VARIABLES } from '@rightxt/tracker-core/renderer';
import type { TrackerReadonlyOptions } from '@rightxt/tracker-core/renderer';
import { StyleController } from '../StyleController.js';

/**
 * Builds committed options carrying only the root custom properties.
 *
 * applyRootVariables() reads the committed `cssVariables` branch alone, so the
 * remaining committed branches are omitted and cast once here.
 *
 * @param cssVariables - Committed root custom properties.
 * @returns Committed options accepted by the style controller.
 */
function createRootVariableOptions(cssVariables: Record<string, string>): TrackerReadonlyOptions {
  return { cssVariables } as unknown as TrackerReadonlyOptions;
}

describe('vanilla StyleController', () => {
  it('replaces the complete root CSS-variable snapshot and removes stale inline tokens', () => {
    const controller = new StyleController();
    const root = document.createElement('div');

    controller.applyRootVariables(
      root,
      createRootVariableOptions({
        [CSS_VARIABLES.TRACK_BG]: 'red',
      }),
    );

    expect(root.style.getPropertyValue(CSS_VARIABLES.TRACK_BG)).toBe('red');

    controller.applyRootVariables(root, createRootVariableOptions({}));

    expect(root.style.getPropertyValue(CSS_VARIABLES.TRACK_BG)).toBe('');
    expect(root.style.length).toBe(0);
  });
});
