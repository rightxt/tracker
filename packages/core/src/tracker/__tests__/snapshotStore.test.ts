import { afterEach, describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES } from '../../events/eventNames.js';
import { createTrackerInstance } from '../createTrackerInstance.js';
import { getTrackerInstanceStats } from '../instanceStats.js';
import { destroyTrackerInstance } from '../lifecycle.js';
import { coordinateTrackerOperation } from '../operationCoordinator.js';
import { cancelTrackerInstanceRender } from '../scheduling.js';
import {
  MAX_SNAPSHOT_EMISSIONS_PER_BATCH,
  createTrackerSnapshotStore,
  emitTrackerInstanceSnapshot,
  getTrackerInstanceSnapshot,
  subscribeTrackerInstanceSnapshot,
} from '../snapshotStore.js';
import { createTrackerInstanceSnapshot } from '../snapshot.js';

import type { TrackerViewportLayoutRecord } from '../../types.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('core tracker snapshot store', () => {
  it('materializes unobserved revisions only when a snapshot is requested', () => {
    const instance = createTrackerInstance();
    const createSnapshot = vi.fn(createTrackerInstanceSnapshot);

    instance.snapshotStore = createTrackerSnapshotStore(instance, createSnapshot);

    emitTrackerInstanceSnapshot(instance);
    emitTrackerInstanceSnapshot(instance);

    expect(createSnapshot).not.toHaveBeenCalled();

    const snapshot = getTrackerInstanceSnapshot(instance);

    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(getTrackerInstanceSnapshot(instance)).toBe(snapshot);
    expect(createSnapshot).toHaveBeenCalledTimes(1);

    emitTrackerInstanceSnapshot(instance);

    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(getTrackerInstanceSnapshot(instance)).not.toBe(snapshot);
    expect(createSnapshot).toHaveBeenCalledTimes(2);
  });

  it('captures exactly one immutable snapshot for each observed emission', () => {
    const instance = createTrackerInstance();
    const createSnapshot = vi.fn(createTrackerInstanceSnapshot);
    const listener = vi.fn();

    instance.snapshotStore = createTrackerSnapshotStore(instance, createSnapshot);
    subscribeTrackerInstanceSnapshot(instance, listener);

    emitTrackerInstanceSnapshot(instance);
    emitTrackerInstanceSnapshot(instance);

    expect(createSnapshot).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toBe(getTrackerInstanceSnapshot(instance));
    expect(createSnapshot).toHaveBeenCalledTimes(2);
  });

  it('prepares without observable store mutation and emits that exact snapshot to current listeners', () => {
    const instance = createTrackerInstance();
    const createSnapshot = vi.fn(createTrackerInstanceSnapshot);
    const listener = vi.fn();

    instance.snapshotStore = createTrackerSnapshotStore(instance, createSnapshot);
    const previousSnapshot = instance.snapshotStore.getSnapshot();

    instance.mounted = true;
    instance.lifecycleState = 'mounted';
    const preparedSnapshot = instance.snapshotStore.prepare(instance);

    expect(createSnapshot).toHaveBeenCalledTimes(2);
    expect(instance.snapshotStore.getSnapshot()).toBe(previousSnapshot);
    expect(createSnapshot).toHaveBeenCalledTimes(2);

    instance.snapshotStore.subscribe(listener);
    instance.snapshotStore.emitPrepared(preparedSnapshot, instance);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(preparedSnapshot);
    expect(instance.snapshotStore.getSnapshot()).toBe(preparedSnapshot);
    expect(createSnapshot).toHaveBeenCalledTimes(2);

    instance.mounted = false;
    instance.lifecycleState = 'unmounted';
    instance.snapshotStore.emit(instance);

    expect(createSnapshot).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toBe(instance.snapshotStore.getSnapshot());
  });

  it('keeps silent refreshes lazy and caches their materialized identity', () => {
    const instance = createTrackerInstance();
    const createSnapshot = vi.fn(createTrackerInstanceSnapshot);

    instance.snapshotStore = createTrackerSnapshotStore(instance, createSnapshot);
    instance.snapshotStore.refresh(instance);

    expect(createSnapshot).not.toHaveBeenCalled();

    const snapshot = instance.snapshotStore.getSnapshot();

    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(instance.snapshotStore.getSnapshot()).toBe(snapshot);
  });

  it('retains committed viewport authority across revisions that do not replace it', () => {
    const instance = createTrackerInstance();
    const createSnapshot = vi.fn(createTrackerInstanceSnapshot);
    const firstViewport: TrackerViewportLayoutRecord = {
      end: 30,
      orientation: 'vertical',
      size: 20,
      source: { contentSize: 100, scrollOffset: 10, viewportSize: 20 },
      start: 10,
      visible: true,
    };
    const replacementViewport: TrackerViewportLayoutRecord = {
      end: 52,
      orientation: 'vertical',
      size: 30,
      source: { contentSize: 120, scrollOffset: 22, viewportSize: 30 },
      start: 22,
      visible: true,
    };

    instance.snapshotStore = createTrackerSnapshotStore(instance, createSnapshot);
    instance.snapshotStore.refresh(instance, undefined, firstViewport);
    instance.snapshotStore.getSnapshot();
    instance.snapshotStore.refresh(instance);
    instance.snapshotStore.getSnapshot();
    instance.snapshotStore.refresh(instance, undefined, replacementViewport);
    instance.snapshotStore.getSnapshot();

    expect(createSnapshot.mock.calls.map((call) => call[2])).toEqual([
      firstViewport,
      firstViewport,
      replacementViewport,
    ]);
  });

  it('notifies subscribers and supports unsubscribing', () => {
    const instance = createTrackerInstance();
    const listener = vi.fn();
    const unsubscribe = subscribeTrackerInstanceSnapshot(instance, listener);

    emitTrackerInstanceSnapshot(instance);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(getTrackerInstanceSnapshot(instance));

    unsubscribe();
    emitTrackerInstanceSnapshot(instance);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated subscriptions of the same listener identity', () => {
    const instance = createTrackerInstance();
    const listener = vi.fn();
    const unsubscribeFirst = subscribeTrackerInstanceSnapshot(instance, listener);
    const unsubscribeSecond = subscribeTrackerInstanceSnapshot(instance, listener);

    emitTrackerInstanceSnapshot(instance);
    unsubscribeSecond();
    emitTrackerInstanceSnapshot(instance);
    unsubscribeFirst();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores non-function listeners', () => {
    const instance = createTrackerInstance();
    const unsubscribe = instance.snapshotStore!.subscribe(null as never);

    expect(unsubscribe).toEqual(expect.any(Function));
    expect(() => {
      unsubscribe();
      emitTrackerInstanceSnapshot(instance);
    }).not.toThrow();
  });

  it('reports synchronous listener failures to the host without changing Core diagnostics', () => {
    const listenerError = new Error('listener failed');
    const reportError = vi.fn();

    vi.stubGlobal('reportError', reportError);

    const instance = createTrackerInstance();
    const failingListener = vi.fn((_snapshot: ReturnType<typeof getTrackerInstanceSnapshot>) => {
      throw listenerError;
    });
    const workingListener = vi.fn();

    subscribeTrackerInstanceSnapshot(instance, failingListener);
    subscribeTrackerInstanceSnapshot(instance, workingListener);
    emitTrackerInstanceSnapshot(instance);

    expect(workingListener).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(listenerError);
    expect(instance.diagnostics.getStats().errors.total).toBe(0);
    expect(getTrackerInstanceSnapshot(instance).diagnostics.errors.total).toBe(0);
  });

  it('continues listener delivery when every host-error scheduling transport fails synchronously', () => {
    vi.stubGlobal('reportError', undefined);
    vi.stubGlobal('queueMicrotask', () => {
      throw new Error('Expected microtask scheduling failure.');
    });
    vi.stubGlobal('setTimeout', () => {
      throw new Error('Expected timer scheduling failure.');
    });

    const instance = createTrackerInstance();
    const listenerError = new Error('Expected listener failure.');
    const failingListener = vi.fn((_snapshot: ReturnType<typeof getTrackerInstanceSnapshot>) => {
      throw listenerError;
    });
    const workingListener = vi.fn();

    subscribeTrackerInstanceSnapshot(instance, failingListener);
    subscribeTrackerInstanceSnapshot(instance, workingListener);

    expect(() => emitTrackerInstanceSnapshot(instance)).not.toThrow();
    expect(() => emitTrackerInstanceSnapshot(instance)).not.toThrow();
    expect(failingListener).toHaveBeenCalledTimes(2);
    expect(workingListener).toHaveBeenCalledTimes(2);
    expect(workingListener.mock.calls[0]?.[0]).toBe(failingListener.mock.calls[0]?.[0]);
    expect(workingListener.mock.calls[1]?.[0]).toBe(failingListener.mock.calls[1]?.[0]);
    expect(instance.diagnostics.getStats().errors.total).toBe(0);
  });

  it('does not inspect a thenable returned by a snapshot listener', () => {
    const instance = createTrackerInstance();
    const then = vi.fn();

    subscribeTrackerInstanceSnapshot(instance, (() => ({ then })) as never);
    emitTrackerInstanceSnapshot(instance);

    expect(then).not.toHaveBeenCalled();
    expect(instance.diagnostics.getStats().errors.total).toBe(0);
    expect(getTrackerInstanceSnapshot(instance).diagnostics.errors.total).toBe(0);
  });

  it('does not retain or inspect a terminal snapshot listener thenable after destroy', () => {
    const instance = createTrackerInstance();
    const then = vi.fn();

    subscribeTrackerInstanceSnapshot(instance, (() => ({ then })) as never);

    destroyTrackerInstance(instance);

    expect(then).not.toHaveBeenCalled();
    expect(getTrackerInstanceStats(instance).errors.total).toBe(0);
  });

  it('queues reentrant emissions so every listener observes the same order', () => {
    const instance = createTrackerInstance();
    const firstStates: boolean[] = [];
    const secondStates: boolean[] = [];

    subscribeTrackerInstanceSnapshot(instance, (snapshot) => {
      firstStates.push(snapshot.lifecycle.mounted);

      if (!snapshot.lifecycle.mounted) {
        instance.mounted = true;
        instance.lifecycleState = 'mounted';
        emitTrackerInstanceSnapshot(instance);
      }
    });
    subscribeTrackerInstanceSnapshot(instance, (snapshot) => {
      secondStates.push(snapshot.lifecycle.mounted);
    });

    emitTrackerInstanceSnapshot(instance);

    expect(firstStates).toEqual([false, true]);
    expect(secondStates).toEqual([false, true]);
  });

  it('stops a non-terminating reentrant publication batch', () => {
    const instance = createTrackerInstance();
    const listener = vi.fn(() => {
      emitTrackerInstanceSnapshot(instance);
    });
    const unsubscribe = subscribeTrackerInstanceSnapshot(instance, listener);

    expect(() => emitTrackerInstanceSnapshot(instance)).toThrow(
      expect.objectContaining({
        code: 'ERR_TRACKER_REENTRANCY_LIMIT',
        name: 'TrackerLifecycleError',
      }),
    );
    expect(listener).toHaveBeenCalledTimes(MAX_SNAPSHOT_EMISSIONS_PER_BATCH);
    expect(instance.diagnostics.getStats().errors.byCode.ERR_TRACKER_REENTRANCY_LIMIT).toBe(1);

    unsubscribe();

    expect(() => emitTrackerInstanceSnapshot(instance)).not.toThrow();
  });

  it('captures each queued snapshot at the time emit is called', () => {
    const instance = createTrackerInstance();
    const states: Array<{ destroyed: boolean; mounted: boolean }> = [];
    let queued = false;

    subscribeTrackerInstanceSnapshot(instance, () => {
      if (queued) {
        return;
      }

      queued = true;
      instance.mounted = true;
      instance.lifecycleState = 'mounted';
      emitTrackerInstanceSnapshot(instance);
      instance.mounted = false;
      instance.lifecycleState = 'unmounted';
      instance.destroyed = true;
      emitTrackerInstanceSnapshot(instance);
    });
    subscribeTrackerInstanceSnapshot(instance, (snapshot) => {
      states.push({
        destroyed: snapshot.lifecycle.destroyed,
        mounted: snapshot.lifecycle.mounted,
      });
    });

    emitTrackerInstanceSnapshot(instance);

    expect(states).toEqual([
      { destroyed: false, mounted: false },
      { destroyed: false, mounted: true },
      { destroyed: true, mounted: false },
    ]);
  });

  it('applies subscription changes to emissions queued after the current delivery', () => {
    const instance = createTrackerInstance();
    const secondStates: boolean[] = [];
    const thirdStates: boolean[] = [];
    let unsubscribeSecond = () => {};
    let changedSubscriptions = false;

    subscribeTrackerInstanceSnapshot(instance, () => {
      if (changedSubscriptions) {
        return;
      }

      changedSubscriptions = true;
      unsubscribeSecond();
      subscribeTrackerInstanceSnapshot(instance, (snapshot) => {
        thirdStates.push(snapshot.lifecycle.mounted);
      });
      instance.mounted = true;
      instance.lifecycleState = 'mounted';
      emitTrackerInstanceSnapshot(instance);
    });
    unsubscribeSecond = subscribeTrackerInstanceSnapshot(instance, (snapshot) => {
      secondStates.push(snapshot.lifecycle.mounted);
    });

    emitTrackerInstanceSnapshot(instance);

    expect(secondStates).toEqual([false]);
    expect(thirdStates).toEqual([true]);
  });

  it('finishes the current delivery but clears listeners before queued emissions', () => {
    const instance = createTrackerInstance();
    const secondListener = vi.fn();

    subscribeTrackerInstanceSnapshot(instance, () => {
      instance.snapshotStore!.clear();
      instance.mounted = true;
      emitTrackerInstanceSnapshot(instance);
    });
    subscribeTrackerInstanceSnapshot(instance, secondListener);

    emitTrackerInstanceSnapshot(instance);

    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(secondListener.mock.calls[0]?.[0].lifecycle.mounted).toBe(false);
  });

  it('creates fresh snapshots when the snapshot store is missing', () => {
    const instance = createTrackerInstance();

    instance.snapshotStore = null;

    const snapshot = getTrackerInstanceSnapshot(instance);

    expect(snapshot).toBeDefined();
    expect(() => emitTrackerInstanceSnapshot(instance)).not.toThrow();
  });

  it('rejects new subscriptions for destroyed instances', () => {
    const instance = createTrackerInstance();
    const listener = vi.fn();

    instance.destroyed = true;

    expect(() => subscribeTrackerInstanceSnapshot(instance, listener)).toThrow(
      expect.objectContaining({ code: 'ERR_TRACKER_DESTROYED' }),
    );

    instance.destroyed = false;
    emitTrackerInstanceSnapshot(instance);

    expect(listener).not.toHaveBeenCalled();
  });

  it('defers a reentrant coordinated operation until the entire snapshot listener batch settles', () => {
    const instance = createTrackerInstance();
    const sequence: string[] = [];

    subscribeTrackerInstanceSnapshot(instance, () => {
      sequence.push('first-listener');
      coordinateTrackerOperation(instance, 'destroy', () => sequence.push('destroy'), {
        deferredResult: undefined,
      });
    });
    subscribeTrackerInstanceSnapshot(instance, () => {
      sequence.push('second-listener');
    });

    emitTrackerInstanceSnapshot(instance);

    expect(sequence).toEqual(['first-listener', 'second-listener', 'destroy']);
  });

  it('delivers snapshots emitted by an operation drained after a public snapshot batch', () => {
    const instance = createTrackerInstance();
    const listener = vi.fn();
    let queuedFollowUp = false;

    subscribeTrackerInstanceSnapshot(instance, listener);
    subscribeTrackerInstanceSnapshot(instance, () => {
      if (queuedFollowUp) {
        return;
      }

      queuedFollowUp = true;
      coordinateTrackerOperation(instance, 'follow-up', () => emitTrackerInstanceSnapshot(instance), {
        deferredResult: undefined,
      });
    });

    emitTrackerInstanceSnapshot(instance);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('finishes the current snapshot batch before a listener-triggered destroy runs, reproducing cancelTrackerInstanceRender()', () => {
    const instance = createTrackerInstance();
    const sequence: string[] = [];
    let triggeredDestroy = false;

    instance.events.on(EVENT_NAMES.DESTROY, () => sequence.push('destroy'));
    subscribeTrackerInstanceSnapshot(instance, () => {
      sequence.push('first-listener');

      if (!triggeredDestroy) {
        triggeredDestroy = true;
        destroyTrackerInstance(instance);
      }
    });
    subscribeTrackerInstanceSnapshot(instance, () => {
      sequence.push('second-listener');
    });

    cancelTrackerInstanceRender(instance);

    expect(sequence.indexOf('second-listener')).toBeLessThan(sequence.indexOf('destroy'));
    expect(instance.destroyed).toBe(true);
  });
});
