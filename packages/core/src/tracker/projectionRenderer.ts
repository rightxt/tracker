import type {
  TrackerDiagnosticsSink,
  TrackerMarkerDefaultsSnapshot,
  TrackerReadonlyOptions,
  TrackerRenderRecord,
  TrackerRendererContext,
  TrackerRendererMountContext,
  TrackerViewportLayoutRecord,
} from '../types.js';
import { isHTMLElement } from '../dom/element.js';
import { registerTrackerRendererTransaction } from './rendererTransaction.js';
import type {
  TrackerChromeView,
  TrackerItemView,
  TrackerMountView,
  TrackerSelectionView,
  TrackerViewportView,
} from './viewProjection.js';
import {
  createTrackerMountView,
  projectTrackerChromeView,
  projectTrackerItemViews,
  projectTrackerSelectionView,
  projectTrackerViewportView,
} from './viewProjection.js';

/** Independently observable framework projection domains. */
type TrackerProjectionDomain = 'chrome' | 'items' | 'mount' | 'selection' | 'viewport';

/** Coherent committed framework projection state. */
interface TrackerProjectionState {
  readonly revision: number;
  readonly generation: number;
  readonly chrome: TrackerChromeView;
  readonly items: readonly TrackerItemView[];
  readonly mount: TrackerMountView;
  readonly selection: TrackerSelectionView;
  readonly viewport: TrackerViewportView;
}

/** One successful renderer publication delivered to a framework sink. */
interface TrackerProjectionCommit {
  readonly changed: readonly TrackerProjectionDomain[];
  readonly state: TrackerProjectionState;
}

/** Receives one coherent projection commit. */
type TrackerProjectionListener = (commit: TrackerProjectionCommit) => void;

/** Releases a projection listener. */
type TrackerProjectionUnsubscribe = () => void;

/** One unique projection listener with independently owned registrations. */
interface TrackerProjectionSubscriptionEntry {
  /** Whether this entry remains current. */
  active: boolean;
  /** Integration-owned projection listener. */
  listener: TrackerProjectionListener;
  /** Active registration owner count. */
  owners: number;
}

/** Provisional domain references owned by one outer renderer transaction. */
interface StagedTrackerProjection {
  readonly generation: number;
  chrome?: TrackerChromeView;
  items?: readonly TrackerItemView[];
  markerOptions?: TrackerMarkerDefaultsSnapshot | undefined;
  mount?: TrackerMountView;
  renderRecords?: readonly TrackerRenderRecord[];
  selection?: TrackerSelectionView;
  viewportLayout?: TrackerViewportLayoutRecord | null;
  viewport?: TrackerViewportView;
}

/** All domains used when a failed sink requires a complete resynchronization. */
const ALL_PROJECTION_DOMAINS: readonly TrackerProjectionDomain[] = Object.freeze([
  'chrome',
  'items',
  'mount',
  'selection',
  'viewport',
]);

/** Shared empty renderer-ready item domain used without available geometry. */
const EMPTY_PROJECTION_ITEMS: readonly TrackerItemView[] = Object.freeze([]);

/**
 * Transactional renderer that converts granular Core callbacks into immutable
 * framework-owned domains without exposing provisional render state.
 */
class TrackerProjectionRenderer {
  /** Current diagnostics sink. */
  #diagnostics: TrackerDiagnosticsSink | null = null;

  /** Current framework-owned render root. */
  #root: HTMLElement | null = null;

  /** Last viewport layout retained for mount/geometry reprojection. */
  #viewportLayout: TrackerViewportLayoutRecord | null = null;

  /**
   * Last ordered render records retained for presentation-only updates and
   * geometry-suspension recovery within one active mount. Released on
   * `unmount()`/`destroy()` so retired source `Element`s do not stay reachable.
   */
  #renderRecords: readonly TrackerRenderRecord[] = [];

  /** Marker defaults committed with the retained render records. */
  #markerOptions: TrackerMarkerDefaultsSnapshot | undefined;

  /** Current mount and geometry domain. */
  #mount = createTrackerMountView(false, null, false);

