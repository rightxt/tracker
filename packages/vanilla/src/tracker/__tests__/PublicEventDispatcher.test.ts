import { describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES } from '@rightxt/tracker-core';
import { PublicEventDispatcher } from '../PublicEventDispatcher.js';

import type { TrackerSyncEndEventPayload } from '@rightxt/tracker-core';

/** Representative immutable payload for dispatcher contract tests. */
const SYNC_END_PAYLOAD: TrackerSyncEndEventPayload = Object.freeze({
  clustersCount: 0,
  duration: null,
  markersCount: 0,
  timestamp: null,
});

describe('PublicEventDispatcher', () => {
  it('preserves reference-counted handler ownership across unsubscribe and off() replacement', () => {
    const dispatcher = new PublicEventDispatcher();
    const handler = vi.fn();
    const releaseA = dispatcher.on(EVENT_NAMES.SYNC_END, handler);
    const releaseB = dispatcher.on(EVENT_NAMES.SYNC_END, handler);

    // Two owners collapse to a single delivery slot.
    dispatcher.emit(EVENT_NAMES.SYNC_END, SYNC_END_PAYLOAD);
    expect(handler).toHaveBeenCalledTimes(1);

    // Releasing one owner (idempotently) keeps the entry alive for the other.
    releaseA();
    releaseA();
    dispatcher.emit(EVENT_NAMES.SYNC_END, SYNC_END_PAYLOAD);
    expect(handler).toHaveBeenCalledTimes(2);

    // off() retires every remaining owner of the current entry at once.
    expect(dispatcher.off(EVENT_NAMES.SYNC_END, handler)).toBe(true);
    dispatcher.emit(EVENT_NAMES.SYNC_END, SYNC_END_PAYLOAD);
    expect(handler).toHaveBeenCalledTimes(2);

    // A fresh subscription is a new entry; stale handles from the retired one cannot touch it.
    const releaseC = dispatcher.on(EVENT_NAMES.SYNC_END, handler);

    releaseA();
    releaseB();
    dispatcher.emit(EVENT_NAMES.SYNC_END, SYNC_END_PAYLOAD);
    expect(handler).toHaveBeenCalledTimes(3);

    releaseC();
    releaseC();
    expect(dispatcher.off(EVENT_NAMES.SYNC_END, handler)).toBe(false);
    dispatcher.emit(EVENT_NAMES.SYNC_END, SYNC_END_PAYLOAD);
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
