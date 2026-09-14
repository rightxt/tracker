import { describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES } from '../eventNames.js';
import { EventEmitter } from '../EventEmitter.js';
import {
  coordinateTrackerOperation,
  createTrackerOperationCoordinator,
  runTrackerPublicDispatch,
} from '../../tracker/operationCoordinator.js';
import type { TrackerEventName } from '../../types.js';

describe('core EventEmitter', () => {
  it('subscribes, emits, and unsubscribes handlers idempotently', () => {
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
    });
    const handler = vi.fn();
    const unsubscribe = emitter.on(EVENT_NAMES.DESTROY, handler);

    expect(emitter.listenerCount(EVENT_NAMES.DESTROY)).toBe(1);

    emitter.emit(EVENT_NAMES.DESTROY, {});
    unsubscribe();
    unsubscribe();
    emitter.emit(EVENT_NAMES.DESTROY, {});

    expect(handler).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount(EVENT_NAMES.DESTROY)).toBe(0);
  });

  it('deduplicates the same event-name and handler-identity pair', () => {
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
    });
    const handler = vi.fn();
    const unsubscribeFirst = emitter.on(EVENT_NAMES.DESTROY, handler);
    const unsubscribeSecond = emitter.on(EVENT_NAMES.DESTROY, handler);

    expect(emitter.listenerCount(EVENT_NAMES.DESTROY)).toBe(1);

    emitter.emit(EVENT_NAMES.DESTROY, {});
    unsubscribeSecond();
    emitter.emit(EVENT_NAMES.DESTROY, {});
    unsubscribeFirst();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(emitter.listenerCount(EVENT_NAMES.DESTROY)).toBe(0);
  });

  it('ignores unsupported event names when restricted by eventNames', () => {
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
    });
    const handler = vi.fn();

    emitter.on(EVENT_NAMES.WARNING, handler);
    emitter.emit(EVENT_NAMES.WARNING, {
      code: 'invalid-option-value',
      details: null,
      message: 'Ignored.',
    });

    expect(handler).not.toHaveBeenCalled();
    expect(emitter.listenerCount(EVENT_NAMES.WARNING)).toBe(0);
  });

  it('forwards handler errors to the configured error callback', () => {
    const onHandlerError = vi.fn();
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
      onHandlerError,
    });

    emitter.on(EVENT_NAMES.DESTROY, () => {
      throw new Error('handler failed');
    });
    emitter.emit(EVENT_NAMES.DESTROY, {});

    expect(onHandlerError).toHaveBeenCalledTimes(1);
    expect(onHandlerError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onHandlerError.mock.calls[0]?.[1]).toMatchObject({
      eventName: EVENT_NAMES.DESTROY,
      payload: {},
    });
  });

  it('continues synchronous handler delivery when failure normalization is adversarial', () => {
    const onHandlerError = vi.fn();
    const laterHandler = vi.fn();
    const thrownValue = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('classification failed');
        },
      },
    );
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
      onHandlerError,
    });

    emitter.on(EVENT_NAMES.DESTROY, () => {
      throw thrownValue;
    });
    emitter.on(EVENT_NAMES.DESTROY, laterHandler);

    expect(() => emitter.emit(EVENT_NAMES.DESTROY, {})).not.toThrow();
    expect(onHandlerError).toHaveBeenCalledOnce();
    expect(onHandlerError.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ message: 'Unknown error.' }));
    expect(laterHandler).toHaveBeenCalledOnce();
  });

  it('routes a rejected thenable returned from an async handler to the error callback', async () => {
    const onHandlerError = vi.fn();
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
      onHandlerError,
    });

    emitter.on(EVENT_NAMES.DESTROY, (async () => {
      throw new Error('async handler failed');
    }) as never);
    emitter.emit(EVENT_NAMES.DESTROY, {});

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(onHandlerError).toHaveBeenCalledTimes(1);
    expect(onHandlerError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('routes a thenable rejection to the reporter captured at dispatch time even after destroy() clears it', async () => {
    const onHandlerError = vi.fn();
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
      onHandlerError,
    });
    let rejectPending: (error: Error) => void = () => {};
    const pending = new Promise<void>((_resolve, reject) => {
      rejectPending = reject;
    });

    emitter.on(EVENT_NAMES.DESTROY, (() => pending) as never);
    emitter.emit(EVENT_NAMES.DESTROY, {});
    emitter.destroy();
    rejectPending(new Error('late rejection after destroy'));

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(onHandlerError).toHaveBeenCalledTimes(1);
    expect(onHandlerError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('contains adversarial failure normalization for a late rejection after destroy()', async () => {
    const onHandlerError = vi.fn();
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
      onHandlerError,
    });
    let rejectPending: (error: unknown) => void = () => {};
    const pending = new Promise<void>((_resolve, reject) => {
      rejectPending = reject;
    });
    const thrownValue = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('classification failed');
        },
      },
    );

    emitter.on(EVENT_NAMES.DESTROY, (() => pending) as never);
    emitter.emit(EVENT_NAMES.DESTROY, {});
    emitter.destroy();
    rejectPending(thrownValue);
    await Promise.resolve();
    await Promise.resolve();

    expect(onHandlerError).toHaveBeenCalledOnce();
    expect(onHandlerError.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ message: 'Unknown error.' }));
  });

  it('freezes Tracker-owned cluster payload containers without freezing borrowed platform objects', () => {
    const emitter = new EventEmitter({ eventNames: [EVENT_NAMES.CLUSTER_ACTIVATE] });
    const borrowedElement = {} as Element;
    const borrowedEvent = {} as Event;
    const marker = {
      element: borrowedElement,
      key: 'marker:1',
      label: null,
      ruleIndex: 0,
      selector: '.target',
    };
    const payload = {
      count: 1,
      key: 'cluster:1',
      markers: [marker],
      primaryMarker: marker,
      sourceEvent: borrowedEvent,
    };
    const observedKeys: string[] = [];

    emitter.on(EVENT_NAMES.CLUSTER_ACTIVATE, (event) => {
      Reflect.set(event, 'key', 'mutated-cluster');
      Reflect.set(event.markers[0]!, 'key', 'mutated-marker');
      Reflect.set(event.markers, 'length', 0);
    });
    emitter.on(EVENT_NAMES.CLUSTER_ACTIVATE, (event) => {
      observedKeys.push(event.key, event.markers[0]!.key);
    });

    emitter.emit(EVENT_NAMES.CLUSTER_ACTIVATE, payload);

    expect(observedKeys).toEqual(['cluster:1', 'marker:1']);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.markers)).toBe(true);
    expect(Object.isFrozen(marker)).toBe(true);
    expect(Object.isFrozen(borrowedElement)).toBe(false);
    expect(Object.isFrozen(borrowedEvent)).toBe(false);
  });

  it('freezes nested Tracker-owned render reason containers', () => {
    const emitter = new EventEmitter({ eventNames: [EVENT_NAMES.SYNC_START] });
    const nestedReason = { source: 'mount' };
    const reasons = [nestedReason];
    const reason = { reasons, scheduled: true };
    const payload = { reason, scheduled: true, timestamp: null };

    emitter.on(EVENT_NAMES.SYNC_START, () => {});
    emitter.emit(EVENT_NAMES.SYNC_START, payload);

    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(reason)).toBe(true);
    expect(Object.isFrozen(reasons)).toBe(true);
    expect(Object.isFrozen(nestedReason)).toBe(true);
  });

  it('destroy releases listeners and rejects all event names afterwards', () => {
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
    });
    const handler = vi.fn();

    emitter.on(EVENT_NAMES.DESTROY, handler);
    emitter.destroy();

    expect(emitter.listenerCount(EVENT_NAMES.DESTROY)).toBe(0);
    expect(emitter.hasEvent(EVENT_NAMES.DESTROY)).toBe(false);
    expect(emitter.hasEvent('custom:event' as TrackerEventName)).toBe(false);

    emitter.on(EVENT_NAMES.DESTROY, handler);
    emitter.emit(EVENT_NAMES.DESTROY, {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('defers a reentrant coordinated operation until the entire handler batch settles', () => {
    const fakeInstance = {
      lifecycleState: 'mounted' as const,
      operationCoordinator: createTrackerOperationCoordinator(),
      diagnostics: {},
    };
    const sequence: string[] = [];
    const emitter = new EventEmitter({
      eventNames: [EVENT_NAMES.DESTROY],
      runPublicDispatch: (dispatch) => runTrackerPublicDispatch(fakeInstance, dispatch),
    });

    emitter.on(EVENT_NAMES.DESTROY, () => {
      sequence.push('first-listener');
      coordinateTrackerOperation(fakeInstance, 'destroy', () => sequence.push('destroy'), {
        deferredResult: undefined,
      });
    });
    emitter.on(EVENT_NAMES.DESTROY, () => {
      sequence.push('second-listener');
    });

    emitter.emit(EVENT_NAMES.DESTROY, {});

    expect(sequence).toEqual(['first-listener', 'second-listener', 'destroy']);
  });
});
