// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  createTrackerInstance,
  createTrackerInstance as createDiagnosticTrackerInstance,
} from '../createTrackerInstance.js';
import { destroyTrackerInstance, mountTrackerInstance, unmountTrackerInstance } from '../lifecycle.js';
import {
  MAX_DEFERRED_OPERATIONS_PER_DRAIN,
  MAX_EMERGENCY_NONTERMINAL_ADMISSIONS,
  coordinateTrackerAdapterTransaction,
  coordinateTrackerOperation,
  runTrackerPublicDispatch,
} from '../operationCoordinator.js';
import { replaceTrackerInstanceOptions } from '../updating.js';

/** Mutable holder that lets a renderer hook close over an instance created after it. */
interface InstanceRef {
  current?: ReturnType<typeof createTrackerInstance>;
}

/**
 * Queues more than `MAX_DEFERRED_OPERATIONS_PER_DRAIN` no-op operations inside one
 * public dispatch, then runs `afterQueue` to append the scenario-specific tail
 * before the dispatch unwinds, so draining (and the emergency-limit branch) fires
 * once with the accepted residue already past the ordinary body budget.
 *
 * @param instance - Internal Tracker instance.
 * @param afterQueue - Scenario tail appended after the overflow queue, still inside the dispatch.
 */
function overflowDeferredQueueThen(instance: ReturnType<typeof createTrackerInstance>, afterQueue: () => void): void {
  runTrackerPublicDispatch(instance, () => {
    for (let index = 0; index <= MAX_DEFERRED_OPERATIONS_PER_DRAIN; index += 1) {
      coordinateTrackerOperation(instance, `queued-${index}`, () => undefined, { deferredResult: undefined });
    }

    afterQueue();
  });
}

