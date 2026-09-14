import { describe, expect, it } from 'vitest';

import {
  classifyContain,
  classifyContainerType,
  classifyContentVisibility,
  classifyDisplay,
  consumeWindowFallbackWarning,
  createWindowFallbackDedupState,
  resolveWindowNativeAlignment,
  resolveWindowPrincipalFlowFromStyles,
  updateWindowFallbackDedupState,
} from '../windowPrincipalFlow.js';

import type { WindowPrincipalFlowStyle } from '../windowPrincipalFlow.js';
import type { TrackerOrientation } from '../../types.js';

/** Exact native-alignment cases from the bounded mapping table. */
const NATIVE_ALIGNMENT_CASES: Array<[string, string, TrackerOrientation, 'block' | 'inline', ScrollLogicalPosition]> = [
  ['horizontal-tb', 'ltr', 'horizontal', 'inline', 'start'],
  ['horizontal-tb', 'rtl', 'horizontal', 'inline', 'end'],
  ['horizontal-tb', 'ltr', 'vertical', 'block', 'start'],
  ['vertical-rl', 'ltr', 'horizontal', 'block', 'end'],
  ['vertical-rl', 'rtl', 'vertical', 'inline', 'end'],
  ['vertical-lr', 'ltr', 'horizontal', 'block', 'start'],
  ['vertical-lr', 'rtl', 'vertical', 'inline', 'end'],
];

/**
 * Creates one complete computed-style profile.
 *
 * @param overrides - Field overrides.
 * @returns Complete style profile.
 */
function createStyle(overrides: Partial<WindowPrincipalFlowStyle> = {}): WindowPrincipalFlowStyle {
  return {
    display: 'block',
    writingMode: 'horizontal-tb',
    direction: 'ltr',
    textOrientation: 'mixed',
    contain: 'none',
    contentVisibility: 'visible',
    containerType: 'normal',
    ...overrides,
  };
}

