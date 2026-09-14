import { EVENT_NAME_VALUES } from '@rightxt/tracker-core';

import { reportHostError } from './reportHostError.js';

import type {
  TrackerEventName,
  TrackerEventPayloadMap,
  TrackerEventUnsubscribe,
  TrackerTypedEventHandler,
} from '@rightxt/tracker-core';

/** One unique public handler with independently owned registrations. */
interface PublicEventSubscriptionEntry<TEventName extends TrackerEventName = TrackerEventName> {
  /** Whether this entry remains current. */
  active: boolean;
  /** Public application handler. */
  handler: TrackerTypedEventHandler<TEventName>;
  /** Active registration owner count. */
  owners: number;
}

/** Vanilla-owned synchronous application notification dispatcher. */
class PublicEventDispatcher {
  readonly #listeners = new Map<
    TrackerEventName,
    Map<TrackerTypedEventHandler<TrackerEventName>, PublicEventSubscriptionEntry>
  >();

  /** Releases all application handlers at terminal destruction. */
  clear(): void {
    this.#listeners.clear();
  }

  /** Delivers one canonical payload without returning consumer failures to Core. */
  emit<TEventName extends TrackerEventName>(eventName: TEventName, payload: TrackerEventPayloadMap[TEventName]): void {
    const handlers = this.#listeners.get(eventName);

    if (!handlers) {
      return;
    }

    [...handlers.values()].forEach(({ handler }) => {
      try {
        handler(payload);
      } catch (error) {
        reportHostError(error);
      }
    });
  }

  /** Removes all active registrations for one event-name/handler pair. */
  off<TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ): boolean {
    this.#assertSubscription(eventName, handler);

    const handlers = this.#listeners.get(eventName);
    const untypedHandler = handler as TrackerTypedEventHandler<TrackerEventName>;
    const entry = handlers?.get(untypedHandler);

    if (!handlers || !entry) {
      return false;
    }

    entry.active = false;
    handlers.delete(untypedHandler);

    if (handlers.size === 0) {
      this.#listeners.delete(eventName);
    }

    return true;
  }

  /** Adds one independently owned public handler registration. */
  on<TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ): TrackerEventUnsubscribe {
    this.#assertSubscription(eventName, handler);

    let handlers = this.#listeners.get(eventName);

    if (!handlers) {
      handlers = new Map();
      this.#listeners.set(eventName, handlers);
    }

    const untypedHandler = handler as TrackerTypedEventHandler<TrackerEventName>;
    let entry = handlers.get(untypedHandler);

    if (!entry) {
      entry = { active: true, handler: untypedHandler, owners: 0 };
      handlers.set(untypedHandler, entry);
    }

    entry.owners += 1;
    const ownedEntry = entry;
    let ownerActive = true;

    return () => {
      if (!ownerActive) {
        return;
      }

      ownerActive = false;

      const currentHandlers = this.#listeners.get(eventName);

      if (!ownedEntry.active || currentHandlers?.get(untypedHandler) !== ownedEntry) {
        return;
      }

      ownedEntry.owners -= 1;

      if (ownedEntry.owners === 0) {
        ownedEntry.active = false;
        currentHandlers.delete(untypedHandler);

        if (currentHandlers.size === 0) {
          this.#listeners.delete(eventName);
        }
      }
    };
  }

  /** Validates the public event subscription boundary. */
  #assertSubscription<TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ): void {
    if (!EVENT_NAME_VALUES.includes(eventName)) {
      throw new TypeError(`Unknown Tracker event "${String(eventName)}".`);
    }

    if (typeof handler !== 'function') {
      throw new TypeError('Tracker event handler must be a function.');
    }
  }
}

export { PublicEventDispatcher };
