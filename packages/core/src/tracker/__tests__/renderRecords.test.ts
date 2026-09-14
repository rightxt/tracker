import { describe, expect, it } from 'vitest';

import type { TrackerClusterRenderRecord, TrackerMarkerRecord, TrackerMarkerRenderRecord } from '../../types.js';
import { getPrimaryMarkerRecord, isClusterRenderRecord, isMarkerRenderRecord } from '../renderRecords.js';

const markerRecord = { kind: 'marker', key: 'a' } as TrackerMarkerRecord;

const markerRenderRecord = {
  kind: 'marker',
  key: 'a',
  marker: markerRecord,
} as TrackerMarkerRenderRecord;

const clusterRenderRecord = {
  kind: 'cluster',
  key: 'c:a|b',
  primaryMarker: markerRecord,
} as TrackerClusterRenderRecord;

describe('core tracker render record guards', () => {
  it('identifies cluster render records', () => {
    expect(isClusterRenderRecord(clusterRenderRecord)).toBe(true);
    expect(isClusterRenderRecord(markerRenderRecord)).toBe(false);
    expect(isClusterRenderRecord(null)).toBe(false);
    expect(isClusterRenderRecord(undefined)).toBe(false);
  });

  it('identifies marker render records', () => {
    expect(isMarkerRenderRecord(markerRenderRecord)).toBe(true);
    expect(isMarkerRenderRecord(clusterRenderRecord)).toBe(false);
    expect(isMarkerRenderRecord(null)).toBe(false);
  });

  it('resolves the primary marker for both record kinds', () => {
    expect(getPrimaryMarkerRecord(markerRenderRecord)).toBe(markerRecord);
    expect(getPrimaryMarkerRecord(clusterRenderRecord)).toBe(markerRecord);
    expect(getPrimaryMarkerRecord(null)).toBeNull();
    expect(getPrimaryMarkerRecord(undefined)).toBeNull();
  });

  it('returns null when record marker data is missing', () => {
    expect(getPrimaryMarkerRecord({ kind: 'marker', key: 'a' } as TrackerMarkerRenderRecord)).toBeNull();
    expect(getPrimaryMarkerRecord({ kind: 'cluster', key: 'c' } as TrackerClusterRenderRecord)).toBeNull();
  });
});
