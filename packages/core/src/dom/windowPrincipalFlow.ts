import { getOwnerWindow } from './context.js';

import type { TrackerOrientation } from '../types.js';

/** Stable fallback reason retained for the Phase-4 diagnostic bridge. */
type WindowPrincipalFlowFallbackReason =
  | 'unsupported-writing-mode'
  | 'invalid-direction'
  | 'ambiguous-body-source'
  | 'unclassified-display-profile'
  | 'unclassified-containment-profile'
  | 'vertical-upright-text-orientation'
  | 'ambiguous-vertical-text-orientation'
  | 'invalid-text-orientation';

/** Selected principal-flow source. */
type WindowPrincipalFlowSource = 'root' | 'body';

/** Finite style fields read by the Window principal-flow resolver. */
interface WindowPrincipalFlowStyle {
  /** Computed display serialization. */
  display: string;
  /** Computed writing mode. */
  writingMode: string;
  /** Computed direction. */
  direction: string;
  /** Computed text orientation. */
  textOrientation: string;
  /** Computed contain serialization. */
  contain: string;
  /** Computed content-visibility serialization. */
  contentVisibility: string;
  /** Computed container-type serialization. */
  containerType: string;
}

/** Pure resolver input used by browser-independent conformance tests. */
interface WindowPrincipalFlowInput {
  /** Viewport style-root profile. */
  root: WindowPrincipalFlowStyle;
  /** Direct HTML body candidates only. */
  bodies: WindowPrincipalFlowStyle[];
}

/** Bounded Window principal-flow resolution. */
interface WindowPrincipalFlowResolution {
  /** Whether exact physical-axis mapping is available. */
  exact: boolean;
  /** Joint flow source when selection succeeded. */
  source: WindowPrincipalFlowSource | null;
  /** Selected or diagnostic root writing mode. */
  writingMode: string;
  /** Selected or diagnostic root direction. */
  direction: string;
  /** Stable fallback reason. */
  reason: WindowPrincipalFlowFallbackReason | null;
  /** Private finite key used only by deduplication state. */
  profileKey: string;
}

/** Native scrollIntoView alignment for one physical Tracker orientation. */
interface WindowNativeAlignment {
  /** Native block-axis alignment. */
  block: ScrollLogicalPosition;
  /** Native inline-axis alignment. */
  inline: ScrollLogicalPosition;
  /** Whether the bounded exact mapping was used. */
  exact: boolean;
  /** Fallback reason when exact mapping is unavailable. */
  reason: WindowPrincipalFlowFallbackReason | null;
  /** Current private profile key. */
  profileKey: string;
}

/** Finite warning-deduplication state with no profile history. */
interface WindowFallbackDedupState {
  /** Current unresolved profile key, or null for an exact profile. */
  currentProfileKey: string | null;
  /** Current unresolved key already consumed by an activation. */
  warnedProfileKey: string | null;
}

/** Finite exact display serializations. */
const EXACT_DISPLAYS = new Set([
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
]);

/** Supported exact writing modes. */
const EXACT_WRITING_MODES = new Set(['horizontal-tb', 'vertical-rl', 'vertical-lr']);

/** Recognized non-upright text orientations for vertical exact mapping. */
const EXACT_VERTICAL_TEXT_ORIENTATIONS = new Set(['mixed', 'sideways']);

/**
 * Normalizes one finite computed CSS serialization.
 *
 * @param value - Computed value.
 * @returns ASCII-lowercase value with collapsed whitespace.
 */
function normalizeComputedValue(value: string): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/gu, ' ') : '';
}

/**
 * Classifies a computed display against the exact finite profile.
 *
 * @param display - Computed display.
 * @returns Exact, hidden, or unclassified state.
 */
function classifyDisplay(display: string): 'exact' | 'hidden' | 'unclassified' {
  const normalizedDisplay = normalizeComputedValue(display);

  if (normalizedDisplay === 'none') {
    return 'hidden';
  }

  return EXACT_DISPLAYS.has(normalizedDisplay) ? 'exact' : 'unclassified';
}

/**
 * Returns unique normalized tokens or null for duplicates/empty input.
 *
 * @param value - Computed token list.
 * @returns Unique tokens or null.
 */
function parseUniqueTokens(value: string): string[] | null {
  const normalizedValue = normalizeComputedValue(value);

  if (normalizedValue === '') {
    return null;
  }

  const tokens = normalizedValue.split(' ');

  return new Set(tokens).size === tokens.length ? tokens : null;
}