  /** Last committed projection state. */
  #state: TrackerProjectionState | null = null;

  /** Provisional domains for the active outer transaction. */
  #staged: StagedTrackerProjection | null = null;

  /** Nested transaction depth. */
  #transactionDepth = 0;

  /** Active mount generation. */
  #generation = 0;

  /** Whether the next successful commit must republish every domain. */
  #forceFullResynchronization = false;

  /** Whether permanent teardown should release listeners after terminal publication. */
  #releaseListenersAfterCommit = false;

  /** Active projection listeners, deduplicated by callback identity. */
  readonly #listeners = new Map<TrackerProjectionListener, TrackerProjectionSubscriptionEntry>();

  /**
   * Instance-owned settlement invoked after a delayed listener rejection is
   * recorded, so retained public diagnostic views (`getStats()`,
   * `getSnapshot().diagnostics`, terminal `finalStats`) stay current even
   * though the rejection surfaces on a later microtask, after the triggering
   * commit already returned. Bound once by the owning Projection integration;
   * `null` for renderers created without one (for example, focused unit tests).
   */
  #settleAfterListenerRejection: (() => void) | null = null;

  /** Registers the internal transaction protocol without changing public renderer types. */
  constructor() {
    registerTrackerRendererTransaction(this, {
      begin: () => this.#begin(),
      commit: () => this.#commit(),
      rollback: () => this.#rollback(),
      updateMount: (mount, options) => this.#updateMount(mount, options),
    });
  }

  /** Current framework-owned root. */
  get root(): HTMLElement | null {
    return this.#root;
  }

  /** Last viewport layout exposed to Core snapshot compatibility code. */
  get viewportLayout(): TrackerViewportLayoutRecord | null {
    return this.#viewportLayout;
  }

  /**
   * Initializes the deterministic unmounted projection shell.
   *
   * @param options - Frozen renderer options.
   * @returns Initial projection state.
   */
  initialize(options: TrackerReadonlyOptions): TrackerProjectionState {
    if (this.#state !== null) {
      return this.#state;
    }

    this.#state = Object.freeze({
      chrome: projectTrackerChromeView(options, this.#mount),
      generation: this.#generation,
      items: EMPTY_PROJECTION_ITEMS,
      mount: this.#mount,
      revision: 0,
      selection: projectTrackerSelectionView(null, null),
      viewport: projectTrackerViewportView(null, options, false),
    });

