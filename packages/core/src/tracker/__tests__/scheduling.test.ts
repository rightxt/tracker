import { describe, expect, it, vi } from 'vitest';

import { createTrackerInstance } from '../createTrackerInstance.js';
import { coordinateTrackerOperation, runTrackerPublicDispatch } from '../operationCoordinator.js';
import {
  cancelTrackerInstanceRender,
  flushTrackerInstanceRender,
  flushTrackerInstanceRenderNow,
} from '../scheduling.js';

describe('core tracker scheduling facade', () => {
  it('cancels pending work, clears the dirty target and emits a snapshot', () => {
    const instance = createTrackerInstance();
    const cancelSpy = vi.spyOn(instance.scheduler, 'cancel');
    const listener = vi.fn();

    instance.snapshotStore!.subscribe(listener);
    instance.dirtyRenderTarget = 'all';

    cancelTrackerInstanceRender(instance);

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(instance.dirtyRenderTarget).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('flushes pending work through the scheduler', () => {
    const instance = createTrackerInstance();
    const flushSpy = vi.spyOn(instance.scheduler, 'flush');

    flushTrackerInstanceRender(instance);

    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores destroyed instances', () => {
    const instance = createTrackerInstance();
    const cancelSpy = vi.spyOn(instance.scheduler, 'cancel');
    const flushSpy = vi.spyOn(instance.scheduler, 'flush');

    instance.dirtyRenderTarget = 'all';
    instance.destroyed = true;

    cancelTrackerInstanceRender(instance);
    flushTrackerInstanceRender(instance);

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(flushSpy).not.toHaveBeenCalled();
    expect(instance.dirtyRenderTarget).toBe('all');
  });

  it('rejects a direct reentrant flush call made during a lifecycle transition, mirroring cancelTrackerInstanceRender()', () => {
    const instance = createTrackerInstance();
    const flushSpy = vi.spyOn(instance.scheduler, 'flush');

    instance.lifecycleState = 'mounting';

    expect(() =>
      coordinateTrackerOperation(instance, 'mount', () => flushTrackerInstanceRender(instance), {
        deferredResult: undefined,
      }),
    ).toThrow(expect.objectContaining({ code: 'ERR_TRACKER_TRANSITION_IN_PROGRESS' }));
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('defers a reentrant flush requested from a public-dispatch listener until the enclosing operation settles', () => {
    const instance = createTrackerInstance();
    const flushSpy = vi.spyOn(instance.scheduler, 'flush');
    const sequence: string[] = [];

    coordinateTrackerOperation(
      instance,
      'destroy',
      () => {
        sequence.push('operation-start');
        runTrackerPublicDispatch(instance, () => {
          flushTrackerInstanceRender(instance);
          sequence.push('listener-ran');
        });
        expect(flushSpy).not.toHaveBeenCalled();
        sequence.push('operation-end');
      },
      { deferredResult: undefined },
    );

    expect(sequence).toEqual(['operation-start', 'listener-ran', 'operation-end']);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('runs synchronously and inline when called without coordinator nesting', () => {
    const instance = createTrackerInstance();
    const flushSpy = vi.spyOn(instance.scheduler, 'flush');

    flushTrackerInstanceRenderNow(instance);

    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('publishes terminal scheduler state after an asynchronous render settles', async () => {
    let resolveRender: () => void = () => {};
    const renderPromise = new Promise<void>((resolve) => {
      resolveRender = resolve;
    });
    const instance = createTrackerInstance({ options: {}, rules: [] }, { render: () => renderPromise });
    const listener = vi.fn();

    instance.snapshotStore!.subscribe(listener);
    instance.scheduler.request('all');
    instance.scheduler.flush();

    expect(instance.scheduler.running).toBe(true);

    resolveRender();
    await renderPromise;
    await Promise.resolve();

    expect(instance.scheduler.pending).toBe(false);
    expect(instance.scheduler.running).toBe(false);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        render: expect.objectContaining({ pending: false, running: false }),
      }),
    );
  });
});