/**
 * Classifies computed contain through the frozen finite grammar.
 *
 * @param value - Computed contain value.
 * @returns Containment state.
 */
function classifyContain(value: string): 'active' | 'none' | 'unresolved' {
  const normalizedValue = normalizeComputedValue(value);

  if (normalizedValue === 'none') {
    return 'none';
  }

  const tokens = parseUniqueTokens(normalizedValue);
  const allowedTokens = new Set(['size', 'inline-size', 'layout', 'style', 'paint']);

  if (
    tokens === null ||
    tokens.some((token) => !allowedTokens.has(token)) ||
    (tokens.includes('size') && tokens.includes('inline-size'))
  ) {
    return 'unresolved';
  }

  return 'active';
}

/**
 * Classifies computed content-visibility.
 *
 * @param value - Computed content-visibility value.
 * @returns Containment state.
 */
function classifyContentVisibility(value: string): 'active' | 'none' | 'unresolved' {
  const normalizedValue = normalizeComputedValue(value);

  if (normalizedValue === 'visible') {
    return 'none';
  }

  if (normalizedValue === 'auto' || normalizedValue === 'hidden') {
    return 'active';
  }

  return 'unresolved';
}

/**
 * Classifies computed container-type through the frozen finite grammar.
 *
 * @param value - Computed container-type value.
 * @returns Containment state.
 */
function classifyContainerType(value: string): 'active' | 'none' | 'unresolved' {
  const normalizedValue = normalizeComputedValue(value);

  if (normalizedValue === 'normal') {
    return 'none';
  }

  const tokens = parseUniqueTokens(normalizedValue);
  const allowedTokens = new Set(['size', 'inline-size', 'scroll-state']);

  if (
    tokens === null ||
    tokens.some((token) => !allowedTokens.has(token)) ||
    (tokens.includes('size') && tokens.includes('inline-size'))
  ) {
    return 'unresolved';
  }

  return tokens.includes('size') || tokens.includes('inline-size') ? 'active' : 'none';
}

/**
 * Classifies all bounded containment inputs for one element.
 *
 * @param style - Computed style profile.
 * @returns Combined containment state.
 */
function classifyContainmentProfile(style: WindowPrincipalFlowStyle): 'active' | 'none' | 'unresolved' {
  const states = [
    classifyContain(style.contain),
    classifyContentVisibility(style.contentVisibility),
    classifyContainerType(style.containerType),
  ];

  if (states.includes('active')) {
    return 'active';
  }

  return states.includes('unresolved') ? 'unresolved' : 'none';
}

/**
 * Creates the private bounded profile key.
 *
 * @param input - Pure resolver input.
 * @param source - Selected source.
 * @param reason - Fallback reason.
 * @returns Private profile key.
 */
function createProfileKey(
  input: WindowPrincipalFlowInput,
  source: WindowPrincipalFlowSource | null,
  reason: WindowPrincipalFlowFallbackReason | null,
): string {
  return JSON.stringify({
    root: input.root,
    bodies: input.bodies,
    source,
    reason,
  });
}

/**
 * Creates one resolver result.
 *
 * @param input - Pure resolver input.
 * @param source - Selected source.
 * @param reason - Fallback reason.
 * @returns Principal-flow resolution.
 */
function createResolution(
  input: WindowPrincipalFlowInput,
  source: WindowPrincipalFlowSource | null,
  reason: WindowPrincipalFlowFallbackReason | null,
): WindowPrincipalFlowResolution {
  const selectedStyle = source === 'body' ? input.bodies[0] : input.root;

  return {
    exact: reason === null,
    source,
    writingMode: normalizeComputedValue(selectedStyle?.writingMode ?? input.root.writingMode),
    direction: normalizeComputedValue(selectedStyle?.direction ?? input.root.direction),
    reason,
    profileKey: createProfileKey(input, source, reason),
  };
}

/**
 * Resolves one bounded Window principal-flow profile from computed values.
 *
 * @param input - Root plus direct HTML body style profiles.
 * @returns Exact joint flow or a fail-closed fallback descriptor.
 */
