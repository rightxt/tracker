import {
  EVENT_NAME_VALUES,
  ORIENTATIONS,
  PLACEMENTS,
  TrackerConfigurationError,
  TrackerLifecycleError,
  assertCompleteTrackerConfigurationEnvelope,
  assertValidTrackerConfiguration,
  cloneTrackerConfiguration,
  isTrackerConfigurationObject,
  normalizeOptions,
  validateRules,
} from '@rightxt/tracker-core';
import { DATA_ATTRIBUTES, createTrackerProjectionIntegration } from '@rightxt/tracker-core/projection';

import type {
  TrackerConfigurationReplacement,
  TrackerEventName,
  TrackerEventPayloadMap,
  TrackerEventUnsubscribe,
  TrackerOperationParams,
  TrackerOptions,
  TrackerReadonlyOptions,
  TrackerReadonlyRule,
  TrackerRule,
  TrackerScrollRoot,
  TrackerSourceRoot,
  TrackerStats,
} from '@rightxt/tracker-core';
import type {
  TrackerElementView,
  TrackerItemView,
  TrackerProjectionCommit,
  TrackerProjectionIntegration,
  TrackerProjectionState,
  TrackerSelectionView,
} from '@rightxt/tracker-core/projection';

/** Element-specific alias for options that exclude the separate rules property. */
type TrackerElementOptions = TrackerOptions;

/**
 * `CustomEvent.detail` narrowed by the canonical Tracker event name used as
 * `CustomEvent.type`. `TrackerElement` dispatches these from the host itself;
 * see `addEventListener()`/`removeEventListener()` below.
 */
type TrackerElementEventMap = {
  [TEventName in TrackerEventName]: CustomEvent<TrackerEventPayloadMap[TEventName]>;
};

interface AppliedElementState {
  /** Attribute names applied by the previous projection commit. */
  attributes: Set<string>;
  /** CSS custom property names applied by the previous projection commit. */
  styleVars: Set<string>;
}

/** Element-owned state projected across accepted but not-yet-settled Core transactions. */
interface TrackerElementTransactionState {
  /** Property-backed options. */
  readonly options: Partial<TrackerElementOptions>;
  /** Property-backed rules. */
  readonly rules: readonly TrackerRule[];
  /** Represented scroll root. */
  readonly scrollRoot: TrackerScrollRoot | null | undefined;
  /** Source query root. */
  readonly sourceRoot: TrackerSourceRoot | null | undefined;
}

/** Call-time state projection for one Core-coordinated Element transaction. */
interface TrackerElementTransactionProjection {
  /** Applies this public operation's intent to a projected state. */
  readonly apply: (state: TrackerElementTransactionState) => TrackerElementTransactionState;
}

/**
 * One publicly accepted Element transaction awaiting host-ordered dispatch.
 *
 * A persistent host may outlive several Core runtime generations. Queuing at
 * this level, instead of handing every accepted transaction straight to
 * whichever runtime is current at acceptance time, keeps public acceptance
 * order intact even when a generation change happens while an earlier
 * transaction is still outstanding against the previous generation.
 */
interface TrackerElementHostTransaction {
  /** Diagnostic transaction name. */
  readonly name: string;
  /** Actual Element/Core transaction body. */
  readonly commit: () => void;
  /** Releases this transaction's call-time state projection. */
  readonly settleProjection: () => void;
}

/** Tracks previously applied DOM state so stale values can be removed. */
const appliedElementStates = new WeakMap<HTMLElement, AppliedElementState>();

/** Element-owned lifecycle diagnostic metadata. */
const ELEMENT_LIFECYCLE_DIAGNOSTIC = {
  code: 'element-lifecycle-error',
  type: 'error',
} as const;

/**
 * Native HTMLElement constructor, or a fallback that keeps module import safe without DOM globals.
 */
const TrackerElementBase: typeof HTMLElement =
  typeof HTMLElement === 'undefined' ? (class TrackerElementFallback {} as unknown as typeof HTMLElement) : HTMLElement;

/**
 * Runs one element-owned cleanup without preventing later cleanup steps.
 *
 * @param cleanup - Cleanup operation.
 * @param errors - Mutable error collection.
 */
function attemptElementCleanup(cleanup: () => void, errors: unknown[]): void {
  try {
    cleanup();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * Throws one lifecycle error directly or combines multiple failures.
 *
 * @param errors - Ordered lifecycle errors.
 * @param message - Aggregate error message.
 */
function throwElementLifecycleErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, message);
  }
}

/**
 * Validates and snapshots Element operation params at the original public call.
 *
 * @param params - Caller-owned operation params.
 * @returns Detached params with the same semantics.
 */
