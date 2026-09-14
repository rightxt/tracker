import { EVENT_NAME_VALUES, TrackerConfigurationError, TrackerLifecycleError } from '@rightxt/tracker-core';
import { createTrackerRendererIntegration } from '@rightxt/tracker-core/renderer';
import type {
  TrackerAddRuleParams,
  TrackerConfiguration,
  TrackerConfigurationReplacement,
  TrackerEventName,
  TrackerEventUnsubscribe,
  TrackerOperationParams,
  TrackerOptions,
  TrackerReadonlyOptions,
  TrackerReadonlyRule,
  TrackerRule,
  TrackerScrollRoot,
  TrackerSnapshot,
  TrackerSnapshotListener,
  TrackerSnapshotUnsubscribe,
  TrackerSourceRoot,
  TrackerState,
  TrackerStats,
  TrackerTypedEventHandler,
} from '@rightxt/tracker-core';
import type {
  TrackerRendererIntegration,
  TrackerRendererIntegrationMountRequest,
} from '@rightxt/tracker-core/renderer';
import { DomRenderer } from '../render/DomRenderer.js';
import { PublicEventDispatcher } from './PublicEventDispatcher.js';

/** Compile-time package version embedded in Vanilla builds. */
declare const __RXT_TRACKER_VERSION__: string;

const OBJECT_TO_STRING = Object.prototype.toString;
const FUNCTION_TO_STRING = Function.prototype.toString;
const NATIVE_OBJECT_SOURCE = FUNCTION_TO_STRING.call(Object);

/** Explicit Vanilla mounting identities and renderer host. */
interface TrackerVanillaMountRequest {
  /** Source query root. Defaults from the normalized scroll mode. */
  sourceRoot?: TrackerSourceRoot | undefined;
  /** Represented page or element viewport. */
  scrollRoot?: TrackerScrollRoot | undefined;
  /** Host receiving renderer-owned output. Required in element mode. */
  renderHost?: HTMLElement | undefined;
}

/**
 * Returns the document implied by one explicit DOM reference.
 *
 * @param value - Window, Document, Element, or ShadowRoot candidate.
 * @returns Implied document or null.
 */
function getRequestDocument(value: unknown): Document | null {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return null;
  }

  try {
    if ((value as { nodeType?: unknown }).nodeType === 9) {
      return value as Document;
    }

    const ownerDocument = (value as { ownerDocument?: unknown }).ownerDocument;

    if (ownerDocument !== null && typeof ownerDocument === 'object') {
      return ownerDocument as Document;
    }

    const windowDocument = (value as { document?: unknown }).document;

    return windowDocument !== null && typeof windowDocument === 'object' ? (windowDocument as Document) : null;
  } catch {
    return null;
  }
}

/**
 * Checks whether a value is a plain object.
 *
 * Arrays, functions, DOM nodes, class instances and built-in objects are not
 * treated as plain objects. Duplicated locally instead of importing from
 * `@rightxt/tracker-core/renderer` so the Vanilla Tracker facade stays decoupled
 * from renderer-layer code (enforced by the project's import boundaries).
 *
 * @param value - Value to check.
 * @returns True when the value is a plain object.
 */
function isPlainMountRequest(value: unknown): value is Record<string, unknown> {
  try {
    if (OBJECT_TO_STRING.call(value) !== '[object Object]') {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);

    if (prototype === null) {
      return true;
    }

    const constructor = (prototype as { constructor?: unknown }).constructor;

    return typeof constructor === 'function' && FUNCTION_TO_STRING.call(constructor) === NATIVE_OBJECT_SOURCE;
  } catch {
    return false;
  }
}

/**
 * Converts the Vanilla request into the advanced renderer-target request.
 *
 * @param request - Optional public Vanilla request.
 * @returns Explicit integration request.
 * @throws TrackerConfigurationError when no host can be resolved or element mode omits it.
 */
