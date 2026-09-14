import type {
  TrackerClusterRenderRecord,
  TrackerMarkerLayoutRecord,
  TrackerMarkerRenderRecord,
  TrackerRenderRecord,
  TrackerResolvedOptions,
} from '../types.js';

interface ClusterEngineDiagnostics {
  /** Current render counts updater. */
  setCurrentRenderCounts?: (counters: { markers?: number; clusters?: number }) => void;
}

interface ClusterEngineContext {
  /** Diagnostics layer. */
  diagnostics?: ClusterEngineDiagnostics | null;
}

/**
 * Checks whether a layout record belongs to the active cluster.
 *
 * @param candidate - Candidate layout record.
 * @param clusterStart - Current cluster start.
 * @param clusterEnd - Current cluster end.
 * @param threshold - Threshold in percentage points.
 * @returns True when the candidate is close enough to the cluster.
 */
function belongsToCluster(
  candidate: TrackerMarkerLayoutRecord,
  clusterStart: number,
  clusterEnd: number,
  threshold: number,
): boolean {
  return candidate.start <= clusterEnd + threshold && candidate.end >= clusterStart - threshold;
}

/**
 * Creates a render record for a marker cluster.
 *
 * Cluster visual data is inherited from the first marker in the cluster. The
 * cluster count remains separate and is rendered by CSS through data-rxtt-count.
 *
 * @param clusterItems - Clustered layout records.
 * @param start - Cluster start.
 * @param end - Cluster end.
 * @returns Cluster render record.
 */
function createClusterRenderRecord(
  clusterItems: TrackerMarkerLayoutRecord[],
  start: number,
  end: number,
): TrackerClusterRenderRecord {
  const markers = clusterItems.map((item) => item.marker);
  const primaryLayout = clusterItems[0];
  const primaryMarker = primaryLayout.marker;
  const key = `c:${markers.map((marker) => marker.key).join('|')}`;

  return {
    kind: 'cluster',
    key,
    markers,
    count: markers.length,
    primaryMarker,
    start,
    end,
    size: Math.max(0, end - start),
    orientation: primaryLayout.orientation,
  };
}

/**
 * Creates a render record for a single marker.
 *
 * @param layoutRecord - Marker layout record.
 * @returns Marker render record.
 */
function createMarkerRenderRecord(layoutRecord: TrackerMarkerLayoutRecord): TrackerMarkerRenderRecord {
  return {
    kind: 'marker',
    key: layoutRecord.marker.key,
    marker: layoutRecord.marker,
    start: layoutRecord.start,
    end: layoutRecord.end,
    size: layoutRecord.size,
    orientation: layoutRecord.orientation,
  };
}

/**
 * Converts a cluster group into one or more render records.
 *
 * @param clusterItems - Cluster layout records.
 * @param start - Cluster start.
 * @param end - Cluster end.
 * @returns Render records.
 */
function flushCluster(clusterItems: TrackerMarkerLayoutRecord[], start: number, end: number): TrackerRenderRecord[] {
  if (clusterItems.length === 0) {
    return [];
  }

  if (clusterItems.length === 1) {
    return [createMarkerRenderRecord(clusterItems[0])];
  }

  return [createClusterRenderRecord(clusterItems, start, end)];
}

/**
 * Groups close marker layout records into render records.
 *
 * ClusterEngine does not create DOM nodes. It only transforms layout records
 * into marker or cluster render records.
 */
class ClusterEngine {
  /**
   * Cluster engine context.
   */
  #context: ClusterEngineContext;

  /**
   * @param context - Optional diagnostics layer used to publish current marker
   * and cluster counts. The reference is retained until updateContext() or destroy().
   * The constructor has no side effects.
   */
  constructor(context: ClusterEngineContext = {}) {
    this.#context = {
      diagnostics: context.diagnostics || null,
    };
  }

  /**
   * Groups layout records for rendering.
   *
   * If clustering is disabled, every layout record becomes a marker render
   * record. All output is ordered by track position, with rule priority used
   * to break equal positions. Enabled clustering uses single-link chaining:
   * each record is compared with the accumulated bounds of the current cluster.
   *
   * @param layoutRecords - Marker layout records.
   * @param options - Committed Tracker options.
   * @returns Marker and cluster render records.
   */
  cluster(layoutRecords: TrackerMarkerLayoutRecord[], options: TrackerResolvedOptions): TrackerRenderRecord[] {
    if (!Array.isArray(layoutRecords) || layoutRecords.length === 0) {
      this.#context.diagnostics?.setCurrentRenderCounts?.({
        markers: 0,
        clusters: 0,
      });

      return [];
    }

    const sortedRecords = [...layoutRecords].sort((left, right) => {
      if (left.start === right.start) {
        return left.marker.ruleIndex - right.marker.ruleIndex;
      }

      return left.start - right.start;
    });

    if (!options.clustering.enabled) {
      const records = sortedRecords.map(createMarkerRenderRecord);

      this.#context.diagnostics?.setCurrentRenderCounts?.({
        markers: records.length,
        clusters: 0,
      });

      return records;
    }

    const threshold = options.clustering.threshold;
    const renderRecords: TrackerRenderRecord[] = [];
    let clusterItems: TrackerMarkerLayoutRecord[] = [];
    let clusterStart = 0;
    let clusterEnd = 0;

    sortedRecords.forEach((layoutRecord) => {
      if (clusterItems.length === 0) {
        clusterItems.push(layoutRecord);
        clusterStart = layoutRecord.start;
        clusterEnd = layoutRecord.end;
        return;
      }

      if (belongsToCluster(layoutRecord, clusterStart, clusterEnd, threshold)) {
        clusterItems.push(layoutRecord);
        clusterStart = Math.min(clusterStart, layoutRecord.start);
        clusterEnd = Math.max(clusterEnd, layoutRecord.end);
        return;
      }

      renderRecords.push(...flushCluster(clusterItems, clusterStart, clusterEnd));
      clusterItems = [layoutRecord];
      clusterStart = layoutRecord.start;
      clusterEnd = layoutRecord.end;
    });

    renderRecords.push(...flushCluster(clusterItems, clusterStart, clusterEnd));

    const clustersCount = renderRecords.filter((record) => record.kind === 'cluster').length;

    this.#context.diagnostics?.setCurrentRenderCounts?.({
      markers: layoutRecords.length,
      clusters: clustersCount,
    });

    return renderRecords;
  }

  /**
   * Releases cluster diagnostics references.
   */
  destroy(): void {
    this.#context = {
      diagnostics: null,
    };
  }

  /**
   * Updates cluster context.
   *
   * @param context - Context patch.
   */
  updateContext(context: Partial<ClusterEngineContext> = {}): void {
    this.#context = {
      ...this.#context,
      ...context,
    };
  }
}

export { ClusterEngine };
export type { ClusterEngineContext, ClusterEngineDiagnostics };