function snapshotElementOperationParams(
  params: TrackerOperationParams | undefined,
): TrackerOperationParams | undefined {
  if (params === undefined) {
    return undefined;
  }

  if (!isTrackerConfigurationObject(params)) {
    throw new TrackerConfigurationError('Tracker operation params must be a plain object.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  const unknownKey = Object.keys(params).find((key) => key !== 'render');

  if (unknownKey !== undefined) {
    throw new TrackerConfigurationError(`Unknown Tracker operation param "${unknownKey}".`, {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  if (!Object.hasOwn(params, 'render')) {
    return {};
  }

  const { render } = params;

  if (typeof render !== 'boolean') {
    throw new TrackerConfigurationError('Tracker operation params.render must be a boolean.', {
      code: 'ERR_TRACKER_INVALID_CONFIGURATION',
    });
  }

  return { render };
}

/**
 * Creates one reportable error from lifecycle and cleanup failures.
 *
 * @param errors - Ordered lifecycle errors.
 * @param message - Aggregate error message.
 * @returns Reportable lifecycle error, or `null` when no failure occurred.
 */
function createElementLifecycleError(errors: unknown[], message: string): unknown | null {
  if (errors.length === 1) {
    return errors[0];
  }

  return errors.length > 1 ? new AggregateError(errors, message) : null;
}

/**
 * Formats a lifecycle failure without invoking arbitrary object coercion.
 *
 * @param error - Reportable lifecycle failure.
 * @returns Safe diagnostic message.
 */
function getElementLifecycleErrorMessage(error: unknown): string {
  if (error === null) {
    return 'null';
  }

  switch (typeof error) {
    case 'string':
      return error;
    case 'undefined':
    case 'boolean':
    case 'bigint':
    case 'number':
    case 'symbol':
      return String(error);
    case 'object':
      try {
        return error instanceof Error && typeof error.message === 'string' ? error.message : 'Unknown error.';
      } catch {
        return 'Unknown error.';
      }
    default:
      return 'Unknown error.';
  }
}

/**
 * Applies element-view fields (className, attributes, styleVars) to a DOM element.
 *
 * @param el - Target element.
 * @param props - Projected element view.
 */
function applyElementProps(el: HTMLElement, props: TrackerElementView): void {
  const previousState = appliedElementStates.get(el) ?? {
    attributes: new Set<string>(),
    styleVars: new Set<string>(),
  };
  const nextAttributes = new Set(Object.keys(props.attributes));
  const nextStyleVars = new Set(Object.keys(props.styleVars));

  el.className = props.className;

  for (const key of previousState.attributes) {
    if (!nextAttributes.has(key)) {
      el.removeAttribute(key);
    }
  }

  for (const [key, value] of Object.entries(props.attributes)) {
    el.setAttribute(key, value);
  }

  for (const key of previousState.styleVars) {
    if (!nextStyleVars.has(key)) {
      el.style.removeProperty(key);
    }
  }

  for (const [key, value] of Object.entries(props.styleVars)) {
    el.style.setProperty(key, value);
  }

  appliedElementStates.set(el, {
    attributes: nextAttributes,
    styleVars: nextStyleVars,
  });
}

/**
 * Recursively freezes plain objects and arrays reachable from a value.
 *
 * Leaves a `diagnostics.output` sink completely untouched (not frozen, not
 * recursed into), matching the exemption Core's own
 * `freezeRendererOptions()` applies to that same field: it is documented
 * caller-owned state that may hold its own mutable `this`.
 */
function deepFreezeElementValue<T>(value: T, seen: Set<unknown> = new Set(), key?: string): T {
  if (key === 'output') {
    return value;
  }

  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => deepFreezeElementValue(item, seen));
    return Object.freeze(value);
  }

  if (isTrackerConfigurationObject(value)) {
    Object.entries(value).forEach(([entryKey, item]) => deepFreezeElementValue(item, seen, entryKey));
    return Object.freeze(value) as T;
  }

  return value;
}

/**
 * Custom Element that renders the RXT Tracker overlay in owned Light DOM.
 *
 * Runtime configuration is exposed through explicit methods. Host attributes
 * retain their normal DOM semantics. Runtime events use the standard
 * `EventTarget` API rather than custom `on()`/`off()` methods: each canonical
 * Core event name is dispatched as a matching component-scoped `CustomEvent`
 * whose `detail` carries the typed Core payload.
 *
 * @example
 * ```html
 * const tracker = document.querySelector('rxt-tracker');
 * tracker.replaceOptions({ orientation: 'vertical', placement: 'right' });
 * tracker.addEventListener('marker:activate', (event) => {
 *   console.log(event.detail.selector);
 * });
 * ```
 */
class TrackerElement extends TrackerElementBase {
  /** Tracker root element owned by this host, present while connected. */
  #rootEl: HTMLElement | null = null;

  /**
   * Root left attached after a failed `remove()`, retried by the next `#connectRuntime()`
   * before a replacement root is created.
   */
  #pendingRootRemoval: HTMLElement | null = null;

  /** Viewport element inside #rootEl. */
  #viewportEl: HTMLElement | null = null;

  /** Markers layer element inside #rootEl. */
  #markersLayerEl: HTMLElement | null = null;

  /** Backing projection integration runtime. `null` while disconnected. */
  #runtime: TrackerProjectionIntegration | null = null;

  /** Unsubscribe callback from projection commits. */
  #unsubscribe: (() => void) | null = null;

  /**
   * Internal per-generation Core subscriptions that forward each canonical
   * event as a host `CustomEvent`, keyed by event name.
   */
  #eventForwarderUnsubscribes: Partial<Record<TrackerEventName, TrackerEventUnsubscribe>> = {};

  /** Persistent options committed through the method API. */
  #propertyOptions: Partial<TrackerElementOptions> = {};

  /** Persistent rules committed through the method API. */
  #propertyRules: readonly TrackerRule[] = [];

  /** Core-normalized public rule snapshot kept in sync with #propertyRules, used by getRules(). */
  #normalizedPublicRules: readonly TrackerRule[] = [];

  /** Marker and cluster DOM nodes keyed by projection item key. */
  #itemElementsByKey = new Map<string, HTMLElement>();

  /** Selected key last applied to the owned marker nodes. */
  #selectedKey: string | null = null;

  /** Configured source root; null keeps the runtime unmounted. */
  #sourceRoot: TrackerSourceRoot | null | undefined;

  /** Configured scroll root; null keeps the runtime unmounted. */
  #scrollRoot: TrackerScrollRoot | null | undefined;

  /** Call-time projections for transactions already ordered by Core but not yet settled. */
  #pendingTransactionProjections: TrackerElementTransactionProjection[] = [];

  /** Host transactions accepted while an earlier one is still outstanding. */
  #pendingHostTransactions: TrackerElementHostTransaction[] = [];

  /** Whether a host transaction has been dispatched but not yet settled. */
  #hostTransactionInFlight = false;

  /** Reentrancy guard for `#advanceHostTransactionQueue()`. */
  #drainingHostTransactionQueue = false;

  /**
   * Remounts against destination-document defaults after connected adoption.
   */
  adoptedCallback(): void {
    if (this.#runtime === null || !this.isConnected) {
      return;
    }

    try {
      this.#remountRuntime();
    } catch (error) {
      this.#reportLifecycleErrors([error], 'TrackerElement adoption failed.');
    }
  }

  /**
   * Creates and mounts the element-owned runtime on first connection.
   *
   * Setup, mount, and rollback failures are reported through the configured
   * diagnostics output, with `console.error` as the fallback.
   */
  connectedCallback(): void {
    if (this.#runtime !== null) {
      return;
    }

    try {
      this.#connectRuntime();
    } catch (error) {
      const errors: unknown[] = [error];

      this.#releaseConnectedState(errors);
      this.#reportLifecycleErrors(errors, 'TrackerElement connection and rollback both failed.');
    }
  }

  /**
   * Releases the element-owned runtime and all runtime subscriptions.
   *
   * Cleanup failures are reported through the configured diagnostics output,
   * with `console.error` as the fallback.
   */
  disconnectedCallback(): void {
    const errors: unknown[] = [];

    this.#releaseConnectedState(errors);
    this.#reportLifecycleErrors(errors, 'TrackerElement disconnection failed in one or more cleanup steps.');
  }

  /** Source query root with adapter-only null reset semantics. */
  get sourceRoot(): TrackerSourceRoot | null | undefined {
    return this.#sourceRoot;
  }

  /**
   * Changes the source query root and remounts a connected runtime transactionally.
   * While disconnected, stores the value for validation during the next connection.
   *
   * @param value - Source root, page-mode default, or null unmounted state.
   * @throws Error when a connected remount fails; rollback failures are aggregated.
   */
  set sourceRoot(value: TrackerSourceRoot | null | undefined) {
    const apply = (state: TrackerElementTransactionState): TrackerElementTransactionState => ({
      ...state,
      sourceRoot: value,
    });

    if (Object.is(this.#getProjectedTransactionState().sourceRoot, value)) {
      return;
    }

    this.#assertProjectedMountRequestIsValid(apply(this.#getProjectedTransactionState()));

    this.#coordinateElementTransaction('change sourceRoot', apply, () => {
      const previousSourceRoot = this.#sourceRoot;

      if (Object.is(previousSourceRoot, value)) {
        return;
      }

      this.#sourceRoot = value;
      this.#applyMountContextChange(() => {
        this.#sourceRoot = previousSourceRoot;
      });
    });
  }

  /** Represented scroll root with adapter-only null reset semantics. */
  get scrollRoot(): TrackerScrollRoot | null | undefined {
    return this.#scrollRoot;
  }

  /**
   * Changes the represented scroll root and remounts a connected runtime transactionally.
   * While disconnected, stores the value for validation during the next connection.
   *
   * @param value - Scroll root, page-mode default, or null unmounted state.
   * @throws Error when a connected remount fails; rollback failures are aggregated.
   */
  set scrollRoot(value: TrackerScrollRoot | null | undefined) {
    const apply = (state: TrackerElementTransactionState): TrackerElementTransactionState => ({
      ...state,
      scrollRoot: value,
    });

    if (Object.is(this.#getProjectedTransactionState().scrollRoot, value)) {
      return;
    }

    this.#assertProjectedMountRequestIsValid(apply(this.#getProjectedTransactionState()));

    this.#coordinateElementTransaction('change scrollRoot', apply, () => {
      const previousScrollRoot = this.#scrollRoot;

      if (Object.is(previousScrollRoot, value)) {
        return;
      }

      this.#scrollRoot = value;
      this.#applyMountContextChange(() => {
        this.#scrollRoot = previousScrollRoot;
      });
    });
  }

  /**
   * Returns a diagnostics stats snapshot.
   *
   * @returns Current stats, or `null` while the element is disconnected.
   */
  getStats(): TrackerStats | null {
    return this.#runtime?.getStats() ?? null;
  }

  /** Requests immediate synchronization while the element is connected. */
  render(): void;
  render(...args: unknown[]): void {
    if (this.#runtime === null) {
      throw new TrackerLifecycleError('Cannot render a disconnected TrackerElement.', {
        code: 'ERR_TRACKER_INVALID_CONTEXT',
      });
    }

    if (args.length > 0) {
      throw new TypeError('Tracker.render() does not accept arguments.');
    }

    this.#runtime.render();
  }

  /** Schedules and coalesces a full render while connected. */
  requestRender(): void {
    if (this.#runtime === null) {
      throw new TrackerLifecycleError('Cannot request a render from a disconnected TrackerElement.', {
        code: 'ERR_TRACKER_INVALID_CONTEXT',
      });
    }

    this.#runtime.requestRender();
  }

  /** Resets diagnostics counters while the element is connected. */
  resetStats(): void {
    this.#runtime?.resetStats();
  }

  /**
   * Replaces property-backed options from defaults.
   *
   * @param value - Partial options patch.
   * @throws TypeError when the value is not a plain object or contains an own rules property.
   * @throws TrackerConfigurationError when the combined Tracker configuration is invalid.
   */
  replaceOptions(value: Partial<TrackerElementOptions>, params?: TrackerOperationParams): void {
    if (!isTrackerConfigurationObject(value)) {
      throw new TypeError('TrackerElement replaceOptions() expects a plain object.');
    }

    if (Object.hasOwn(value, 'rules')) {
      throw new TypeError('TrackerElement rules must be passed to replaceRules() or replaceConfiguration().');
    }

    const detachedValue = cloneTrackerConfiguration({ options: value }).options as Partial<TrackerElementOptions>;
    const paramsSnapshot = snapshotElementOperationParams(params);
    const apply = (state: TrackerElementTransactionState): TrackerElementTransactionState => ({
      ...state,
      options: normalizeOptions(detachedValue, { baseOptions: {} }) as Partial<TrackerElementOptions>,
    });
    const projectedState = apply(this.#getProjectedTransactionState());

    this.#assertValidConfiguration(projectedState.options, projectedState.rules);
    this.#assertRuntimeConfigurationIsValid(projectedState.options, projectedState.rules, paramsSnapshot);

    this.#coordinateElementTransaction('replace options', apply, () => {
      const nextState = apply(this.#getCommittedTransactionState());

      this.#assertValidConfiguration(nextState.options, nextState.rules);
      this.#replacePropertyConfiguration(nextState.options, nextState.rules, paramsSnapshot);
    });
  }

  /** Applies a strict deep patch to committed options. */
  patchOptions(value: Partial<TrackerElementOptions>, params?: TrackerOperationParams): void {
    if (!isTrackerConfigurationObject(value) || Object.hasOwn(value, 'rules')) {
      throw new TypeError('TrackerElement patchOptions() expects a plain options object.');
    }

    const detachedValue = cloneTrackerConfiguration({ options: value }).options as Partial<TrackerElementOptions>;
    const paramsSnapshot = snapshotElementOperationParams(params);
    const apply = (state: TrackerElementTransactionState): TrackerElementTransactionState => ({
      ...state,
      options: normalizeOptions(detachedValue, {
        baseOptions: state.options,
      }) as Partial<TrackerElementOptions>,
    });
    const projectedState = apply(this.#getProjectedTransactionState());

    this.#assertValidConfiguration(projectedState.options, projectedState.rules);
    this.#assertRuntimeConfigurationIsValid(projectedState.options, projectedState.rules, paramsSnapshot);

    this.#coordinateElementTransaction('patch options', apply, () => {
      const nextState = apply(this.#getCommittedTransactionState());

      this.#assertValidConfiguration(nextState.options, nextState.rules);
      this.#replacePropertyConfiguration(nextState.options, nextState.rules, paramsSnapshot);
    });
  }

  /** Replaces the complete committed rule list. */
  replaceRules(value: readonly TrackerRule[], params?: TrackerOperationParams): void {
    if (!Array.isArray(value)) {
      throw new TypeError('TrackerElement replaceRules() expects an array.');
    }

    const nextRules = cloneTrackerConfiguration({ rules: value }).rules!;
    const paramsSnapshot = snapshotElementOperationParams(params);
    const apply = (state: TrackerElementTransactionState): TrackerElementTransactionState => ({
      ...state,
      rules: nextRules,
    });
    const projectedState = apply(this.#getProjectedTransactionState());

    this.#assertValidConfiguration(projectedState.options, projectedState.rules);
    this.#assertRuntimeConfigurationIsValid(projectedState.options, projectedState.rules, paramsSnapshot);

    this.#coordinateElementTransaction('replace rules', apply, () => {
      const nextState = apply(this.#getCommittedTransactionState());

      this.#assertValidConfiguration(nextState.options, nextState.rules);
      this.#replacePropertyConfiguration(nextState.options, nextState.rules, paramsSnapshot);
    });
  }

  /**
   * Atomically replaces committed options and rules.
   *
   * @throws TrackerConfigurationError when `configuration` omits an own `options` or `rules`
   *   field, since a partial replacement would silently reset the omitted channel to its
   *   default instead of leaving it untouched.
   */
  replaceConfiguration(configuration: TrackerConfigurationReplacement, params?: TrackerOperationParams): void {
    assertCompleteTrackerConfigurationEnvelope(configuration);
    assertValidTrackerConfiguration(configuration);
    const detachedConfiguration = cloneTrackerConfiguration(configuration);
    const paramsSnapshot = snapshotElementOperationParams(params);
    const nextOptions = normalizeOptions(detachedConfiguration.options, {
      baseOptions: {},
    }) as Partial<TrackerElementOptions>;
    const nextRules = detachedConfiguration.rules;
    const apply = (state: TrackerElementTransactionState): TrackerElementTransactionState => ({
      ...state,
      options: nextOptions,
      rules: nextRules,
    });

    this.#assertRuntimeConfigurationIsValid(nextOptions, nextRules, paramsSnapshot);

    this.#coordinateElementTransaction('replace configuration', apply, () => {
      assertValidTrackerConfiguration(detachedConfiguration);
      this.#replacePropertyConfiguration(nextOptions, nextRules, paramsSnapshot);
    });
  }

  /**
   * Returns an immutable copy of normalized committed options.
   *
   * The committed view is complete even before the element is connected: stored
   * property options are rejected by `#assertValidConfiguration()` unless they
   * pass Core validation, and `normalizeOptions()` without a context merges them
   * over the Core defaults. Every committed branch is therefore present, which is
   * what the `TrackerReadonlyOptions` assertion claims.
   *
   * @returns Deeply frozen committed options.
   */
  getOptions(): TrackerReadonlyOptions {
    const options = normalizeOptions(this.#propertyOptions);

    // Property options were already accepted by Core at write time. Apply the
    // same orientation-specific fallback here without revalidating a
    // caller-owned diagnostics sink, whose accessors may intentionally throw.
    options.placement =
      options.orientation === ORIENTATIONS.HORIZONTAL
        ? options.placement === PLACEMENTS.BOTTOM
          ? PLACEMENTS.BOTTOM
          : PLACEMENTS.TOP
        : options.placement === PLACEMENTS.RIGHT
          ? PLACEMENTS.RIGHT
          : PLACEMENTS.LEFT;

    return deepFreezeElementValue(cloneTrackerConfiguration({ options }).options!) as TrackerReadonlyOptions;
  }

  /** Returns immutable copies of committed rules, normalized the same way as Core's accessors. */
  getRules(): readonly TrackerReadonlyRule[] {
    return deepFreezeElementValue(
      cloneTrackerConfiguration({ rules: this.#normalizedPublicRules }).rules!,
    ) as readonly TrackerReadonlyRule[];
  }

  /**
   * Creates the complete connected runtime state and mounts it when roots are available.
   *
   * Retries detaching a root left behind by a previously failed removal before creating
   * a replacement, so a transient `remove()` failure cannot leave two `.rxtt` roots
   * attached after a disconnect/reconnect (e.g. a same-document move).
   *
   * The caller owns rollback if any setup step fails, including a retried detachment
   * that fails again.
   */
  #connectRuntime(): void {
    this.#reconcilePendingRootRemoval();

    this.#rootEl = this.ownerDocument.createElement('div');
    this.#viewportEl = this.ownerDocument.createElement('div');
    this.#markersLayerEl = this.ownerDocument.createElement('div');

    // The markers layer must be a sibling of the viewport: rxt-tracker.css positions
    // `.rxtt__markers` against the root, and DomRenderer uses the same structure.
    this.#rootEl.append(this.#viewportEl, this.#markersLayerEl);
    this.appendChild(this.#rootEl);

    this.#runtime = createTrackerProjectionIntegration(this.#buildConfiguration());
    this.#unsubscribe = this.#runtime.subscribeProjection((commit) => this.#renderProjectionCommit(commit));
    this.#attachEventForwarders(this.#runtime);

    this.#renderProjectionState(this.#runtime.getProjection());
    this.#mountRuntime();
  }

  /**
   * Attaches one internal Core subscription per canonical event name for the
   * given runtime generation, each dispatching a matching host `CustomEvent`.
   *
   * @param runtime - Runtime generation to forward events from.
   */
  #attachEventForwarders(runtime: TrackerProjectionIntegration): void {
    this.#eventForwarderUnsubscribes = {};

    EVENT_NAME_VALUES.forEach((eventName) => {
      this.#eventForwarderUnsubscribes[eventName] = runtime.on(eventName, (payload) => {
        this.#dispatchTrackerEvent(eventName, payload);
      });
    });
  }

  /**
   * Dispatches one canonical Tracker event synchronously as a local,
   * non-composed, non-cancelable `CustomEvent` from this host.
   *
   * @param eventName - Canonical Core event name, used unchanged as `CustomEvent.type`.
   * @param detail - Typed Core payload, passed unchanged as `CustomEvent.detail`.
   */
  #dispatchTrackerEvent<TEventName extends TrackerEventName>(
    eventName: TEventName,
    detail: TrackerEventPayloadMap[TEventName],
  ): void {
    const CustomEventConstructor = this.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;

    this.dispatchEvent(
      new CustomEventConstructor(eventName, { detail, bubbles: false, cancelable: false, composed: false }),
    );
  }

  /**
   * Registers one Element projection and hands it to the host-ordered transaction
   * gate, which owns *when* it is dispatched to whichever Core runtime generation
   * is current, keeping public acceptance order across a mid-flight generation
   * change (see `#dispatchHostTransaction()`).
   *
   * @param name - Diagnostic transaction name.
   * @param apply - Call-time state projection used by later accepted operations.
   * @param commit - Actual Element/Core transaction body.
   */
  #coordinateElementTransaction(
    name: string,
    apply: TrackerElementTransactionProjection['apply'],
    commit: () => void,
  ): void {
    const projection: TrackerElementTransactionProjection = { apply };

    this.#pendingTransactionProjections.push(projection);

    const entry: TrackerElementHostTransaction = {
      name,
      commit,
      settleProjection: () => {
        const index = this.#pendingTransactionProjections.indexOf(projection);

        if (index !== -1) {
          this.#pendingTransactionProjections.splice(index, 1);
        }
      },
    };

    if (this.#hostTransactionInFlight || this.#drainingHostTransactionQueue) {
      this.#pendingHostTransactions.push(entry);
      return;
    }

    this.#dispatchHostTransaction(entry, false);
  }

  /**
   * Dispatches one host-ordered transaction against whichever Core runtime
   * generation is current at this exact moment - re-read here, not captured when
   * the transaction was accepted - so a retired generation's own commit can never
   * reach a replacement generation through a stale closure over `this.#runtime`.
   *
   * @param entry - Host transaction to dispatch.
   * @param reentrant - Whether this dispatch originates from
   *   `#advanceHostTransactionQueue()` rather than directly from
   *   `#coordinateElementTransaction()`. A reentrant dispatch has no caller left
   *   to receive a synchronous throw, so a failure is reported through
   *   `#reportLifecycleErrors()` instead; the original, uncontended call keeps
   *   today's synchronous throw-to-caller contract unchanged.
   */
  #dispatchHostTransaction(entry: TrackerElementHostTransaction, reentrant: boolean): void {
    this.#hostTransactionInFlight = true;

    const runtime = this.#runtime;
    const settle = (): void => {
      entry.settleProjection();
      this.#hostTransactionInFlight = false;
      this.#advanceHostTransactionQueue();
    };

    if (runtime === null) {
      try {
        entry.commit();
      } catch (error) {
        if (!reentrant) {
          throw error;
        }

        this.#reportLifecycleErrors([error], `TrackerElement host transaction "${entry.name}" failed.`);
      } finally {
        settle();
      }

      return;
    }

    if (!reentrant) {
      runtime.coordinateAdapterTransaction({ name: entry.name, run: entry.commit, settle });
      return;
    }

    try {
      runtime.coordinateAdapterTransaction({ name: entry.name, run: entry.commit, settle });
    } catch (error) {
      this.#reportLifecycleErrors([error], `TrackerElement host transaction "${entry.name}" failed.`);
    }
  }

  /**
   * Iteratively drains host transactions accepted while an earlier one was
   * outstanding, dispatching each in turn once the host is free.
   *
   * Uses an explicit `while` loop guarded by `#drainingHostTransactionQueue`
   * instead of letting each dispatch's `settle` recursively call back into this
   * method: a synchronously-resolved chain of several queued transactions then
   * drains flat, with stack growth bounded by genuine Core-level deferrals
   * rather than by the number of host-accepted transactions.
   */
  #advanceHostTransactionQueue(): void {
    if (this.#drainingHostTransactionQueue) {
      return;
    }

    this.#drainingHostTransactionQueue = true;

    try {
      while (!this.#hostTransactionInFlight) {
        const next = this.#pendingHostTransactions.shift();

        if (next === undefined) {
          return;
        }

        this.#dispatchHostTransaction(next, true);
      }
    } finally {
      this.#drainingHostTransactionQueue = false;
    }
  }

  /** Returns the currently committed Element-owned transaction state. */
  #getCommittedTransactionState(): TrackerElementTransactionState {
    return {
      options: this.#propertyOptions,
      rules: this.#propertyRules,
      scrollRoot: this.#scrollRoot,
      sourceRoot: this.#sourceRoot,
    };
  }

  /** Returns committed state with every accepted pending intent projected in Core FIFO order. */
  #getProjectedTransactionState(): TrackerElementTransactionState {
    return this.#pendingTransactionProjections.reduce(
      (state, projection) => projection.apply(state),
      this.#getCommittedTransactionState(),
    );
  }

  /** Validates a connected projected root candidate at the original property call. */
  #assertProjectedMountRequestIsValid(state: TrackerElementTransactionState): void {
    if (this.#runtime === null || this.#rootEl === null || state.sourceRoot === null || state.scrollRoot === null) {
      return;
    }

    this.#runtime.assertMountRequest({
      ...(state.sourceRoot === undefined ? {} : { sourceRoot: state.sourceRoot }),
      ...(state.scrollRoot === undefined ? {} : { scrollRoot: state.scrollRoot }),
      renderRoot: this.#rootEl,
    });
  }

  /**
   * Applies a root identity change and restores the previous mounted context on failure.
   *
   * @param restoreRoot - Restores the changed root property.
   */
  #applyMountContextChange(restoreRoot: () => void): void {
    if (this.#runtime === null) {
      if (!this.isConnected) {
        return;
      }

      try {
        this.#connectRuntime();
      } catch (error) {
        const errors: unknown[] = [error];

        this.#releaseConnectedState(errors);
        restoreRoot();
        throwElementLifecycleErrors(errors, 'TrackerElement root update and connection rollback both failed.');
      }

      return;
    }

    const wasMounted = this.#runtime?.isMounted() ?? false;

    try {
      this.#remountRuntime();
    } catch (error) {
      const errors: unknown[] = [error];

      restoreRoot();

      if (wasMounted && this.#runtime !== null && !this.#runtime.isMounted()) {
        attemptElementCleanup(() => this.#mountRuntime(), errors);
      }

      throwElementLifecycleErrors(errors, 'TrackerElement root update and rollback both failed.');
    }
  }

  /**
   * Replaces property-backed configuration and rolls back both stores on failure.
   *
   * @param options - Proposed non-rule options.
   * @param rules - Proposed rules.
   * @param params - Operation parameters.
   */
  #replacePropertyConfiguration(
    options: Partial<TrackerElementOptions>,
    rules: readonly TrackerRule[],
    params?: TrackerOperationParams,
  ): void {
    const previousOptions = this.#propertyOptions;
    const previousRules = this.#propertyRules;
    const previousNormalizedPublicRules = this.#normalizedPublicRules;

    this.#propertyOptions = options;
    this.#propertyRules = rules;
    // getRules() must return the same normalized public representation Core computes
    // from committed rules, kept available even while disconnected, so it is derived
    // here rather than from a live runtime.
    this.#normalizedPublicRules = validateRules(rules).rules.map((rule) =>
      cloneTrackerConfiguration({ rules: [rule.source] }).rules!.at(0)!,
    ) as readonly TrackerRule[];

    try {
      this.#syncRuntimeConfiguration(params);
    } catch (error) {
      const errors: unknown[] = [error];

      this.#propertyOptions = previousOptions;
      this.#propertyRules = previousRules;
      this.#normalizedPublicRules = previousNormalizedPublicRules;

      if (this.#runtime !== null) {
        attemptElementCleanup(() => this.#runtime!.replaceConfiguration(this.#buildConfiguration()), errors);
      }

      throwElementLifecycleErrors(errors, 'TrackerElement configuration update and rollback both failed.');
    }
  }

  /**
   * Reports lifecycle-reaction failures without throwing from a browser-owned callback.
   * Error formatting, sink resolution/invocation and console fallback are all
   * isolated so reporting cannot abort an active host-transaction drain.
   *
   * @param errors - Ordered lifecycle errors.
   * @param message - Aggregate error message.
   */
  #reportLifecycleErrors(errors: unknown[], message: string): void {
    const error = createElementLifecycleError(errors, message);

    if (error === null) {
      return;
    }

    const details = { error: getElementLifecycleErrorMessage(error) };

    try {
      const output = this.#propertyOptions.diagnostics?.output;
      const reportError = output?.error;

      if (typeof reportError === 'function') {
        reportError.call(output, ELEMENT_LIFECYCLE_DIAGNOSTIC.code, message, details);
        return;
      }
    } catch {
      // A failing user sink must not escape through a Custom Element reaction.
    }

    try {
      this.ownerDocument.defaultView?.console.error(message, details);
    } catch {
      // Browser-owned lifecycle reactions have no reliable fallback error channel.
    }
  }

  /**
   * Releases runtime, subscriptions and rendered DOM while preserving all cleanup errors.
   *
   * @param errors - Mutable error collection.
   */
  #releaseConnectedState(errors: unknown[]): void {
    const projectionUnsubscribe = this.#unsubscribe;

    this.#unsubscribe = null;

    if (projectionUnsubscribe !== null) {
      attemptElementCleanup(projectionUnsubscribe, errors);
    }

    if (this.#runtime !== null) {
      attemptElementCleanup(() => this.#runtime!.destroy(), errors);
    }

    // The `destroy` forwarder is left attached: a reentrant destroy triggered
    // from a sync:start listener defers the actual runtime.destroy() call
    // until the render operation settles (see coordinateTrackerOperation()),
    // so detaching it eagerly here would drop that terminal CustomEvent.
    EVENT_NAME_VALUES.forEach((eventName) => {
      if (eventName === 'destroy') {
        return;
      }

      const unsubscribe = this.#eventForwarderUnsubscribes[eventName];

      delete this.#eventForwarderUnsubscribes[eventName];

      if (unsubscribe) {
        attemptElementCleanup(unsubscribe, errors);
      }
    });

    this.#runtime = null;
    this.#markersLayerEl = null;
    this.#viewportEl = null;
    this.#itemElementsByKey.clear();
    this.#selectedKey = null;

    const root = this.#rootEl;

    this.#rootEl = null;

    if (root !== null) {
      this.#detachRoot(root, errors);
    }
  }

  /**
   * Retries detaching a root left behind by a previously failed removal.
   *
   * @throws The retried `remove()` failure. `#pendingRootRemoval` is left untouched so a
   *   later retry can still recover the same node.
   */
  #reconcilePendingRootRemoval(): void {
    const pendingRoot = this.#pendingRootRemoval;

    if (pendingRoot === null) {
      return;
    }

    pendingRoot.remove();
    this.#pendingRootRemoval = null;
  }

  /**
   * Detaches a root element, tracking a removal failure for retry.
   *
   * A `remove()` failure leaves the node attached but ownerless. The node is kept in
   * `#pendingRootRemoval` so the next `#connectRuntime()` retries detaching it before
   * creating a replacement root, preventing a duplicate `.rxtt` root.
   *
   * @param root - Root element to detach.
   * @param errors - Mutable error collection.
   */
  #detachRoot(root: HTMLElement, errors: unknown[]): void {
    try {
      root.remove();
    } catch (error) {
      this.#pendingRootRemoval = root;
      errors.push(error);
    }
  }

  /** Mounts the runtime against the actual owned Light DOM track root. */
  #mountRuntime(): void {
    if (!this.#runtime || !this.#rootEl) {
      return;
    }

    if (this.#sourceRoot === null || this.#scrollRoot === null) {
      return;
    }

    this.#runtime.mount({
      ...(this.#sourceRoot === undefined ? {} : { sourceRoot: this.#sourceRoot }),
      ...(this.#scrollRoot === undefined ? {} : { scrollRoot: this.#scrollRoot }),
      renderRoot: this.#rootEl,
    });
  }

  /** Remounts the runtime after a DOM-reference change. */
  #remountRuntime(): void {
    if (!this.#runtime) {
      return;
    }

    if (this.#runtime.isMounted()) {
      this.#runtime.unmount();
    }

    this.#mountRuntime();
  }

  /**
   * Applies the current merged options to the runtime.
   *
   * Core reconciles observers and interaction without changing DOM identities.
   */
  #syncRuntimeConfiguration(params?: TrackerOperationParams): void {
    if (!this.#runtime) {
      if (!this.isConnected) {
        return;
      }

      try {
        this.#connectRuntime();
      } catch (error) {
        const errors: unknown[] = [error];

        this.#releaseConnectedState(errors);
        throwElementLifecycleErrors(errors, 'TrackerElement connection and rollback both failed.');
      }

      return;
    }

    this.#runtime.replaceConfiguration(this.#buildConfiguration(), params);

    if (params?.render !== false && this.#runtime.isMounted()) {
      this.#runtime.flushRender();
    }

    if (!this.#runtime.isMounted()) {
      this.#mountRuntime();
    }

    // Core schedules the narrow render target selected from the options diff.
    // Consumers can call render() when they explicitly need a synchronous flush.
  }

  /** Returns the property-backed Tracker options. */
  #buildConfiguration(): TrackerConfigurationReplacement {
    return cloneTrackerConfiguration({
      options: this.#propertyOptions,
      rules: this.#propertyRules,
    }) as TrackerConfigurationReplacement;
  }

  /** Rejects a complete proposed configuration before it can affect element or runtime state. */
  #assertValidConfiguration(options: Partial<TrackerElementOptions>, rules: readonly TrackerRule[]): void {
    assertValidTrackerConfiguration({ options, rules });
  }

  /** Prevalidates a complete candidate against the connected Core context. */
  #assertRuntimeConfigurationIsValid(
    options: Partial<TrackerElementOptions>,
    rules: readonly TrackerRule[],
    params: TrackerOperationParams | undefined,
  ): void {
    this.#runtime?.assertConfigurationReplacement({ options, rules }, params);
  }

  /** Applies every domain from one coherent projection state. */
  #renderProjectionState(state: TrackerProjectionState): void {
    if (!this.#rootEl || !this.#viewportEl || !this.#markersLayerEl) {
      return;
    }

    applyElementProps(this.#rootEl, state.chrome.root);
    applyElementProps(this.#viewportEl, state.viewport);
    this.#viewportEl.hidden = state.viewport.hidden;
    applyElementProps(this.#markersLayerEl, state.chrome.markersLayer);
    this.#markersLayerEl.hidden = state.chrome.markersLayer.hidden;
    this.#reconcileItems(state.items);
    this.#applySelection({ previousKey: this.#selectedKey, selectedKey: state.selection.selectedKey });
  }

  /** Applies only domains changed by one transactional projection commit. */
  #renderProjectionCommit(commit: TrackerProjectionCommit): void {
    if (!this.#rootEl || !this.#viewportEl || !this.#markersLayerEl) {
      return;
    }

    const changed = new Set(commit.changed);
    const state = commit.state;

    if (changed.has('chrome')) {
      applyElementProps(this.#rootEl, state.chrome.root);
      applyElementProps(this.#markersLayerEl, state.chrome.markersLayer);
      this.#markersLayerEl.hidden = state.chrome.markersLayer.hidden;
    }

    if (changed.has('viewport')) {
      applyElementProps(this.#viewportEl, state.viewport);
      this.#viewportEl.hidden = state.viewport.hidden;
    }

    if (changed.has('items')) {
      this.#reconcileItems(state.items);
    }

    if (changed.has('selection') || changed.has('items')) {
      this.#applySelection(state.selection);
    }
  }

  /**
   * Reconciles the markers layer DOM against the current projection items.
   *
   * Uses `data-rxtt-key` for identity to minimize DOM churn. DOM order follows
   * the projection item order, matching the Core renderer contract.
   *
   * @param items - Current projected item views.
   */
  #reconcileItems(items: readonly TrackerItemView[]): void {
    if (!this.#markersLayerEl) {
      return;
    }

    const nextKeys = new Set(items.map((item) => item.key));

    this.#itemElementsByKey.forEach((element, key) => {
      if (!nextKeys.has(key)) {
        element.remove();
        this.#itemElementsByKey.delete(key);
      }
    });

    let cursor = this.#markersLayerEl.firstElementChild;

    for (const item of items) {
      let el = this.#itemElementsByKey.get(item.key) ?? null;

      if (!el) {
        el = this.ownerDocument.createElement('div');
        this.#itemElementsByKey.set(item.key, el);
      }

      applyElementProps(el, item);

      if (!el.hasAttribute(DATA_ATTRIBUTES.KEY)) {
        el.setAttribute(DATA_ATTRIBUTES.KEY, item.key);
      }

      if (el !== cursor) {
        this.#markersLayerEl.insertBefore(el, cursor);
      }

      cursor = el.nextElementSibling;
    }
  }

  /** Applies an isolated keyed selection transition. */
  #applySelection(selection: TrackerSelectionView): void {
    if (selection.previousKey !== null) {
      this.#itemElementsByKey.get(selection.previousKey)?.removeAttribute(DATA_ATTRIBUTES.SELECTED);
    }

    if (selection.selectedKey !== null) {
      this.#itemElementsByKey.get(selection.selectedKey)?.setAttribute(DATA_ATTRIBUTES.SELECTED, 'true');
    }

    this.#selectedKey = selection.selectedKey;
  }

  /**
   * Registers a listener for a canonical Tracker event, narrowing `event.detail`
   * to its typed Core payload. Ordinary DOM event listening is unaffected.
   */
  addEventListener<TEventName extends keyof TrackerElementEventMap>(
    type: TEventName,
    listener: (event: TrackerElementEventMap[TEventName]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  /**
   * Removes a listener for a canonical Tracker event, narrowing `event.detail`
   * to its typed Core payload. Ordinary DOM event listening is unaffected.
   */
  removeEventListener<TEventName extends keyof TrackerElementEventMap>(
    type: TEventName,
    listener: (event: TrackerElementEventMap[TEventName]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }
}

export { TrackerElement };
export type { TrackerElementEventMap, TrackerElementOptions };