function createVanillaIntegrationMountRequest(
  request: TrackerVanillaMountRequest = {},
): TrackerRendererIntegrationMountRequest {
  if (!isPlainMountRequest(request)) {
    throw new TrackerConfigurationError('Tracker mount request must be an object.', {
      code: 'ERR_TRACKER_INVALID_CONTEXT',
    });
  }

  // isPlainMountRequest() only verifies plain-object-ness; TypeScript narrows
  // request's type to its guard type (Record<string, unknown>) rather than
  // intersecting it with TrackerVanillaMountRequest, so the original field types
  // must be restored explicitly. The actual field shapes are validated further
  // down this pipeline.
  const { sourceRoot, scrollRoot, renderHost } = request as TrackerVanillaMountRequest;

  if (sourceRoot === null || scrollRoot === null || renderHost === null) {
    throw new TrackerConfigurationError('Tracker Vanilla mount request does not accept null roots.', {
      code: 'ERR_TRACKER_INVALID_CONTEXT',
    });
  }

  const requestDocument =
    getRequestDocument(renderHost) ??
    getRequestDocument(scrollRoot) ??
    getRequestDocument(sourceRoot) ??
    (typeof document === 'undefined' ? null : document);
  const elementScrollRoot =
    scrollRoot !== undefined &&
    getRequestDocument(scrollRoot) !== null &&
    scrollRoot !== requestDocument?.defaultView &&
    scrollRoot !== requestDocument?.body &&
    scrollRoot !== requestDocument?.documentElement &&
    scrollRoot !== requestDocument?.scrollingElement;

  if (elementScrollRoot && renderHost === undefined) {
    throw new TrackerConfigurationError('Vanilla element mode requires an explicit renderHost.', {
      code: 'ERR_TRACKER_INVALID_CONTEXT',
    });
  }

  const host = renderHost ?? requestDocument?.body ?? null;

  if (host === null) {
    throw new TrackerConfigurationError(
      'Tracker could not resolve the default renderHost because document.body is unavailable. Wait for DOM readiness or pass an explicit renderHost.',
      {
        code: 'ERR_TRACKER_INVALID_CONTEXT',
      },
    );
  }

  return {
    sourceRoot,
    scrollRoot,
    rendererTarget: { kind: 'host', host },
  };
}

/**
 * Public Tracker facade.
 *
 * Tracker coordinates configuration, rules, query, marker records, layout,
 * clustering, rendering, observers, interaction, events and diagnostics.
 */
class Tracker {
  /** Vanilla-owned application notification boundary. */
  readonly #events = new PublicEventDispatcher();

  /** Opaque Core runtime owned by this facade. */
  #integration: TrackerRendererIntegration;