describe('emergency terminal execution preserves the lifecycle reentrancy guard', () => {
  it('does not commit a reentrant option mutation triggered from renderer.destroy() during an emergency destroy, and still completes destruction while surfacing the reentrancy-limit error', () => {
    const instanceRef: InstanceRef = {};
    const renderer = {
      root: null,
      mount: vi.fn(() => null),
      unmount: vi.fn(),
      destroy: vi.fn(() => {
        replaceTrackerInstanceOptions(instanceRef.current!, { placement: 'right' }, { render: false });
      }),
      renderMarkers: vi.fn(),
      renderTrack: vi.fn(),
      renderViewport: vi.fn(),
      updateContext: vi.fn(),
    };

    const instance = createTrackerInstance({ rules: [] }, { renderer });
    instanceRef.current = instance;

    expect(() => overflowDeferredQueueThen(instance, () => destroyTrackerInstance(instance))).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_REENTRANCY_LIMIT' }),
    );

    expect(instance.destroyed).toBe(true);
    expect(instance.lifecycleState).toBe('destroyed');
    expect(instance.options.placement).not.toBe('right');
  });

  it('still runs a legitimate reentrant destroy queued from renderer.unmount() during an emergency unmount', () => {
    const sourceRoot = document.createElement('div');
    const renderRoot = document.createElement('div');

    document.body.append(sourceRoot, renderRoot);

    const instanceRef: InstanceRef = {};
    const renderer = {
      root: renderRoot,
      mount: vi.fn(() => renderRoot),
      unmount: vi.fn(() => {
        destroyTrackerInstance(instanceRef.current!);
      }),
      destroy: vi.fn(),
      renderMarkers: vi.fn(),
      renderTrack: vi.fn(),
      renderViewport: vi.fn(),
      updateContext: vi.fn(),
    };

    const instance = createTrackerInstance({ rules: [] }, { renderer });
    instanceRef.current = instance;
    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root: renderRoot }, sourceRoot });

    expect(() => overflowDeferredQueueThen(instance, () => unmountTrackerInstance(instance))).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_REENTRANCY_LIMIT' }),
    );

    expect(instance.destroyed).toBe(true);
    expect(instance.lifecycleState).toBe('destroyed');
  });

  it('runs dropped-operation cleanup exactly once for operations wiped by the emergency limit', () => {
    const instance = createTrackerInstance();
    const cleanup = vi.fn();

    expect(() =>
      overflowDeferredQueueThen(instance, () => {
        // Queued after the first MAX_DEFERRED_OPERATIONS_PER_DRAIN (1000) items, so it is
        // still pending (and gets wiped, not normally processed) once the limit is hit.
        coordinateTrackerOperation(instance, 'dropped-with-cleanup', () => undefined, {
          deferredResult: undefined,
          cleanup,
        });

        destroyTrackerInstance(instance);
      }),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REENTRANCY_LIMIT' }));

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs a destroy accepted by public dispatch during dropped adapter settlement before the limit error escapes', () => {
    const instance = createTrackerInstance();
    const settle = vi.fn(() => {
      destroyTrackerInstance(instance);
    });

    expect(() =>
      overflowDeferredQueueThen(instance, () => {
        coordinateTrackerAdapterTransaction(instance, 'dropped adapter transaction', () => undefined, {
          cleanup: settle,
        });
      }),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REENTRANCY_LIMIT' }));

    expect(settle).toHaveBeenCalledTimes(1);
    expect(instance.destroyed).toBe(true);
    expect(instance.lifecycleState).toBe('destroyed');
  });

  it('lets destroy supersede a meaningful pending unmount before either terminal body runs', () => {
    // Synthetic `terminal: 'unmount'` / `terminal: 'destroy'` operations are used instead of the real
    // `unmountTrackerInstance` / `destroyTrackerInstance` lifecycle functions: a real mounted destroy
    // legitimately tears down the active mount cycle through the renderer facade (calling the raw
    // `renderer.unmount` hook as an intrinsic part of `renderer.destroy()`), which would make a
    // `renderer.unmount` call-count assertion indistinguishable from the coordinator actually having
    // selected and run the queued unmount candidate. Spying directly on each candidate's own `run`
    // isolates exactly the terminal-lattice dominance this test checks. The instance is a genuinely
    // mounted baseline, so the queued unmount candidate is a semantically meaningful pending
    // transition rather than an already-inapplicable no-op.
    const sourceRoot = document.createElement('div');
    const renderRoot = document.createElement('div');

    document.body.append(sourceRoot, renderRoot);

    const renderer = {
      root: renderRoot,
      mount: vi.fn(() => renderRoot),
      unmount: vi.fn(),
      destroy: vi.fn(),
      renderMarkers: vi.fn(),
      renderTrack: vi.fn(),
      renderViewport: vi.fn(),
      updateContext: vi.fn(),
    };
    const instance = createTrackerInstance({ rules: [] }, { renderer });

    mountTrackerInstance(instance, { rendererTarget: { kind: 'root', root: renderRoot }, sourceRoot });

    expect(instance.lifecycleState).toBe('mounted');

    const unmountBodyRan = vi.fn();
    const destroyBodyRan = vi.fn(() => {
      instance.destroyed = true;
      instance.lifecycleState = 'destroyed';
    });

    const settle = vi.fn(() => {
      runTrackerPublicDispatch(instance, () => {
        coordinateTrackerOperation(instance, 'destroy', destroyBodyRan, {
          deferredResult: undefined,
          terminal: 'destroy',
        });
      });
    });

    expect(() =>
      overflowDeferredQueueThen(instance, () => {
        coordinateTrackerOperation(instance, 'unmount', unmountBodyRan, {
          deferredResult: undefined,
          terminal: 'unmount',
        });
        coordinateTrackerAdapterTransaction(instance, 'dropped adapter transaction', () => undefined, {
          cleanup: settle,
        });
      }),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REENTRANCY_LIMIT' }));

    expect(settle).toHaveBeenCalledOnce();
    expect(unmountBodyRan).not.toHaveBeenCalled();
    expect(destroyBodyRan).toHaveBeenCalledOnce();
  });

  it('throws the reentrancy-limit error synchronously when cleanup feedback never reaches a fixed point, without ever executing an operation body', () => {
    const instance = createTrackerInstance();
    const bodyRan = vi.fn();
    let requeueCount = 0;
    const requeueForever = (): void => {
      requeueCount += 1;

      if (requeueCount === MAX_EMERGENCY_NONTERMINAL_ADMISSIONS + 2) {
        destroyTrackerInstance(instance);
      }

      runTrackerPublicDispatch(instance, () => {
        coordinateTrackerOperation(instance, `forever-${requeueCount}`, bodyRan, {
          deferredResult: undefined,
          cleanup: requeueForever,
        });
      });
    };

    expect(() =>
      overflowDeferredQueueThen(instance, () => {
        coordinateTrackerOperation(instance, 'forever-seed', () => undefined, {
          deferredResult: undefined,
          cleanup: requeueForever,
        });
      }),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_REENTRANCY_LIMIT' }));

    expect(bodyRan).not.toHaveBeenCalled();
    // The seed cleanup plus MAX_EMERGENCY_NONTERMINAL_ADMISSIONS admitted feedback
    // entries reach the refusal boundary; the refused entry receives one
    // finalization, whose nested nonterminal recursion is then stopped before
    // queue ownership.
    expect(requeueCount).toBe(MAX_EMERGENCY_NONTERMINAL_ADMISSIONS + 2);
    expect(instance.destroyed).toBe(true);
    expect(instance.lifecycleState).toBe('destroyed');
  });

  it('drains deferred operations in FIFO order ahead of the emergency limit', () => {
    const instance = createTrackerInstance();
    const order: string[] = [];

    runTrackerPublicDispatch(instance, () => {
      coordinateTrackerOperation(instance, 'first', () => order.push('first'), { deferredResult: undefined });
      coordinateTrackerOperation(instance, 'second', () => order.push('second'), { deferredResult: undefined });
      coordinateTrackerOperation(instance, 'third', () => order.push('third'), { deferredResult: undefined });
    });

    expect(order).toEqual(['first', 'second', 'third']);

    // A second public dispatch after the first drain completed proves the coordinator stays reusable
    // without asserting its private queue/guard representation.
    runTrackerPublicDispatch(instance, () => {
      coordinateTrackerOperation(instance, 'fourth', () => order.push('fourth'), { deferredResult: undefined });
    });

    expect(order).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('keeps normalization-time reentrancy behind older deferred operations and completes the drain', () => {
    const diagnosticError = vi.fn();
    const instance = createDiagnosticTrackerInstance({
      options: { diagnostics: { output: { error: diagnosticError } } },
    });
    const order: string[] = [];
    const thrownValue = new Proxy(
      {},
      {
        getPrototypeOf() {
          coordinateTrackerOperation(instance, 'D', () => order.push('D'), { deferredResult: undefined });
          throw new Error('classification failed');
        },
      },
    );

    expect(() =>
      runTrackerPublicDispatch(instance, () => {
        coordinateTrackerOperation(
          instance,
          'B',
          () => {
            order.push('B');
            throw thrownValue;
          },
          { deferredResult: undefined },
        );
        coordinateTrackerOperation(instance, 'C', () => order.push('C'), { deferredResult: undefined });
      }),
    ).not.toThrow();

    expect(order).toEqual(['B', 'C', 'D']);
    expect(diagnosticError).toHaveBeenCalledWith(
      'deferred-operation-error',
      'Deferred Tracker operation failed.',
      expect.objectContaining({ operation: 'B' }),
    );
    expect(instance.diagnostics.getStats().errors.byCode['deferred-operation-error']).toBe(1);
  });
});
