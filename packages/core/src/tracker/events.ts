import type { TrackerEventName, TrackerEventUnsubscribe, TrackerTypedEventHandler } from '../types.js';
import { EVENT_NAME_VALUES } from '../events/eventNames.js';
import { TrackerLifecycleError } from '../errors.js';
import type { TrackerInstance } from './createTrackerInstance.js';

/**
 * Returns true when the event name is part of the public event contract.
 *
 * @param eventName - Event name candidate.
 * @returns True when the event name is supported.
 */
function isSupportedTrackerEventName(eventName: unknown): eventName is TrackerEventName {
  return typeof eventName === 'string' && EVENT_NAME_VALUES.includes(eventName as TrackerEventName);
}

/**
 * Removes a Tracker event handler.
 *
 * @param instance - Internal instance context.
 * @param eventName - Event name.
 * @param handler - Event handler.
 */
function offTrackerInstanceEvent<TEventName extends TrackerEventName>(
  instance: TrackerInstance,
  eventName: TEventName,
  handler: TrackerTypedEventHandler<TEventName>,
): boolean {
  if (instance.destroyed) {
    return false;
  }

  if (!isSupportedTrackerEventName(eventName)) {
    throw new TypeError(`Unknown Tracker event "${String(eventName)}".`);
  }

  if (typeof handler !== 'function') {
    throw new TypeError('Tracker event handler must be a function.');
  }

  return instance.events.off(eventName, handler);
}

/**
 * Subscribes to a Tracker event.
 *
 * @param instance - Internal instance context.
 * @param eventName - Event name.
 * @param handler - Event handler.
 * @returns Unsubscribe function.
 */
function onTrackerInstanceEvent<TEventName extends TrackerEventName>(
  instance: TrackerInstance,
  eventName: TEventName,
  handler: TrackerTypedEventHandler<TEventName>,
): TrackerEventUnsubscribe {
  if (instance.destroyed) {
    throw new TrackerLifecycleError('Cannot subscribe to events on a destroyed Tracker.', {
      code: 'ERR_TRACKER_DESTROYED',
    });
  }

  if (!isSupportedTrackerEventName(eventName)) {
    throw new TypeError(`Unknown Tracker event "${String(eventName)}".`);
  }

  if (typeof handler !== 'function') {
    throw new TypeError('Tracker event handler must be a function.');
  }

  return instance.events.on(eventName, handler);
}

export { isSupportedTrackerEventName, offTrackerInstanceEvent, onTrackerInstanceEvent };
