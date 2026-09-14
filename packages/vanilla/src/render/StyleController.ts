import { CLASS_NAMES, DATA_ATTRIBUTES, resolveMarkerPresentation, toCssValue } from '@rightxt/tracker-core/renderer';
import type {
  TrackerMarkerDefaultsSnapshot,
  TrackerReadonlyOptions,
  TrackerRenderRecord,
} from '@rightxt/tracker-core/renderer';
import { getClassTokens, setNullableAttribute } from './domUtilities.js';

/**
 * State tracked for marker elements so user classes, attributes and CSS
 * variables can be removed on later updates.
 */
interface MarkerElementState {
  className: string;
  attributes: string[];
  cssVariables: string[];
}

/**
 * Applies a CSS custom property map to an element.
 *
 * @param element - Target element.
 * @param variables - CSS custom property map.
 * @returns Applied CSS custom property names.
 */
function applyCssVariableMap(element: HTMLElement, variables: Record<string, unknown>): string[] {
  return Object.entries(variables).reduce<string[]>((appliedNames, [name, value]) => {
    const cssValue = toCssValue(value);

    if (cssValue === null) {
      element.style.removeProperty(name);
      return appliedNames;
    }

    element.style.setProperty(name, cssValue);
    appliedNames.push(name);

    return appliedNames;
  }, []);
}

/**
 * Applies custom marker attributes that were already validated by rule
 * validation.
 *
 * @param markerElement - Marker DOM element.
 * @param attributes - Custom marker attributes.
 * @returns Applied attribute names.
 */
function applyCustomAttributes(markerElement: HTMLElement, attributes: Readonly<Record<string, string>>): string[] {
  return Object.entries(attributes).reduce<string[]>((appliedAttributes, [name, value]) => {
    setNullableAttribute(markerElement, name, value);
    appliedAttributes.push(name);

    return appliedAttributes;
  }, []);
}

/**
 * Removes previously applied custom marker state from a marker element.
 *
 * @param markerElement - Marker DOM element.
 * @param state - Previous marker state.
 */
function clearPreviousMarkerState(markerElement: HTMLElement, state: MarkerElementState): void {
  if (state.className) {
    markerElement.classList.remove(...getClassTokens(state.className));
  }

  state.attributes.forEach((attributeName) => {
    markerElement.removeAttribute(attributeName);
  });

  state.cssVariables.forEach((variableName) => {
    markerElement.style.removeProperty(variableName);
  });

  state.className = '';
  state.attributes = [];
  state.cssVariables = [];
}

/**
 * Returns the previous tracked state for a marker element.
 *
 * @param states - State map.
 * @param element - Marker element.
 * @returns Existing or new state.
 */
function getMarkerState(states: WeakMap<Element, MarkerElementState>, element: Element): MarkerElementState {
  const existingState = states.get(element);

  if (existingState) {
    return existingState;
  }

  const state: MarkerElementState = {
    className: '',
    attributes: [],
    cssVariables: [],
  };

  states.set(element, state);

  return state;
}

/**
 * Controls CSS custom properties and user-provided marker attributes.
 */
class StyleController {
  /** Tracked marker element state. */
  #markerStates: WeakMap<Element, MarkerElementState> = new WeakMap();

  /** Public root custom-property names applied during the preceding update. */
  #rootVariableNames: WeakMap<HTMLElement, string[]> = new WeakMap();

  /**
   * Applies classes, attributes, title and kind metadata to a marker element.
   *
   * Reserved attributes are filtered by validateRule(). Service attributes are
   * still applied after custom attributes to preserve the internal DOM contract.
   *
   * @param markerElement - Marker DOM element.
   * @param renderRecord - Marker or cluster render record.
   * @param markerOptions - Normalized global marker defaults.
   */
  applyMarkerAttributes(
    markerElement: HTMLElement,
    renderRecord: TrackerRenderRecord,
    markerOptions?: TrackerMarkerDefaultsSnapshot,
  ): void {
    this.applyMarkerPresentation(markerElement, renderRecord, markerOptions);

    setNullableAttribute(markerElement, DATA_ATTRIBUTES.KIND, renderRecord.kind);
    setNullableAttribute(markerElement, DATA_ATTRIBUTES.KEY, renderRecord.key);
    markerElement.removeAttribute(DATA_ATTRIBUTES.SELECTED);

    if (renderRecord.kind === 'cluster') {
      setNullableAttribute(markerElement, DATA_ATTRIBUTES.COUNT, renderRecord.count);
    } else {
      markerElement.removeAttribute(DATA_ATTRIBUTES.COUNT);
    }
  }

  /**
   * Reapplies complete application presentation while preserving service state.
   *
   * @param markerElement - Existing marker DOM element.
   * @param renderRecord - Marker or cluster render record.
   * @param markerOptions - Normalized global marker defaults.
   */
  applyMarkerPresentation(
    markerElement: HTMLElement,
    renderRecord: TrackerRenderRecord,
    markerOptions?: TrackerMarkerDefaultsSnapshot,
  ): void {
    const state = getMarkerState(this.#markerStates, markerElement);
    const presentation = resolveMarkerPresentation(markerOptions, renderRecord);

    clearPreviousMarkerState(markerElement, state);

    markerElement.className = CLASS_NAMES.MARKER;
    markerElement.classList.add(...getClassTokens(presentation.className));

    state.className = presentation.className;
    state.attributes = applyCustomAttributes(markerElement, presentation.attributes);
    state.cssVariables = applyCssVariableMap(markerElement, presentation.cssVariables);
    setNullableAttribute(markerElement, 'title', presentation.title);
  }

  /**
   * Applies root-level CSS custom properties.
   *
   * @param root - Tracker root element.
   * @param options - Current committed Tracker options.
   */
  applyRootVariables(root: HTMLElement, options: TrackerReadonlyOptions): void {
    this.clearRootVariables(root);

    this.#rootVariableNames.set(root, applyCssVariableMap(root, options.cssVariables));
  }

  /**
   * Clears tracked marker element metadata.
   *
   * This is useful when DomRenderer destroys all marker nodes.
   */
  clearMarkerStates(): void {
    this.#markerStates = new WeakMap();
  }

  /**
   * Clears root-level CSS custom properties set by this controller.
   *
   * @param root - Tracker root element.
   */
  clearRootVariables(root: HTMLElement): void {
    this.#rootVariableNames.get(root)?.forEach((variableName) => {
      root.style.removeProperty(variableName);
    });
    this.#rootVariableNames.delete(root);
  }
}

export { StyleController };