function resolveWindowPrincipalFlowFromStyles(input: WindowPrincipalFlowInput): WindowPrincipalFlowResolution {
  if (classifyDisplay(input.root.display) !== 'exact') {
    return createResolution(input, null, 'unclassified-display-profile');
  }

  let source: WindowPrincipalFlowSource;
  let bodyPropagationApplies = false;

  if (input.bodies.length === 0) {
    source = 'root';
  } else if (input.bodies.length > 1) {
    return createResolution(input, null, 'ambiguous-body-source');
  } else {
    const body = input.bodies[0];
    const bodyDisplay = classifyDisplay(body.display);

    if (bodyDisplay === 'hidden') {
      source = 'root';
    } else if (bodyDisplay !== 'exact') {
      return createResolution(input, null, 'unclassified-display-profile');
    } else {
      const rootContainment = classifyContainmentProfile(input.root);
      const bodyContainment = classifyContainmentProfile(body);

      if (rootContainment === 'active' || bodyContainment === 'active') {
        source = 'root';
      } else if (rootContainment === 'none' && bodyContainment === 'none') {
        source = 'body';
        bodyPropagationApplies = true;
      } else {
        return createResolution(input, null, 'unclassified-containment-profile');
      }
    }
  }

  const selectedStyle = source === 'body' ? input.bodies[0] : input.root;
  const writingMode = normalizeComputedValue(selectedStyle.writingMode);
  const direction = normalizeComputedValue(selectedStyle.direction);

  if (!EXACT_WRITING_MODES.has(writingMode)) {
    return createResolution(input, source, 'unsupported-writing-mode');
  }

  if (direction !== 'ltr' && direction !== 'rtl') {
    return createResolution(input, source, 'invalid-direction');
  }

  if (writingMode !== 'horizontal-tb') {
    const textOrientations = bodyPropagationApplies
      ? [input.root.textOrientation, input.bodies[0].textOrientation]
      : [input.root.textOrientation];
    const normalizedOrientations = textOrientations.map(normalizeComputedValue);

    if (
      normalizedOrientations.some(
        (textOrientation) => !EXACT_VERTICAL_TEXT_ORIENTATIONS.has(textOrientation) && textOrientation !== 'upright',
      )
    ) {
      return createResolution(input, source, 'invalid-text-orientation');
    }

    const uprightCount = normalizedOrientations.filter((textOrientation) => textOrientation === 'upright').length;

    if (uprightCount > 0 && uprightCount < normalizedOrientations.length) {
      return createResolution(input, source, 'ambiguous-vertical-text-orientation');
    }

    if (uprightCount === normalizedOrientations.length) {
      return createResolution(input, source, 'vertical-upright-text-orientation');
    }
  }

  return createResolution(input, source, null);
}

/**
 * Reads only the finite computed fields used by the resolver.
 *
 * @param element - Root or direct body element.
 * @returns Computed style profile.
 */
function readPrincipalFlowStyle(element: Element): WindowPrincipalFlowStyle {
  const window = getOwnerWindow(element);

  if (window === null || typeof window.getComputedStyle !== 'function') {
    return {
      display: '',
      writingMode: '',
      direction: '',
      textOrientation: '',
      contain: '',
      contentVisibility: '',
      containerType: '',
    };
  }

  let style: CSSStyleDeclaration;

  try {
    style = window.getComputedStyle(element);
  } catch {
    return {
      display: '',
      writingMode: '',
      direction: '',
      textOrientation: '',
      contain: '',
      contentVisibility: '',
      containerType: '',
    };
  }

  return {
    display: style.display,
    writingMode: style.writingMode,
    direction: style.direction,
    textOrientation: style.textOrientation,
    contain: style.contain,
    contentVisibility: style.getPropertyValue('content-visibility'),
    containerType: style.getPropertyValue('container-type'),
  };
}

/**
 * Resolves a bounded Window principal-flow profile from a live document.
 *
 * @param document - Active Window document.
 * @returns Exact joint flow or fallback descriptor.
 */
function resolveWindowPrincipalFlow(document: Document): WindowPrincipalFlowResolution {
  const root = document.documentElement;

  if (!root) {
    const emptyStyle: WindowPrincipalFlowStyle = {
      display: '',
      writingMode: '',
      direction: '',
      textOrientation: '',
      contain: '',
      contentVisibility: '',
      containerType: '',
    };

    return resolveWindowPrincipalFlowFromStyles({ root: emptyStyle, bodies: [] });
  }

  const bodies = Array.from(root.children).filter(
    (element) => element.namespaceURI === 'http://www.w3.org/1999/xhtml' && element.localName === 'body',
  );

  return resolveWindowPrincipalFlowFromStyles({
    root: readPrincipalFlowStyle(root),
    bodies: bodies.map(readPrincipalFlowStyle),
  });
}

