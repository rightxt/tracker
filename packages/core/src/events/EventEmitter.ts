import { noop } from '../utils/function.js';
import { toError } from '../utils/diagnostic.js';
import { freezeTrackerEventPayload } from './eventPayload.js';
import type {
  TrackerEventHandler,
  TrackerEventName,
  TrackerEventPayload,
  TrackerEventPayloadMap,
  TrackerEventUnsubscribe,
  TrackerTypedEventHandler,
} from '../types.js';

interface EventEmitterOptions {
  /** Optional list of supported event names. */
  eventNames?: Iterable<TrackerEventName>;
  /** Handler error callback. */
  onHandlerError?: (error: Error, details: { eventName: TrackerEventName; payload: TrackerEventPayload }) => void;
  /** Public subscriber dispatch boundary. */
  runPublicDispatch?: (dispatch: () => void) => void;
}

/** One unique handler with independently owned registrations. */
interface EventSubscriptionEntry {
  /** Registered handler. */
  handler: TrackerEventHandler;
  /** Number of active subscription owners. */
  owners: number;
  /** Whether this entry is still current. */
  active: boolean;
}

/** Lightweight synchronous dispatcher for Core and integration subscriptions. */
class EventEmitter {
  /**
   * Supported event names. Null means unrestricted event names.
   */
  #eventNames: Set<TrackerEventName> | null = null;

  /**
   * Registered event handlers by event name.
   */
  #listeners: Map<TrackerEventName, Map<TrackerEventHandler, EventSubscriptionEntry>> = new Map();

  /** Callback invoked when an integration handler throws. */
  #onHandlerError:
    ((error: Error, details: { eventName: TrackerEventName; payload: TrackerEventPayload }) => void) | null = null;

  /** Public subscriber dispatch boundary. */
  #runPublicDispatch: (dispatch: () => void) => void = (dispatch) => dispatch();

  /**
   * @param options - Emitter options.
   */
  constructor(options: EventEmitterOptions = {}) {
    const { eventNames = null, onHandlerError = null, runPublicDispatch = null } = options;

    this.#eventNames = eventNames == null ? null : new Set(eventNames);
    this.#onHandlerError = typeof onHandlerError === 'function' ? onHandlerError : null;
    this.#runPublicDispatch = typeof runPublicDispatch === 'function' ? runPublicDispatch : (dispatch) => dispatch();
  }

  /**
   * Removes all event subscriptions.
   */
  clear(): void {
    this.#listeners.clear();
  }

  /**
   * Releases all emitter state after permanent owner destroy.
   *
   * The supported event set becomes empty so destroyed emitters reject every
   * subscription and emission instead of accepting arbitrary event names.
   */
  destroy(): void {
    this.#listeners.clear();
    this.#eventNames = new Set();
    this.#onHandlerError = null;
    this.#runPublicDispatch = (dispatch) => dispatch();
  }

  /**
   * Emits an event to all subscribed handlers.
   *
   * Handler exceptions are caught and forwarded to the configured error callback.
   *
   * @param eventName - Event name.
   * @param payload - Event payload. Defaults to an empty object so handlers
   * always receive an object argument.
   */
  emit<TEventName extends TrackerEventName>(
    eventName: TEventName,
    payload: TrackerEventPayloadMap[TEventName] = {} as TrackerEventPayloadMap[TEventName],
  ): void {
    if (!this.hasEvent(eventName)) {
      return;
    }

    const handlers = this.#listeners.get(eventName);

    if (!handlers || handlers.size === 0) {
      return;
    }

    const publishedPayload = freezeTrackerEventPayload(eventName, payload);

    this.#runPublicDispatch(() => {
      [...handlers.values()].forEach(({ handler }) => {
        // Captured once per handler invocation so a late-settling thenable
        // still reaches the reporter that was active at dispatch time, even
        // if `destroy()` has since cleared `#onHandlerError`.
        const handlerErrorReporter = this.#onHandlerError;

        try {
          const result: unknown = handler(publishedPayload as TrackerEventPayload);

          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            (result as PromiseLike<unknown>).then(undefined, (error: unknown) => {
              handlerErrorReporter?.(toError(error), {
                eventName,
                payload: publishedPayload as TrackerEventPayload,
              });
            });
          }
        } catch (error) {
          handlerErrorReporter?.(toError(error), {
            eventName,
            payload: publishedPayload as TrackerEventPayload,
          });
        }
      });
    });
  }

  /**
   * Checks whether an event name is supported by this emitter.
   *
   * @param eventName - Event name candidate.
   * @returns True when the event name is usable.
   */
  hasEvent(eventName: unknown): eventName is TrackerEventName {
    if (typeof eventName !== 'string' || eventName === '') {
      return false;
    }

    return this.#eventNames === null || this.#eventNames.has(eventName as TrackerEventName);
  }

  /**
   * Returns the number of handlers subscribed to an event.
   *
   * @param eventName - Event name.
   * @returns Unique handler count.
   */
  listenerCount(eventName: TrackerEventName): number {
    const handlers = this.#listeners.get(eventName);

    return handlers ? handlers.size : 0;
  }

  /**
   * Removes a handler from an event.
   *
   * @param eventName - Event name.
   * @param handler - Event handler.
   */
  off<TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ): boolean {
    if (!this.hasEvent(eventName) || typeof handler !== 'function') {
      return false;
    }

    const handlers = this.#listeners.get(eventName);

    if (!handlers) {
      return false;
    }

    const entry = handlers.get(handler as unknown as TrackerEventHandler);

    if (!entry) {
      return false;
    }

    entry.active = false;
    entry.owners = 0;
    handlers.delete(entry.handler);

    if (handlers.size === 0) {
      this.#listeners.delete(eventName);
    }

    return true;
  }

  /**
   * Subscribes a handler to an event.
   *
   * Repeating the same event-name and handler-identity pair shares one delivery
   * entry while creating an independent owner. Each returned unsubscribe
   * releases only its owner; off() removes every owner of the current entry.
   *
   * The returned unsubscribe function is idempotent.
   *
   * @param eventName - Event name.
   * @param handler - Event handler.
   * @returns Unsubscribe function.
   */
  on<TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ): TrackerEventUnsubscribe {
    if (!this.hasEvent(eventName) || typeof handler !== 'function') {
      return noop;
    }

    let handlers = this.#listeners.get(eventName);

    if (!handlers) {
      handlers = new Map();
      this.#listeners.set(eventName, handlers);
    }

    const untypedHandler = handler as unknown as TrackerEventHandler;
    let entry = handlers.get(untypedHandler);

    if (!entry) {
      entry = { active: true, handler: untypedHandler, owners: 0 };
      handlers.set(untypedHandler, entry);
    }

    entry.owners += 1;

    let ownerActive = true;
    const ownedEntry = entry;

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
}

export { EventEmitter };
export type { EventEmitterOptions };
