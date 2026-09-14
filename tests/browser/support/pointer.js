/**
 * Dispatches a complete primary-pointer activation sequence (pointerdown,
 * pointerup, click) with a caller-supplied pointer identifier.
 *
 * @param {Element} target - Activation target.
 * @param {number} pointerId - Distinct pointer identifier.
 * @returns {void}
 */
export function dispatchPointerActivation(target, pointerId) {
  const shared = { bubbles: true, button: 0, cancelable: true, isPrimary: true, pointerId };

  target.dispatchEvent(new PointerEvent('pointerdown', { ...shared, buttons: 1 }));
  target.dispatchEvent(new PointerEvent('pointerup', { ...shared, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', shared));
}