/**
 * Swaps physical start/end when the logical axis is reversed.
 *
 * @param align - Physical alignment.
 * @param reverse - Whether physical and logical edges are reversed.
 * @returns Native logical alignment.
 */
function mapEdgeAlignment(align: ScrollLogicalPosition, reverse: boolean): ScrollLogicalPosition {
  if (!reverse || (align !== 'start' && align !== 'end')) {
    return align;
  }

  return align === 'start' ? 'end' : 'start';
}

/**
 * Maps physical Tracker alignment to native Window block/inline alignment.
 *
 * @param resolution - Current bounded principal-flow resolution.
 * @param orientation - Tracker orientation.
 * @param align - Physical alignment.
 * @returns Native alignment or the exact legacy fallback descriptor.
 */
function resolveWindowNativeAlignment(
  resolution: WindowPrincipalFlowResolution,
  orientation: TrackerOrientation,
  align: ScrollLogicalPosition,
): WindowNativeAlignment {
  if (!resolution.exact) {
    return {
      block: align,
      inline: 'nearest',
      exact: false,
      reason: resolution.reason,
      profileKey: resolution.profileKey,
    };
  }

  const horizontal = orientation === 'horizontal';
  const { writingMode, direction } = resolution;
  let nativeAxis: 'block' | 'inline';
  let reverse = false;

  if (writingMode === 'horizontal-tb') {
    nativeAxis = horizontal ? 'inline' : 'block';
    reverse = horizontal && direction === 'rtl';
  } else if (writingMode === 'vertical-rl') {
    nativeAxis = horizontal ? 'block' : 'inline';
    reverse = horizontal || (!horizontal && direction === 'rtl');
  } else {
    nativeAxis = horizontal ? 'block' : 'inline';
    reverse = !horizontal && direction === 'rtl';
  }

  const nativeAlign = mapEdgeAlignment(align, reverse);

  return {
    block: nativeAxis === 'block' ? nativeAlign : 'nearest',
    inline: nativeAxis === 'inline' ? nativeAlign : 'nearest',
    exact: true,
    reason: null,
    profileKey: resolution.profileKey,
  };
}

/**
 * Creates empty finite fallback-deduplication state.
 *
 * @returns Empty deduplication state.
 */
function createWindowFallbackDedupState(): WindowFallbackDedupState {
  return {
    currentProfileKey: null,
    warnedProfileKey: null,
  };
}

/**
 * Reevaluates finite fallback state without emitting a diagnostic.
 *
 * @param state - Mutable deduplication state.
 * @param resolution - Current flow resolution.
 */
function updateWindowFallbackDedupState(
  state: WindowFallbackDedupState,
  resolution: WindowPrincipalFlowResolution,
): void {
  const nextProfileKey = resolution.exact ? null : resolution.profileKey;

  if (nextProfileKey !== state.currentProfileKey) {
    state.currentProfileKey = nextProfileKey;
    state.warnedProfileKey = null;
  }
}

/**
 * Consumes the one warning opportunity for the current unresolved profile.
 *
 * Phase 1 tests this state transition but does not call the public warning
 * channel. Phase 4 owns diagnostic publication.
 *
 * @param state - Mutable deduplication state.
 * @returns True exactly once per continuously active unresolved profile.
 */
function consumeWindowFallbackWarning(state: WindowFallbackDedupState): boolean {
  if (state.currentProfileKey === null || state.warnedProfileKey === state.currentProfileKey) {
    return false;
  }

  state.warnedProfileKey = state.currentProfileKey;

  return true;
}

export {
  classifyContain,
  classifyContainerType,
  classifyContainmentProfile,
  classifyContentVisibility,
  classifyDisplay,
  consumeWindowFallbackWarning,
  createWindowFallbackDedupState,
  readPrincipalFlowStyle,
  resolveWindowNativeAlignment,
  resolveWindowPrincipalFlow,
  resolveWindowPrincipalFlowFromStyles,
  updateWindowFallbackDedupState,
};
export type {
  WindowFallbackDedupState,
  WindowNativeAlignment,
  WindowPrincipalFlowFallbackReason,
  WindowPrincipalFlowInput,
  WindowPrincipalFlowResolution,
  WindowPrincipalFlowSource,
  WindowPrincipalFlowStyle,
};