    return this.#state;
  }

  /** Returns the latest committed state. */
  getProjection(): TrackerProjectionState {
    if (this.#state === null) {
      throw new Error('Tracker projection renderer must be initialized before reading state.');
    }

    return this.#state;
  }

  /**
   * Subscribes to coherent projection commits.
   *
   * @param listener - Projection listener.
   * @returns Idempotent unsubscribe function.
   */
  subscribe(listener: TrackerProjectionListener): TrackerProjectionUnsubscribe {
    if (typeof listener !== 'function') {
      return () => {};
    }

    let entry = this.#listeners.get(listener);

    if (!entry) {
      entry = { active: true, listener, owners: 0 };
      this.#listeners.set(listener, entry);
    }

    entry.owners += 1;
    const ownedEntry = entry;
    let ownerActive = true;

    return () => {
      if (!ownerActive) {
        return;
      }

      ownerActive = false;

      if (!ownedEntry.active || this.#listeners.get(listener) !== ownedEntry) {
        return;
      }

      ownedEntry.owners -= 1;

      if (ownedEntry.owners === 0) {
        ownedEntry.active = false;
        this.#listeners.delete(listener);
      }
    };
  }

  /** Binds Core to a framework-owned root. */
  mount(context: TrackerRendererMountContext, _options: TrackerReadonlyOptions): HTMLElement | null {
    const target = context.target.kind === 'root' ? context.target.root : context.target.host;

    if (!isHTMLElement(target)) {
      return null;
    }

    this.#root = target;
    return target;
  }

  /** Reversibly releases the active root and retired generation's source records. */
  unmount(): void {
    this.#root = null;
    this.#viewportLayout = null;
    this.#renderRecords = [];
    this.#markerOptions = undefined;
  }

  /** Marks permanent teardown; terminal listeners are released after commit. */
  destroy(): void {
    this.#root = null;
    this.#viewportLayout = null;
    this.#renderRecords = [];
    this.#markerOptions = undefined;
    this.#releaseListenersAfterCommit = true;
  }

  /** Projects the chrome domain. */
  renderTrack(options: TrackerReadonlyOptions): void {
    this.#ensureStaged().chrome = projectTrackerChromeView(options, this.#mount);
  }

  /** Projects ordered item structure and presentation. */
  renderMarkers(
    renderRecords: readonly TrackerRenderRecord[],
    _options: TrackerReadonlyOptions,
    markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  ): void {
    const staged = this.#ensureStaged();

    staged.renderRecords = renderRecords;
    staged.markerOptions = markerOptions;
    staged.items = projectTrackerItemViews(renderRecords, markerOptions, this.#mount.geometryAvailable);
  }

  /** Reprojects item presentation without changing Core structure. */
  renderMarkerPresentation(
    renderRecords: readonly TrackerRenderRecord[],
    markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  ): void {
    const staged = this.#ensureStaged();

    staged.renderRecords = renderRecords;
    staged.markerOptions = markerOptions;
    staged.items = projectTrackerItemViews(renderRecords, markerOptions, this.#mount.geometryAvailable);
  }

  /** Stages the isolated keyed selection domain. */
  renderSelection(previousKey: string | null, nextKey: string | null): void {
    this.#ensureStaged().selection = projectTrackerSelectionView(previousKey, nextKey);
  }

  /** Projects viewport state without touching items or chrome. */
  renderViewport(viewportLayout: TrackerViewportLayoutRecord, options: TrackerReadonlyOptions): void {
    const staged = this.#ensureStaged();

    staged.viewportLayout = viewportLayout;
    staged.viewport = projectTrackerViewportView(viewportLayout, options, this.#mount.geometryAvailable);
  }

  /** Updates diagnostics ownership for sink failures. */
  updateContext(context: TrackerRendererContext): void {
    this.#diagnostics = context.diagnostics ?? null;
  }

  /**
   * Binds the instance-owned settlement invoked after a delayed listener
   * rejection is recorded. Core-internal wiring, not part of the public
   * Projection SPI: called once by {@link createTrackerProjectionIntegration}.
   *
   * @param settle - Instance-owned settlement callback.
   */
  bindListenerRejectionSettlement(settle: () => void): void {
    this.#settleAfterListenerRejection = settle;
  }

  /** Starts or nests a renderer transaction. */
  #begin(): void {
    if (this.#transactionDepth === 0) {
      this.#staged = null;
    }

    this.#transactionDepth += 1;
  }

  /** Commits one nesting level and publishes at the outer boundary. */
  #commit(): void {
    if (this.#transactionDepth === 0) {
      return;
    }

    this.#transactionDepth -= 1;

    if (this.#transactionDepth === 0) {
      this.#publishStaged();
    }
  }

  /** Discards every provisional domain and resets transaction nesting. */
  #rollback(): void {
    this.#staged = null;
    this.#transactionDepth = 0;
  }

  /** Returns current staging, creating it for the active generation when needed. */
  #ensureStaged(): StagedTrackerProjection {
    if (this.#staged === null) {
      this.#staged = { generation: this.#generation };
    }

    return this.#staged;
  }

  /** Stages a mount/geometry transition and its dependent visual domains. */
  #updateMount(mount: TrackerMountView, options: TrackerReadonlyOptions): void {
    const generationChanged = this.#mount.mounted !== mount.mounted;

    if (generationChanged) {
      this.#generation += 1;
      this.#staged = null;
    }

    this.#mount = mount;

    const staged = this.#ensureStaged();
    const renderRecords = staged.renderRecords ?? this.#renderRecords;
    const markerOptions = staged.renderRecords === undefined ? this.#markerOptions : staged.markerOptions;
    const viewportLayout = staged.viewportLayout === undefined ? this.#viewportLayout : staged.viewportLayout;

    staged.mount = mount;
    staged.chrome = projectTrackerChromeView(options, mount);
    staged.items = projectTrackerItemViews(renderRecords, markerOptions, mount.geometryAvailable);
    staged.viewport = projectTrackerViewportView(viewportLayout, options, mount.geometryAvailable);

    if (!mount.geometryAvailable) {
      const previousKey = this.#state?.selection.selectedKey ?? null;

      staged.selection = projectTrackerSelectionView(previousKey, null);
    }
  }

  /** Publishes coherent staged domains or discards a retired generation. */
  #publishStaged(): void {
    const staged = this.#staged;
    const previous = this.#state;

    this.#staged = null;

    if (staged === null || previous === null || staged.generation !== this.#generation) {
      return;
    }

    if (staged.renderRecords !== undefined) {
      this.#renderRecords = staged.renderRecords;
      this.#markerOptions = staged.markerOptions;
    }

    if (staged.viewportLayout !== undefined) {
      this.#viewportLayout = staged.viewportLayout;
    }

    let chrome = staged.chrome ?? previous.chrome;
    let items = staged.items ?? previous.items;
    let mount = staged.mount ?? previous.mount;
    let selection = staged.selection ?? previous.selection;
    let viewport = staged.viewport ?? previous.viewport;
    const changed: TrackerProjectionDomain[] = [];

    if (this.#forceFullResynchronization) {
      chrome = Object.freeze({ ...chrome });
      items = Object.freeze([...items]);
      mount = Object.freeze({ ...mount });
      selection = Object.freeze({ ...selection });
      viewport = Object.freeze({ ...viewport });
      changed.push(...ALL_PROJECTION_DOMAINS);
      this.#forceFullResynchronization = false;
    } else {
      if (chrome !== previous.chrome) {
        changed.push('chrome');
      }

      if (items !== previous.items) {
        changed.push('items');
      }

      if (mount !== previous.mount) {
        changed.push('mount');
      }

      if (selection !== previous.selection) {
        changed.push('selection');
      }

      if (viewport !== previous.viewport) {
        changed.push('viewport');
      }
    }

    if (changed.length === 0) {
      return;
    }

    const state: TrackerProjectionState = Object.freeze({
      chrome,
      generation: this.#generation,
      items,
      mount,
      revision: previous.revision + 1,
      selection,
      viewport,
    });
    const commit: TrackerProjectionCommit = Object.freeze({ changed: Object.freeze(changed), state });

    this.#state = state;

    // A returned thenable is observed defensively, matching the EventEmitter and
    // snapshot store publish loops: nothing in `TrackerProjectionListener`'s void
    // return type stops a consumer from passing an async function, so an
    // unobserved rejection here would otherwise escape Core's listener-failure
    // policy entirely instead of forcing the same full resynchronization a
    // synchronous throw already forces.
    [...this.#listeners.values()].forEach(({ listener }) => {
      try {
        const result: unknown = listener(commit);

        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          (result as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.#forceFullResynchronization = true;
            this.#diagnostics?.error?.('projection-listener-error', 'Tracker projection listener failed.', {
              error: error instanceof Error ? error.message : String(error),
            });
            this.#settleAfterListenerRejection?.();
          });
        }
      } catch (error) {
        this.#forceFullResynchronization = true;
        this.#diagnostics?.error?.('projection-listener-error', 'Tracker projection listener failed.', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    if (this.#releaseListenersAfterCommit) {
      this.#listeners.clear();
    }
  }
}

/** Creates an internal transactional projection renderer. */
function createTrackerProjectionRenderer(): TrackerProjectionRenderer {
  return new TrackerProjectionRenderer();
}

export type {
  TrackerProjectionCommit,
  TrackerProjectionDomain,
  TrackerProjectionListener,
  TrackerProjectionState,
  TrackerProjectionUnsubscribe,
};
export { TrackerProjectionRenderer, createTrackerProjectionRenderer };
