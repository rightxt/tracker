// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createTrackerInstance } from '../createTrackerInstance.js';
import { destroyTrackerInstance } from '../lifecycle.js';
import {
  MAX_DEFERRED_OPERATIONS_PER_DRAIN,
  coordinateTrackerAdapterTransaction,
  coordinateTrackerOperation,
  runTrackerPublicDispatch,
} from '../operationCoordinator.js';

describe('adapter transaction finalization and failure ordering', () => {
  it('rethrows a sole adapter transaction settlement failure as the original value', () => {
    const instance = createTrackerInstance();
    const settlementError = new Error('settlement failure');

    expect(() =>
      coordinateTrackerAdapterTransaction(instance, 'settlement-only failure', () => undefined, {
        cleanup: () => {
          throw settlementError;
        },
      }),
    ).toThrow(settlementError);
  });

  it('aggregates body, settlement, and drain failures in that exact order', () => {
    const instance = createTrackerInstance();
    const bodyError = new Error('body failure');
    const settlementError = new Error('settlement failure');

    for (let index = 0; index <= MAX_DEFERRED_OPERATIONS_PER_DRAIN; index += 1) {
      instance.operationCoordinator.deferredOperations.push({ name: `prequeued-${index}`, run: () => undefined });
    }

    let thrown: unknown;

    try {
      coordinateTrackerAdapterTransaction(
        instance,
        'body + settlement + drain failure',
        () => {
          throw bodyError;
        },
        {
          cleanup: () => {
            throw settlementError;
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);

    const errors = (thrown as AggregateError).errors;

    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe(bodyError);
    expect(errors[1]).toBe(settlementError);
    expect(errors[2]).toEqual(expect.objectContaining({ code: 'ERR_TRACKER_REENTRANCY_LIMIT' }));
  });

  it('aggregates a transition rejection together with a failing settlement, rejection first', () => {
    const instance = createTrackerInstance();
    const settlementError = new Error('settlement failure');
    const transactionRun = vi.fn();
    const settle = vi.fn(() => {
      throw settlementError;
    });

    let thrown: unknown;

    try {
      coordinateTrackerOperation(
        instance,
        'outer operation',
        () => {
          instance.lifecycleState = 'mounting';
          coordinateTrackerAdapterTransaction(instance, 'nested transaction', transactionRun, { cleanup: settle });
        },
        { deferredResult: undefined },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);

    const errors = (thrown as AggregateError).errors;

    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual(expect.objectContaining({ code: 'ERR_TRACKER_TRANSITION_IN_PROGRESS' }));
    expect(errors[1]).toBe(settlementError);
    expect(transactionRun).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
  });

  it('drains a queued adapter transaction whose body requests destroy and settles exactly once', () => {
    const instance = createTrackerInstance();
    const transactionRun = vi.fn();
    const settle = vi.fn();

    runTrackerPublicDispatch(instance, () => {
      coordinateTrackerAdapterTransaction(
        instance,
        'queued transaction',
        () => {
          transactionRun();
          destroyTrackerInstance(instance);
        },
        { cleanup: settle },
      );
    });

    expect(transactionRun).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
    expect(instance.destroyed).toBe(true);
    expect(instance.lifecycleState).toBe('destroyed');
  });
});
