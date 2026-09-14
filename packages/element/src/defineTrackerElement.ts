import { TrackerElement } from './TrackerElement.js';

/**
 * Registers the default RXT Tracker custom element when Custom Elements are available.
 *
 * @returns Registered constructor, or null outside a Custom Elements environment.
 * @throws Error when another constructor already owns the default tag name.
 */
function defineTrackerElement(): typeof TrackerElement | null {
  if (typeof customElements === 'undefined') {
    return null;
  }

  const existingConstructor = customElements.get('rxt-tracker');

  if (existingConstructor === undefined) {
    customElements.define('rxt-tracker', TrackerElement);
    return TrackerElement;
  }

  if (existingConstructor !== TrackerElement) {
    throw new Error('Cannot register rxt-tracker because another constructor already owns the tag name.');
  }

  return TrackerElement;
}

export { defineTrackerElement };
