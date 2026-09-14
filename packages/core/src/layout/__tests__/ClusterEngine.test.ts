import { describe, expect, it, vi } from 'vitest';

import { resolveTrackerOptions } from '../../config/resolveOptions.js';
import type { TrackerMarkerLayoutRecord, TrackerMarkerRecord, TrackerResolvedOptions } from '../../types.js';
import { ClusterEngine } from '../ClusterEngine.js';

/**
 * Creates a minimal marker layout record for clustering tests.
 *
 * @param key - Marker key.
 * @param start - Track start in percent.
 * @param end - Track end in percent.
 * @param ruleIndex - Source rule index used for tie-breaking.
 * @returns Marker layout record.
 */
function createLayoutRecord(key: string, start: number, end: number, ruleIndex = 0): TrackerMarkerLayoutRecord {
  const marker = {
    kind: 'marker',
    key,
    ruleIndex,
    rule: { marker: { className: `class-${key}` } },
  } as unknown as TrackerMarkerRecord;

  return {
    marker,
    start,
    end,
    size: Math.max(0, end - start),
    orientation: 'vertical',
    source: { start, end, size: Math.max(0, end - start) },
  };
}

/**
 * Creates committed Tracker options with the given clustering settings.
 *
 * ClusterEngine consumes resolved options, so only the clustering branch is
 * declared here and the rest is filled from the defaults.
 *
 * @param clustering - Clustering options.
 * @param clustering.enabled - Whether clustering is enabled.
 * @param clustering.threshold - Clustering threshold in percentage points.
 * @returns Complete committed options.
 */
function createOptions(clustering: { enabled?: boolean; threshold?: number } = {}): TrackerResolvedOptions {
  return resolveTrackerOptions({ clustering });
}

