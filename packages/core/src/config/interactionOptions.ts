import type { TrackerOptions } from '../types.js';

/**
 * Returns whether keyboard accessibility and selection are enabled.
 *
 * @param options - Normalized tracker options.
 * @returns Whether keyboard interaction and selection are active.
 */
function isKeyboardAccessibilityEnabled(options: TrackerOptions): boolean {
  return options.a11y?.enabled === true && options.a11y?.keyboard === true;
}

/**
 * Returns whether marker, cluster and track activation is enabled.
 *
 * @param options - Normalized tracker options.
 * @returns Whether activation is enabled. Defaults to `true` when unset.
 */
function isActivationEnabled(options: TrackerOptions): boolean {
  return options.interaction?.activation !== false;
}

export { isActivationEnabled, isKeyboardAccessibilityEnabled };