  /**
   * @param configuration - Initial options and rules.
   */
  constructor(configuration: TrackerConfiguration = {}) {
    this.#integration = createTrackerRendererIntegration(configuration, {
      renderer: new DomRenderer(),
    });

    EVENT_NAME_VALUES.forEach((eventName) => {
      this.#integration.on(eventName, (payload) => {
        this.#events.emit(eventName, payload);

        if (eventName === 'destroy') {
          this.#events.clear();
        }
      });
    });
  }

  /**
   * Indicates whether this Tracker instance has been permanently destroyed.
   *
   * @returns True when destroyed.
   */
  get destroyed(): boolean {
    return this.#integration.isDestroyed();
  }

  /**
   * Indicates whether this Tracker instance is mounted.
   *
   * @returns True when mounted.
   */
  get mounted(): boolean {
    return this.#integration.isMounted();
  }

  /** Current public lifecycle state. */
  get state(): TrackerState {
    if (this.destroyed) {
      return 'destroyed';
    }

    return this.mounted ? 'mounted' : 'unmounted';
  }

  /**
   * Returns the root DOM element.
   *
   * @returns Root element.
   */
  get root(): HTMLElement | null {
    return this.#integration.getRoot();
  }

  /**
   * Returns the library version.
   *
   * @returns Version string.
   */
  get version(): string {
    return __RXT_TRACKER_VERSION__;
  }

  /**
   * Adds a rule to the ordered rule list.
   *
   * @param rule - Public rule candidate.
   * @param params - Add params.
   */
  addRule(rule: TrackerRule, params?: TrackerAddRuleParams): void {
    this.#integration.addRule(rule, params);
  }

  /**
   * Destroys Tracker and releases DOM nodes, observers, listeners and scheduled work.
   *
   * The method is idempotent.
   */
  destroy(): void {
    this.#integration.destroy();
  }

  /** Returns immutable normalized committed options. */
  getOptions(): TrackerReadonlyOptions {
    return this.#integration.getOptions();
  }

  /**
   * Returns public rule copies in priority order.
   *
   * @returns Public rules.
   */
  getRules(): readonly TrackerReadonlyRule[] {
    return this.#integration.getRules();
  }

  /**
   * Returns an immutable state snapshot.
   *
   * @returns Tracker snapshot.
   */
  getSnapshot(): TrackerSnapshot {
    return this.#integration.getSnapshot();
  }

  /**
   * Returns a diagnostics stats snapshot.
   *
   * @returns Stats snapshot.
   */
  getStats(): TrackerStats {
    return this.#integration.getStats();
  }

  /**
   * Mounts Tracker with explicit source, scroll, and renderer-host identities.
   *
   * @param request - Optional Vanilla mount request.
   */
  mount(request: TrackerVanillaMountRequest = {}): void {
    if (this.destroyed) {
      throw new TrackerLifecycleError('Cannot mount after Tracker.destroy().', {
        code: 'ERR_TRACKER_DESTROYED',
      });
    }

    this.#integration.mount(createVanillaIntegrationMountRequest(request));
  }

  /**
   * Removes a Tracker event handler.
   *
   * @param eventName - Event name.
   * @param handler - Event handler.
   */
  off<TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ): boolean {
    if (this.destroyed) {
      return false;
    }

    return this.#events.off(eventName, handler);
  }

  /**
   * Subscribes to a Tracker event.
   *
   * @param eventName - Event name.
   * @param handler - Event handler.
   * @returns Unsubscribe function.
   */
  on<TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ): TrackerEventUnsubscribe {
    if (this.destroyed) {
      throw new TrackerLifecycleError('Cannot subscribe to events on a destroyed Tracker.', {
        code: 'ERR_TRACKER_DESTROYED',
      });
    }

    return this.#events.on(eventName, handler);
  }

  /**
   * Removes a rule by index.
   *
   * @param index - Rule index.
   * @param params - Remove params.
   */
  removeRuleByIndex(index: number, params?: TrackerOperationParams): void {
    this.#integration.removeRuleByIndex(index, params);
  }

  /**
   * Removes a rule by selector.
   *
   * @param selector - Rule selector.
   * @param params - Remove params.
   */
  removeRuleBySelector(selector: string, params?: TrackerOperationParams): void {
    this.#integration.removeRuleBySelector(selector, params);
  }

  /** Requests full public synchronization. */
  render(): void;
  /**
   * Requests full public synchronization.
   *
   * Public render does not accept partial render targets.
   *
   * @param args - Unsupported arguments.
   */
  render(...args: unknown[]): void {
    // `TrackerRendererIntegration.render` is narrowed to `() => void` because its
    // *public* contract never accepts arguments. Internally the same integration
    // object still forwards through to `renderTrackerInstanceNow`, which is the
    // sole authority that rejects unsupported arguments at runtime, so this
    // forwarding call intentionally widens back to the runtime signature rather
    // than duplicating that rejection here.
    (this.#integration.render as (...args: unknown[]) => void)(...args);
  }

  /** Schedules and coalesces a full render. */
  requestRender(): void {
    if (this.destroyed) {
      throw new TrackerLifecycleError('Cannot request a render from a destroyed Tracker.', {
        code: 'ERR_TRACKER_DESTROYED',
      });
    }

    if (!this.mounted) {
      throw new TrackerLifecycleError('Cannot request a render from an unmounted Tracker.', {
        code: 'ERR_TRACKER_INVALID_CONTEXT',
      });
    }

    this.#integration.requestRender();
  }

  /**
   * Resets diagnostics counters and metrics.
   */
  resetStats(): void {
    this.#integration.resetStats();
  }

  /**
   * Detaches Tracker DOM and observers without destroying the instance.
   */
  unmount(): void {
    this.#integration.unmount();
  }

  /**
   * Updates Tracker options.
   *
   * The update is strict and atomic. Invalid values reject the complete
   * operation without changing runtime state.
   *
   * @param options - Partial options.
   * @param params - Apply params.
   */
  replaceOptions(options: Partial<TrackerOptions>, params?: TrackerOperationParams): void {
    this.#integration.replaceOptions(options, params);
  }

  /** Applies a strict deep patch to committed options. */
  patchOptions(options: Partial<TrackerOptions>, params?: TrackerOperationParams): void {
    this.#integration.patchOptions(options, params);
  }

  /** Replaces the committed rule list. */
  replaceRules(rules: readonly TrackerRule[], params?: TrackerOperationParams): void {
    this.#integration.replaceRules(rules, params);
  }

  /** Atomically replaces committed options and rules. */
  replaceConfiguration(configuration: TrackerConfigurationReplacement, params?: TrackerOperationParams): void {
    this.#integration.replaceConfiguration(configuration, params);
  }

  /**
   * Subscribes to immutable state snapshot updates.
   *
   * @param listener - Snapshot listener.
   * @returns Unsubscribe function.
   */
  subscribeSnapshot(listener: TrackerSnapshotListener): TrackerSnapshotUnsubscribe {
    return this.#integration.subscribeSnapshot(listener);
  }

  /** Resolves after terminal cleanup completes. */
  whenDestroyed(): Promise<void> {
    return this.#integration.whenDestroyed();
  }
}

export { Tracker };
export type { TrackerVanillaMountRequest };