describe('core cluster engine', () => {
  it('returns no records and reports zero counts for empty input', () => {
    const diagnostics = { setCurrentRenderCounts: vi.fn() };
    const engine = new ClusterEngine({ diagnostics });

    expect(engine.cluster([], createOptions())).toEqual([]);
    expect(engine.cluster(null as never, createOptions())).toEqual([]);
    expect(diagnostics.setCurrentRenderCounts).toHaveBeenCalledWith({ markers: 0, clusters: 0 });
  });

  it('maps every record to a marker record when clustering is disabled', () => {
    const diagnostics = { setCurrentRenderCounts: vi.fn() };
    const engine = new ClusterEngine({ diagnostics });
    const records = engine.cluster(
      [createLayoutRecord('a', 0, 10), createLayoutRecord('b', 5, 15)],
      createOptions({ enabled: false }),
    );

    expect(records.map((record) => record.kind)).toEqual(['marker', 'marker']);
    expect(records.map((record) => record.key)).toEqual(['a', 'b']);
    expect(diagnostics.setCurrentRenderCounts).toHaveBeenCalledWith({ markers: 2, clusters: 0 });
  });

  it('keeps positional order when clustering is disabled', () => {
    const engine = new ClusterEngine();
    const records = engine.cluster(
      [
        createLayoutRecord('late', 80, 90),
        createLayoutRecord('same-position-late-rule', 10, 20, 2),
        createLayoutRecord('early', 10, 20, 1),
      ],
      createOptions({ enabled: false }),
    );

    expect(records.map((record) => record.key)).toEqual(['early', 'same-position-late-rule', 'late']);
  });

  it('keeps distant record order stable when clustering is toggled', () => {
    const engine = new ClusterEngine();
    const layoutRecords = [createLayoutRecord('late', 80, 90), createLayoutRecord('early', 10, 20)];
    const disabledKeys = engine
      .cluster(layoutRecords, createOptions({ enabled: false, threshold: 0 }))
      .map((record) => record.key);
    const enabledKeys = engine
      .cluster(layoutRecords, createOptions({ enabled: true, threshold: 0 }))
      .map((record) => record.key);

    expect(disabledKeys).toEqual(['early', 'late']);
    expect(enabledKeys).toEqual(['early', 'late']);
  });

  it('merges overlapping records and retains the primary marker reference', () => {
    const diagnostics = { setCurrentRenderCounts: vi.fn() };
    const engine = new ClusterEngine({ diagnostics });
    const records = engine.cluster(
      [createLayoutRecord('b', 5, 15), createLayoutRecord('a', 0, 10)],
      createOptions({ enabled: true, threshold: 0 }),
    );

    expect(records).toHaveLength(1);

    const cluster = records[0];

    expect(cluster.kind).toBe('cluster');

    if (cluster.kind === 'cluster') {
      expect(cluster.key).toBe('c:a|b');
      expect(cluster.count).toBe(2);
      expect(cluster.primaryMarker.key).toBe('a');
      expect(cluster.start).toBe(0);
      expect(cluster.end).toBe(15);
      expect(cluster.size).toBe(15);
      expect(cluster.primaryMarker.rule.marker.className).toBe('class-a');
      expect(cluster).not.toHaveProperty('className');
    }

    expect(diagnostics.setCurrentRenderCounts).toHaveBeenCalledWith({ markers: 2, clusters: 1 });
  });

  it('keeps distant records as separate marker records', () => {
    const engine = new ClusterEngine();
    const records = engine.cluster(
      [createLayoutRecord('a', 0, 10), createLayoutRecord('b', 50, 60)],
      createOptions({ enabled: true, threshold: 0 }),
    );

    expect(records.map((record) => record.kind)).toEqual(['marker', 'marker']);
    expect(records.map((record) => record.key)).toEqual(['a', 'b']);
  });

  it('merges records separated by less than the threshold', () => {
    const engine = new ClusterEngine();
    const layoutRecords = [createLayoutRecord('a', 0, 10), createLayoutRecord('b', 13, 20)];

    expect(engine.cluster(layoutRecords, createOptions({ enabled: true, threshold: 0 }))).toHaveLength(2);
    expect(engine.cluster(layoutRecords, createOptions({ enabled: true, threshold: 5 }))).toHaveLength(1);
  });

  it('uses single-link chaining for consecutive nearby records', () => {
    const engine = new ClusterEngine();
    const records = engine.cluster(
      [createLayoutRecord('a', 0, 1), createLayoutRecord('b', 3, 4), createLayoutRecord('c', 6, 7)],
      createOptions({ enabled: true, threshold: 2 }),
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'cluster', start: 0, end: 7 });
  });

  it('clusters a large connected input without spread-based boundary calculations', () => {
    const engine = new ClusterEngine();
    const layoutRecords = Array.from({ length: 20_000 }, (_, index) => {
      const start = index / 1000;

      return createLayoutRecord(`marker-${index}`, start, start + 1);
    });
    const records = engine.cluster(layoutRecords, createOptions({ enabled: true, threshold: 0 }));

    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('cluster');

    if (records[0].kind === 'cluster') {
      expect(records[0].count).toBe(layoutRecords.length);
      expect(records[0].start).toBe(0);
      expect(records[0].end).toBeCloseTo(20.999);
      expect(records[0].markers[0]?.key).toBe('marker-0');
      expect(records[0].markers.at(-1)?.key).toBe('marker-19999');
    }
  });

  it('breaks equal start positions by rule index', () => {
    const engine = new ClusterEngine();
    const records = engine.cluster(
      [createLayoutRecord('late', 0, 10, 2), createLayoutRecord('early', 0, 10, 1)],
      createOptions({ enabled: true, threshold: 0 }),
    );

    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('cluster');

    if (records[0].kind === 'cluster') {
      expect(records[0].primaryMarker.key).toBe('early');
      expect(records[0].key).toBe('c:early|late');
    }
  });

  it('supports context updates and keeps working after destroy', () => {
    const initialDiagnostics = { setCurrentRenderCounts: vi.fn() };
    const nextDiagnostics = { setCurrentRenderCounts: vi.fn() };
    const engine = new ClusterEngine({ diagnostics: initialDiagnostics });

    engine.updateContext({ diagnostics: nextDiagnostics });
    engine.cluster([createLayoutRecord('a', 0, 10)], createOptions({ enabled: true }));

    expect(initialDiagnostics.setCurrentRenderCounts).not.toHaveBeenCalled();
    expect(nextDiagnostics.setCurrentRenderCounts).toHaveBeenCalledTimes(1);

    engine.destroy();

    expect(engine.cluster([createLayoutRecord('a', 0, 10)], createOptions({ enabled: true }))).toHaveLength(1);
    expect(nextDiagnostics.setCurrentRenderCounts).toHaveBeenCalledTimes(1);
  });
});