describe('bounded Window principal-flow resolution', () => {
  it.each([
    'block',
    'flow-root',
    'inline-block',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'block flow',
    'block flow-root',
    'inline flow-root',
    'block flex',
    'inline flex',
    'block grid',
    'inline grid',
  ])('accepts exact display %s', (display) => {
    expect(classifyDisplay(display)).toBe('exact');
  });

  it.each([
    'inline',
    'run-in',
    'list-item',
    'table',
    'inline-table',
    'table-row',
    'ruby',
    'ruby-base',
    'contents',
    'future-layout',
    '',
  ])('fails closed for display %s', (display) => {
    expect(classifyDisplay(display)).toBe('unclassified');
  });

  it('classifies only the finite containment grammars', () => {
    expect(classifyContain('none')).toBe('none');
    expect(classifyContain('layout paint')).toBe('active');
    expect(classifyContain('inline-size layout style paint')).toBe('active');
    expect(classifyContain('size inline-size')).toBe('unresolved');
    expect(classifyContain('strict')).toBe('unresolved');
    expect(classifyContentVisibility('visible')).toBe('none');
    expect(classifyContentVisibility('auto')).toBe('active');
    expect(classifyContentVisibility('hidden')).toBe('active');
    expect(classifyContentVisibility('future')).toBe('unresolved');
    expect(classifyContainerType('normal')).toBe('none');
    expect(classifyContainerType('scroll-state')).toBe('none');
    expect(classifyContainerType('inline-size scroll-state')).toBe('active');
    expect(classifyContainerType('size inline-size')).toBe('unresolved');
    expect(classifyContainerType('future')).toBe('unresolved');
  });

  it('selects root for no body, hidden body, or known active containment', () => {
    expect(resolveWindowPrincipalFlowFromStyles({ root: createStyle(), bodies: [] })).toMatchObject({
      exact: true,
      source: 'root',
    });
    expect(
      resolveWindowPrincipalFlowFromStyles({ root: createStyle(), bodies: [createStyle({ display: 'none' })] }),
    ).toMatchObject({ exact: true, source: 'root' });
    expect(
      resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ contain: 'layout', direction: 'rtl' }),
        bodies: [createStyle({ direction: 'ltr', contain: 'future' })],
      }),
    ).toMatchObject({ exact: true, source: 'root', direction: 'rtl' });
  });

  it('selects one supported non-contained body as the joint flow source', () => {
    const resolution = resolveWindowPrincipalFlowFromStyles({
      root: createStyle({ direction: 'ltr' }),
      bodies: [createStyle({ direction: 'rtl', display: 'inline-block' })],
    });

    expect(resolution).toMatchObject({
      exact: true,
      source: 'body',
      writingMode: 'horizontal-tb',
      direction: 'rtl',
      reason: null,
    });
  });

  it('uses the finite fallback-reason precedence', () => {
    expect(
      resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ display: 'contents', writingMode: 'sideways-rl', direction: 'future' }),
        bodies: [createStyle(), createStyle()],
      }).reason,
    ).toBe('unclassified-display-profile');
    expect(
      resolveWindowPrincipalFlowFromStyles({ root: createStyle(), bodies: [createStyle(), createStyle()] }).reason,
    ).toBe('ambiguous-body-source');
    expect(
      resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ contain: 'future', writingMode: 'sideways-rl' }),
        bodies: [createStyle()],
      }).reason,
    ).toBe('unclassified-containment-profile');
    expect(
      resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ writingMode: 'sideways-rl', direction: 'future' }),
        bodies: [],
      }).reason,
    ).toBe('unsupported-writing-mode');
    expect(
      resolveWindowPrincipalFlowFromStyles({ root: createStyle({ direction: 'future' }), bodies: [] }).reason,
    ).toBe('invalid-direction');
  });

  it('handles vertical text orientation without modeling text layout', () => {
    expect(
      resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ writingMode: 'vertical-rl', textOrientation: 'sideways' }),
        bodies: [],
      }).exact,
    ).toBe(true);
    expect(
      resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ writingMode: 'vertical-rl', textOrientation: 'upright' }),
        bodies: [],
      }).reason,
    ).toBe('vertical-upright-text-orientation');
    expect(
      resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ writingMode: 'vertical-lr', textOrientation: 'mixed' }),
        bodies: [createStyle({ writingMode: 'vertical-lr', textOrientation: 'upright' })],
      }).reason,
    ).toBe('ambiguous-vertical-text-orientation');
    expect(
      resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ writingMode: 'vertical-lr', textOrientation: 'future' }),
        bodies: [],
      }).reason,
    ).toBe('invalid-text-orientation');
  });

  it.each(NATIVE_ALIGNMENT_CASES)(
    'maps %s/%s %s start to native %s/%s',
    (writingMode, direction, orientation, axis, expectedAlign) => {
      const resolution = resolveWindowPrincipalFlowFromStyles({
        root: createStyle({ writingMode, direction }),
        bodies: [],
      });
      const alignment = resolveWindowNativeAlignment(resolution, orientation, 'start');

      expect(alignment.exact).toBe(true);
      expect(alignment[axis]).toBe(expectedAlign);
      expect(alignment[axis === 'block' ? 'inline' : 'block']).toBe('nearest');
    },
  );

  it('retains the exact fallback descriptor for unclassified body flow', () => {
    const resolution = resolveWindowPrincipalFlowFromStyles({
      root: createStyle({ display: 'contents' }),
      bodies: [],
    });

    expect(resolveWindowNativeAlignment(resolution, 'horizontal', 'end')).toMatchObject({
      block: 'end',
      inline: 'nearest',
      exact: false,
      reason: 'unclassified-display-profile',
    });
  });

  it('deduplicates only the continuously active unresolved profile', () => {
    const state = createWindowFallbackDedupState();
    const firstFallback = resolveWindowPrincipalFlowFromStyles({
      root: createStyle({ display: 'contents' }),
      bodies: [],
    });
    const secondFallback = resolveWindowPrincipalFlowFromStyles({
      root: createStyle({ display: 'table' }),
      bodies: [],
    });
    const exact = resolveWindowPrincipalFlowFromStyles({ root: createStyle(), bodies: [] });

    updateWindowFallbackDedupState(state, firstFallback);
    expect(consumeWindowFallbackWarning(state)).toBe(true);
    expect(consumeWindowFallbackWarning(state)).toBe(false);

    updateWindowFallbackDedupState(state, secondFallback);
    expect(consumeWindowFallbackWarning(state)).toBe(true);

    updateWindowFallbackDedupState(state, exact);
    expect(consumeWindowFallbackWarning(state)).toBe(false);

    updateWindowFallbackDedupState(state, firstFallback);
    expect(consumeWindowFallbackWarning(state)).toBe(true);
  });
});
