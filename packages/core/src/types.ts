import type { TrackerInstance } from './tracker/createTrackerInstance.js';

/** Main track axis. Vertical tracks follow page Y, horizontal tracks follow page X. */
type TrackerOrientation = 'vertical' | 'horizontal';

/** Public orientation constants. */
type TrackerOrientationConstants = Readonly<{
  VERTICAL: 'vertical';
  HORIZONTAL: 'horizontal';
}>;

/** Viewport edge the track is attached to. Must be compatible with the orientation. */
type TrackerPlacement = 'left' | 'right' | 'top' | 'bottom';

/** Public placement constants. */
type TrackerPlacementConstants = Readonly<{
  LEFT: 'left';
  RIGHT: 'right';
  TOP: 'top';
  BOTTOM: 'bottom';
}>;

/** Core render target used by low-level scheduling operations. */
type TrackerRenderTarget = 'viewport' | 'track' | 'markers' | 'marker-presentation' | 'all';

/** Known low-level render request sources. */
type TrackerRenderReasonSource =
  | 'mount'
  | 'public-render'
  | 'request-render'
  | 'replaceOptions'
  | 'patchOptions'
  | 'replaceRules'
  | 'replaceConfiguration'
  | 'addRule'
  | 'removeRuleByIndex'
  | 'removeRuleBySelector'
  | 'interval'
  | 'mutation'
  | 'resize-observer'
  | 'window-resize'
  | 'scroll'
  | (string & {});

/**
 * Reason attached to a direct or scheduled low-level render request.
 *
 * Direct render calls usually contain a single source. Scheduled render calls
 * contain the compact list of source reasons merged by RenderScheduler.
 */
interface TrackerRenderReason {
  readonly source?: TrackerRenderReasonSource;
  readonly scheduled?: boolean;
  readonly reasons?: readonly TrackerRenderReason[];
}

/**
 * Cooperative-cancellation control passed to a low-level render callback.
 *
 * `signal` is aborted when this render run is superseded, i.e. when
 * RenderScheduler's `cancel()` (directly, via `destroy()`, or via
 * `cancelTrackerInstanceRender()`) runs while this callback is still in
 * flight. Checking `signal.aborted` is advisory only: Core has no way to
 * forcibly interrupt an already-executing callback body, so any side effects
 * already started before a check (DOM writes, network requests, timers,
 * etc.) are not automatically undone. A custom asynchronous render callback
 * should check `signal.aborted` between awaited steps and stop applying
 * further side effects once it is `true`.
 */
interface TrackerRenderControl {
  readonly signal: AbortSignal;
}

/** Scroll animation behavior passed to native browser scrolling APIs. */
type TrackerScrollBehavior = 'auto' | 'smooth';

/** Root in which source selectors execute. */
type TrackerSourceRoot = Document | Element | ShadowRoot;

/** Page or element viewport represented by Tracker. */
type TrackerScrollRoot = Window | HTMLElement;

/** Normalized runtime scroll mode. */
type TrackerScrollMode = 'window' | 'element';

/** Alignment along the represented physical Tracker axis. */
type TrackerScrollAlign = 'start' | 'center' | 'end' | 'nearest';

type TrackerObserverTargetsReason = 'mount' | 'options:update' | (string & {});

/** Supported observer types. */
type TrackerObserverType = 'mutation' | 'resize';

/**
 * Target accepted by MutationObserver or ResizeObserver target resolvers.
 *
 * Mutation targets may be any Node. Resize targets must be Elements.
 */
type TrackerObserverTarget = Node | Element;

/** `'self'` is a reserved string meaning the matched element itself. */
type TrackerTargetSpec = 'self' | (string & {}) | ((element: Element) => Element | null);

interface TrackerObserverTargetsContext {
  /** Observer type being resolved. */
  observerType: TrackerObserverType;
  /** Authoritative source query root. */
  sourceRoot: TrackerSourceRoot;
  /** Authoritative represented scroll root. */
  scrollRoot: Window | HTMLElement;
  /** Normalized runtime scroll mode. */
  scrollMode: TrackerScrollMode;
  /** Actual renderer output root. */
  renderRoot: HTMLElement;
  /** Active owner document. */
  document: Document;
  /** Active owner window. */
  window: Window;
  /** Default targets resolved by the runtime controller. */
  defaultTargets: TrackerObserverTarget[];
  /** Target resolution reason. */
  reason: TrackerObserverTargetsReason;
}

type TrackerObserverTargetsResolver = (context: TrackerObserverTargetsContext) => TrackerObserverTarget[];

/** Stable public Tracker error code. */
type TrackerErrorCode =
  | 'ERR_TRACKER_INVALID_CONFIGURATION'
  | 'ERR_TRACKER_INVALID_CONTEXT'
  | 'ERR_TRACKER_REALM_MISMATCH'
  | 'ERR_TRACKER_UNSUPPORTED_SCROLL_ROOT'
  | 'ERR_TRACKER_RENDERER_CONTRACT'
  | 'ERR_TRACKER_DESTROYED'
  | 'ERR_TRACKER_ALREADY_MOUNTED'
  | 'ERR_TRACKER_TRANSITION_IN_PROGRESS'
  | 'ERR_TRACKER_REENTRANCY_LIMIT';

/** Stable public lifecycle state. */
type TrackerState = 'unmounted' | 'mounted' | 'destroyed';

/** Options used by Tracker error constructors. */
interface TrackerErrorOptions extends ErrorOptions {
  code: TrackerErrorCode;
}

/** CSS token string accepted as one custom-property value, forwarded verbatim including empty strings. */
type TrackerCssVariableValue = string;

/** Root options-patch value; null deletes an existing root declaration. */
type TrackerCssVariablePatchValue = TrackerCssVariableValue | null;

/** Root Tracker variables and application-owned custom-property patches. */
type TrackerCssVariablePatch = Record<string, TrackerCssVariablePatchValue>;

/** Complete rule-owned item custom properties; rules do not use tombstones. */
type TrackerRuleCssVariables = Record<string, TrackerCssVariableValue>;

/** Value that may be rendered as an application-owned marker attribute. */
type TrackerUserAttributeValue = string | number | boolean;

/** Public marker attribute input; null deletes or suppresses one attribute. */
type TrackerUserAttributeInputValue = TrackerUserAttributeValue | null;

/** Public application-owned marker attribute input. */
type TrackerUserAttributes = Record<string, TrackerUserAttributeInputValue>;

/** Normalized renderer-facing user attribute values. */
type TrackerNormalizedUserAttributes = Readonly<Record<string, string>>;

/** Normalized renderer-facing marker attributes and rule suppressions. */
interface TrackerNormalizedMarkerAttributes {
  readonly values: TrackerNormalizedUserAttributes;
  readonly removals: ReadonlySet<string>;
}

/** Rule-level marker options. */
interface TrackerMarkerOptions {
  /** Additional class names applied to marker DOM nodes. */
  className?: string;
  /** Whether marker labels are rendered as native title attributes. */
  title?: boolean;
  /** Custom marker attributes. */
  attributes?: TrackerUserAttributes;
  /** Dynamic custom properties for matching markers or clusters. */
  cssVariables?: TrackerRuleCssVariables;
}

/** Rule-level scroll activation options: target resolution and native scroll parameters. */
interface TrackerScrollOptionsObject {
  /** Whether marker activation should scroll to the target. */
  enabled?: boolean;
  target?: TrackerTargetSpec;
  /** Browser scroll behavior. */
  behavior?: TrackerScrollBehavior;
  /** Alignment along the represented physical Tracker axis. */
  align?: TrackerScrollAlign;
}

/** Scroll activation shorthand: a boolean toggles scrolling with default parameters. */
type TrackerScrollOptions = boolean | TrackerScrollOptionsObject;

/** Rule-level focus activation options: enabled flag and focus target resolution. */
interface TrackerFocusOptionsObject {
  /** Whether marker activation should focus a target. */
  enabled?: boolean;
  target?: TrackerTargetSpec;
}

/** Focus activation shorthand: a boolean toggles focusing the matched element itself. */
type TrackerFocusOptions = boolean | TrackerFocusOptionsObject;

/**
 * Public rule describing which elements are tracked and how their markers look
 * and behave. Rule order is priority order; selectors are unique per Tracker.
 */
interface TrackerRule {
  /** CSS selector used to find source DOM elements. */
  selector: string;
  /** Static or computed marker label. */
  label?: string | ((element: Element) => string | null) | null;
  marker?: TrackerMarkerOptions;
  scroll?: TrackerScrollOptions;
  focus?: TrackerFocusOptions;
}

/** Public rule snapshot stored inside normalized rules. */
type TrackerRuleSource = Partial<TrackerRule> & { selector: string };

/** Normalized focus options used by rule validation and runtime records. */
interface TrackerNormalizedFocusOptions {
  readonly enabled: boolean;
  readonly target: TrackerTargetSpec;
}

/** Normalized marker options used by rule validation and runtime records. */
interface TrackerNormalizedMarkerOptions {
  readonly className: string;
  readonly title: boolean | undefined;
  readonly attributes: TrackerNormalizedMarkerAttributes;
  readonly cssVariables: Readonly<TrackerRuleCssVariables>;
}

/** Normalized scroll options used by rule validation and runtime records. */
interface TrackerNormalizedScrollOptions {
  readonly enabled: boolean;
  readonly target: TrackerTargetSpec;
  readonly behavior: TrackerScrollBehavior;
  readonly align: TrackerScrollAlign;
}

/** Rule candidate returned by normalizeRule() before semantic validation. */
interface TrackerNormalizedRuleCandidate {
  index: number;
  selector: string;
  label: unknown;
  marker: {
    className: unknown;
    title: unknown;
    attributes: unknown;
    cssVariables: unknown;
  };
  scroll: { enabled: unknown; target: unknown; behavior: unknown; align: unknown };
  focus: { enabled: unknown; target: unknown };
  source: TrackerRuleSource;
}

/** Validated normalized rule used by runtime subsystems. */
interface TrackerNormalizedRule {
  readonly index: number;
  readonly selector: string;
  readonly label: string | ((element: Element) => string | null) | null;
  readonly marker: TrackerNormalizedMarkerOptions;
  readonly scroll: TrackerNormalizedScrollOptions;
  readonly focus: TrackerNormalizedFocusOptions;
  readonly source: TrackerRuleSource;
}

/** Context accepted by normalizeRule(). */
interface TrackerRuleNormalizationContext {
  index?: number;
}

/** Context accepted by validateRule(). */
interface TrackerRuleValidationContext {
  selectorRoot?: TrackerSourceRoot | null | undefined;
  hasSelector?: (selector: string) => boolean;
}

/** Result returned by validateRule(). */
interface TrackerRuleValidationResult {
  /** Whether the input rule was accepted after safe normalization. */
  valid: boolean;
  rule: TrackerNormalizedRule | null;
  diagnostics: TrackerValidationDiagnostic[];
  warnings: TrackerValidationDiagnostic[];
  errors: TrackerValidationDiagnostic[];
}

/** Result returned by validation of a complete ordered rule list. */
interface TrackerRulesValidationResult {
  /** Whether every input entry was accepted after safe normalization. */
  valid: boolean;
  rules: TrackerNormalizedRule[];
  diagnostics: TrackerValidationDiagnostic[];
  warnings: TrackerValidationDiagnostic[];
  errors: TrackerValidationDiagnostic[];
}

/** Query match consumed by marker record creation. */
interface TrackerQueryMatch {
  element: Element;
  rule: TrackerNormalizedRule;
  ruleIndex: number;
}

/** Context accepted by createMarkerRecord(). */
interface TrackerMarkerRecordContext {
  diagnostics?:
    | { error?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void }
    | null
    | undefined;
  getElementKey?: (element: Element) => string;
}

/** Internal marker record shared by marker, layout, clustering and render layers. */
interface TrackerMarkerRecord {
  readonly kind: 'marker';
  readonly key: string;
  readonly element: Element;
  readonly rule: Readonly<TrackerNormalizedRule>;
  readonly ruleIndex: number;
  readonly selector: string;
  readonly label: string | null;
  readonly scroll: Readonly<TrackerNormalizedScrollOptions>;
  readonly focus: Readonly<TrackerNormalizedFocusOptions>;
  /** Reserved cluster ownership marker. */
  readonly cluster: string | null;
}

/** Result returned by MarkerStore.rebuild(). */
interface TrackerMarkerStoreRebuildResult {
  changed: boolean;
  records: readonly TrackerMarkerRecord[];
  created: number;
  removed: number;
  skipped: number;
}

/** Marker layout record measured on the track axis. */
interface TrackerMarkerLayoutRecord {
  marker: TrackerMarkerRecord;
  /** Track start position in percent. */
  start: number;
  /** Track end position in percent. */
  end: number;
  /** Track size in percent. */
  size: number;
  orientation: TrackerOrientation;
  /** Source document coordinates. */
  source: { start: number; end: number; size: number };
}

/** Viewport layout record measured on the track axis. */
interface TrackerViewportLayoutRecord {
  /** Track start position in percent. */
  start: number;
  /** Track end position in percent. */
  end: number;
  /** Track size in percent. */
  size: number;
  /** Whether viewport indicator should be visible. */
  visible: boolean;
  orientation: TrackerOrientation;
  /** Source content metrics. */
  source: { scrollOffset: number; viewportSize: number; contentSize: number };
}

/** Render record for a single marker. */
interface TrackerMarkerRenderRecord {
  readonly kind: 'marker';
  readonly key: string;
  readonly marker: TrackerMarkerRecord;
  readonly start: number;
  readonly end: number;
  readonly size: number;
  readonly orientation: TrackerOrientation;
}

/** Render record for a cluster of markers. */
interface TrackerClusterRenderRecord {
  readonly kind: 'cluster';
  readonly key: string;
  readonly markers: readonly TrackerMarkerRecord[];
  readonly count: number;
  readonly primaryMarker: TrackerMarkerRecord;
  readonly start: number;
  readonly end: number;
  readonly size: number;
  readonly orientation: TrackerOrientation;
}

/** Marker or cluster render record consumed by renderers and snapshots. */
type TrackerRenderRecord = TrackerMarkerRenderRecord | TrackerClusterRenderRecord;

/** Track geometry and appearance options for the root track element. */
interface TrackerTrackOptions {
  /** Additional root class names. */
  className?: string;
}

/** Viewport indicator options: visibility and appearance of the visible-area marker. */
interface TrackerViewportOptions {
  enabled?: boolean;
  /** Additional viewport class names. */
  className?: string;
}

/** Hooks for the standard marker-layer container. */
interface TrackerMarkerLayerOptions {
  /** Application classes appended to the required marker-layer service class. */
  className?: string;
}

/** Global defaults and hooks for every marker or cluster item. */
interface TrackerMarkerDefaults {
  /** Application-owned marker attributes. */
  attributes?: TrackerUserAttributes;
  /** Application classes appended to every marker or cluster. */
  className?: string;
  /** Enables native title output unless a rule overrides it. */
  title?: boolean;
}

/** Immutable normalized global marker defaults exposed to renderer consumers. */
interface TrackerMarkerDefaultsSnapshot {
  readonly attributes?: Readonly<Record<string, string>>;
  readonly className?: string;
  readonly title?: boolean;
}

/** Complete application-owned presentation resolved for one rendered item. */
interface TrackerResolvedMarkerPresentation {
  readonly attributes: Readonly<Record<string, string>>;
  readonly className: string;
  readonly cssVariables: Readonly<Record<string, string>>;
  readonly title: string | null;
}

/** Marker clustering behavior: whether nearby markers are grouped. */
interface TrackerClusteringOptions {
  enabled?: boolean;
  /**
   * Clustering threshold in percentage points.
   *
   * Must be a finite non-negative number. Not a CSS length.
   */
  threshold?: number;
}

/** MutationObserver configuration subset forwarded to MutationObserver.observe(). */
interface TrackerMutationObserverOptions {
  childList?: boolean;
  subtree?: boolean;
  attributes?: boolean;
  attributeFilter?: readonly string[];
  attributeOldValue?: boolean;
  characterData?: boolean;
  characterDataOldValue?: boolean;
}

interface TrackerMutationUpdateOptions {
  enabled?: boolean;
  targets?: TrackerObserverTargetsResolver;
  options?: TrackerMutationObserverOptions;
  /** Mutation debounce delay in milliseconds. */
  debounce?: number;
}

interface TrackerResizeUpdateOptions {
  enabled?: boolean;
  targets?: TrackerObserverTargetsResolver;
  /** Resize debounce delay in milliseconds. */
  debounce?: number;
}

interface TrackerScrollUpdateOptions {
  enabled?: boolean;
}

interface TrackerIntervalUpdateOptions {
  /** Whether polling is enabled. Defaults to false. */
  enabled?: boolean;
  /** Interval delay in milliseconds. */
  delay?: number;
}

/** Update scheduling options for DOM mutation, resize, scroll and interval refresh sources. */
interface TrackerUpdateOptions {
  mutation?: TrackerMutationUpdateOptions;
  resize?: TrackerResizeUpdateOptions;
  scroll?: TrackerScrollUpdateOptions;
  interval?: TrackerIntervalUpdateOptions;
}

/** User-facing activation and drag capabilities on the tracker root. */
interface TrackerInteractionOptions {
  /** Whether marker, cluster and track activation is enabled. */
  activation?: boolean;
  /** Whether track drag scrolling is enabled. */
  drag?: boolean;
}

/** Accessibility options applied to the tracker root element. */
interface TrackerA11yOptions {
  enabled?: boolean;
  keyboard?: boolean;
  /** Accessible label for the root tracker element. */
  label?: string;
}

/** Diagnostics output options: console visibility, metrics collection, and optional sink. */
interface TrackerDiagnosticsOptions {
  warnings?: boolean;
  metrics?: boolean;
  output?: TrackerDiagnosticsSink | null;
}

/**
 * Public non-rule Tracker options accepted by replacement and patch operations.
 * All fields are optional; missing values fall back to defaults for replacement
 * operations and preserve committed values for patch operations.
 */
interface TrackerOptions {
  orientation?: TrackerOrientation;
  placement?: TrackerPlacement;
  cssVariables?: TrackerCssVariablePatch;
  track?: TrackerTrackOptions;
  viewport?: TrackerViewportOptions;
  markerLayer?: TrackerMarkerLayerOptions;
  marker?: TrackerMarkerDefaults;
  clustering?: TrackerClusteringOptions;
  updates?: TrackerUpdateOptions;
  interaction?: TrackerInteractionOptions;
  a11y?: TrackerA11yOptions;
  diagnostics?: TrackerDiagnosticsOptions;
}

/**
 * Partially normalized options candidate produced by normalizeOptions().
 *
 * Normalization merges input into a baseline and repairs shape and casing, but
 * deliberately keeps known-invalid values so validateOptions() can still report
 * a precise diagnostic for them. Completeness therefore depends on the baseline
 * and is only guaranteed after resolveTrackerOptions(). Internal marker type:
 * it names the intermediate layer without widening the public surface.
 */
type TrackerOptionsCandidate = Partial<TrackerOptions>;

/** Committed root custom properties; deletion tombstones are stripped at validation. */
type TrackerResolvedCssVariables = Record<string, TrackerCssVariableValue>;

/** Committed track options. */
interface TrackerResolvedTrackOptions {
  className: string;
}

/** Committed viewport indicator options. */
interface TrackerResolvedViewportOptions {
  enabled: boolean;
  className: string;
}

/** Committed marker-layer container options. */
interface TrackerResolvedMarkerLayerOptions {
  className: string;
}

/** Committed global marker defaults. */
interface TrackerResolvedMarkerDefaults {
  attributes: TrackerUserAttributes;
  className: string;
  title: boolean;
}

/** Committed clustering options. */
interface TrackerResolvedClusteringOptions {
  enabled: boolean;
  threshold: number;
}

/**
 * Committed mutation update options.
 *
 * The forwarded MutationObserver configuration object is always present, but
 * its native fields stay optional because defaults only cover a subset of them.
 */
interface TrackerResolvedMutationUpdateOptions {
  enabled: boolean;
  targets: TrackerObserverTargetsResolver;
  options: TrackerMutationObserverOptions;
  debounce: number;
}

/** Committed resize update options. */
interface TrackerResolvedResizeUpdateOptions {
  enabled: boolean;
  targets: TrackerObserverTargetsResolver;
  debounce: number;
}

/** Committed scroll update options. */
interface TrackerResolvedScrollUpdateOptions {
  enabled: boolean;
}

/** Committed interval update options. */
interface TrackerResolvedIntervalUpdateOptions {
  enabled: boolean;
  delay: number;
}

/** Committed update scheduling options for every refresh source. */
interface TrackerResolvedUpdateOptions {
  mutation: TrackerResolvedMutationUpdateOptions;
  resize: TrackerResolvedResizeUpdateOptions;
  scroll: TrackerResolvedScrollUpdateOptions;
  interval: TrackerResolvedIntervalUpdateOptions;
}

/** Committed activation and drag capabilities. */
interface TrackerResolvedInteractionOptions {
  activation: boolean;
  drag: boolean;
}

/** Committed accessibility options. */
interface TrackerResolvedA11yOptions {
  enabled: boolean;
  keyboard: boolean;
  label: string;
}

/**
 * Committed diagnostics options.
 *
 * The sink stays optional because defaults never install one; console
 * visibility and metrics collection are always resolved.
 */
interface TrackerResolvedDiagnosticsOptions {
  warnings: boolean;
  metrics: boolean;
  output?: TrackerDiagnosticsSink | null;
}

/**
 * Complete validated Tracker options committed to an instance.
 *
 * Every branch listed here is guaranteed by the default baseline that
 * resolveTrackerOptions() merges into before validation, so committed state may
 * be read without optional chaining. Fields whose absence survives resolution
 * stay optional and are spelled out per field rather than derived mechanically
 * from TrackerOptions.
 */
interface TrackerResolvedOptions {
  orientation: TrackerOrientation;
  placement: TrackerPlacement;
  cssVariables: TrackerResolvedCssVariables;
  track: TrackerResolvedTrackOptions;
  viewport: TrackerResolvedViewportOptions;
  markerLayer: TrackerResolvedMarkerLayerOptions;
  marker: TrackerResolvedMarkerDefaults;
  clustering: TrackerResolvedClusteringOptions;
  updates: TrackerResolvedUpdateOptions;
  interaction: TrackerResolvedInteractionOptions;
  a11y: TrackerResolvedA11yOptions;
  diagnostics: TrackerResolvedDiagnosticsOptions;
}

/** Constructor configuration with independent options and rules channels. */
interface TrackerConfiguration {
  options?: Partial<TrackerOptions>;
  rules?: readonly TrackerRule[];
}

/** Complete atomic replacement of both configuration channels. */
interface TrackerConfigurationReplacement {
  options: Partial<TrackerOptions>;
  rules: readonly TrackerRule[];
}

/** Recursively applies readonly, preserving function values and array element order. */
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

/** Deeply read-only committed options view returned by public accessors. */
type TrackerReadonlyOptions = DeepReadonly<TrackerResolvedOptions>;

/** Deeply read-only public rule view returned by public accessors. */
type TrackerReadonlyRule = DeepReadonly<TrackerRule>;

/**
 * Renderer-facing options included in immutable snapshots.
 *
 * Snapshot options intentionally exclude lifecycle, observer, diagnostics and
 * rule configuration. Those concerns are exposed through dedicated snapshot
 * fields or through explicit core operations.
 *
 * Every field the snapshot builder creates unconditionally from committed
 * options is required here. Only `marker` stays optional, because the retained
 * marker-defaults projection is absent when no marker defaults object exists.
 */
interface TrackerOptionsSnapshot {
  readonly orientation: TrackerOrientation;
  readonly placement: TrackerPlacement;
  readonly cssVariables: Readonly<Record<string, string>>;
  readonly track: Readonly<TrackerResolvedTrackOptions>;
  readonly viewport: Readonly<TrackerResolvedViewportOptions>;
  readonly markerLayer: Readonly<TrackerResolvedMarkerLayerOptions>;
  readonly marker?: TrackerMarkerDefaultsSnapshot | undefined;
  readonly clustering: Readonly<TrackerResolvedClusteringOptions>;
  readonly interaction: Readonly<TrackerResolvedInteractionOptions>;
  readonly a11y: Readonly<TrackerResolvedA11yOptions>;
}

/** Context accepted by normalizeOptions(). */
interface TrackerOptionsNormalizationContext {
  baseOptions?: Partial<TrackerOptions>;
  currentOptions?: Partial<TrackerOptions>;
}

/** Context accepted by validateOptions(). */
interface TrackerOptionsValidationContext {
  previousOptions?: Partial<TrackerOptions>;
  /** Raw user input used for unknown-key detection. */
  inputOptions?: unknown;
}

/** Validation diagnostic produced by options and rule validators. */
type TrackerValidationDiagnostic = TrackerDiagnosticEntry & { type: 'warning' | 'error' };

/** Result returned by validateOptions(). */
interface TrackerOptionsValidationResult {
  options: TrackerOptionsCandidate;
  diagnostics: TrackerValidationDiagnostic[];
  warnings: TrackerValidationDiagnostic[];
  errors: TrackerValidationDiagnostic[];
}

/** Dirty subsystem flags returned by diffOptions(). */
interface TrackerOptionsDiff {
  changed: boolean;
  track: boolean;
  styles: boolean;
  viewport: boolean;
  markers: boolean;
  markerPresentation: boolean;
  observers: boolean;
  interaction: boolean;
  diagnostics: boolean;
}

/** Public Tracker event name. */
type TrackerEventName =
  | 'marker:activate'
  | 'cluster:activate'
  | 'track:activate'
  | 'selection:change'
  | 'sync:start'
  | 'sync:end'
  | 'warning'
  | 'destroy';

/** Public event name constants. */
type TrackerEventNameConstants = Readonly<{
  MARKER_ACTIVATE: 'marker:activate';
  CLUSTER_ACTIVATE: 'cluster:activate';
  TRACK_ACTIVATE: 'track:activate';
  SELECTION_CHANGE: 'selection:change';
  SYNC_START: 'sync:start';
  SYNC_END: 'sync:end';
  WARNING: 'warning';
  DESTROY: 'destroy';
}>;

/** Shared class name constants used by DOM and framework renderers. */
type TrackerClassNameConstants = Readonly<{
  ROOT: string;
  VIEWPORT: string;
  MARKERS: string;
  MARKER: string;
}>;

/** Shared CSS custom property constants used by DOM and framework renderers. */
type TrackerCssVariableConstants = Readonly<{
  TRACK_THICKNESS: string;
  TRACK_OFFSET: string;
  TRACK_START: string;
  TRACK_END: string;
  TRACK_BG: string;
  TRACK_BORDER_COLOR: string;
  TRACK_BORDER_WIDTH: string;
  TRACK_Z_INDEX: string;
  TRACK_OVERFLOW: string;
  TRACK_CONTAIN: string;
  VIEWPORT_BG: string;
  VIEWPORT_START: string;
  VIEWPORT_SIZE: string;
  MARKER_MIN_SIZE: string;
  MARKER_BG: string;
  MARKER_RING_COLOR: string;
  MARKER_RING_WIDTH: string;
  MARKER_BORDER_RADIUS: string;
  MARKER_OPACITY: string;
  MARKER_START: string;
  MARKER_SIZE: string;
  CLUSTER_BG: string;
  CLUSTER_FONT_SIZE: string;
  CLUSTER_TEXT_COLOR: string;
  CLUSTER_CONTENT: string;
  FOCUS_OUTLINE_COLOR: string;
  FOCUS_OUTLINE_WIDTH: string;
  FOCUS_OUTLINE_OFFSET: string;
}>;

/** Shared data attribute constants used by DOM and framework renderers. */
type TrackerDataAttributeConstants = Readonly<{
  ORIENTATION: string;
  PLACEMENT: string;
  DRAG: string;
  SCROLL_MODE: string;
  GEOMETRY: string;
  KIND: string;
  COUNT: string;
  KEY: string;
  SELECTED: string;
}>;

/** Public marker data included in interaction event payloads. */
interface TrackerEventMarker {
  /** Stable logical marker key, usable to correlate activation with snapshots. */
  readonly key: string;
  /** Source element matched by the rule. */
  readonly element: Element;
  readonly ruleIndex: number;
  readonly selector: string;
  readonly label: string | null;
}

/** Payload emitted when a marker is activated. */
interface TrackerMarkerActivateEventPayload extends TrackerEventMarker {
  readonly sourceEvent: Event | null;
}

/** Payload emitted when a marker cluster is activated. */
interface TrackerClusterActivateEventPayload {
  /** Stable logical cluster key, usable to correlate activation with snapshots. */
  readonly key: string;
  readonly count: number;
  readonly markers: readonly TrackerEventMarker[];
  readonly primaryMarker: TrackerEventMarker | null;
  readonly sourceEvent: Event | null;
}

/**
 * Payload emitted when the track background is activated (not a marker or
 * cluster hit), representing the semantic track-activation gesture rather
 * than a generic DOM click.
 */
interface TrackerTrackActivateEventPayload {
  /**
   * Normalized activation position along the track's main axis, in percent
   * (0-100), consistent with the percent-based track position convention
   * used by marker layout and viewport snapshots. `null` when the track has
   * no measurable scrollable range at activation time.
   */
  readonly position: number | null;
  readonly sourceEvent: Event;
}

/**
 * Payload emitted when the logical selection actually changes, that is a
 * committed transition between two distinct selection keys. Not emitted for
 * activation or for transitions where the key is unchanged.
 */
interface TrackerSelectionChangeEventPayload {
  readonly previousKey: string | null;
  readonly selectedKey: string | null;
}

/**
 * Payload emitted when a Core synchronization transaction starts.
 *
 * The provisional initial-mount payload is staged and published only after
 * the mount transaction commits successfully.
 */
interface TrackerSyncStartEventPayload {
  readonly reason: TrackerRenderReason | null | undefined;
  readonly scheduled: boolean;
  /** High-resolution timestamp when metrics are enabled. */
  readonly timestamp: number | null;
}

/** Payload emitted after a Core renderer/projection synchronization transaction succeeds. */
interface TrackerSyncEndEventPayload {
  readonly markersCount: number;
  readonly clustersCount: number;
  /** Render duration when metrics are enabled. */
  readonly duration: number | null;
  /** High-resolution timestamp when metrics are enabled. */
  readonly timestamp: number | null;
}

/**
 * Stable public Tracker diagnostic code.
 *
 * Covers every code emitted through `Diagnostics#warn()`/`Diagnostics#error()`,
 * including codes reused from {@link TrackerErrorCode} for reentrancy-limit
 * diagnostics. `'unknown'` is the runtime fallback used when a diagnostic is
 * created with a missing or empty code. Diagnostic behavior tests own the
 * emitted code values; this declaration owns the public consumer type.
 */
type TrackerDiagnosticCode =
  | 'ERR_TRACKER_REENTRANCY_LIMIT'
  | 'WARN_TRACKER_FOCUS_TARGET_OUTSIDE_ROOT'
  | 'WARN_TRACKER_GEOMETRY_SUSPENDED'
  | 'WARN_TRACKER_OBSERVER_EMPTY_TARGETS'
  | 'WARN_TRACKER_OBSERVER_FOREIGN_REALM_TARGET'
  | 'WARN_TRACKER_OBSERVER_INVALID_RESULT'
  | 'WARN_TRACKER_OBSERVER_INVALID_TARGET'
  | 'WARN_TRACKER_OBSERVER_RESOLVER_FAILED'
  | 'WARN_TRACKER_RENDER_ROOT_QUARANTINED'
  | 'WARN_TRACKER_SCROLL_PADDING_FALLBACK'
  | 'WARN_TRACKER_SCROLL_TARGET_OUTSIDE_ROOT'
  | 'WARN_TRACKER_UNKNOWN_OPTION'
  | 'WARN_TRACKER_UNKNOWN_RULE_OPTION'
  | 'WARN_TRACKER_WINDOW_ALIGNMENT_FALLBACK'
  | 'deferred-operation-error'
  | 'destroy-cleanup-failure'
  | 'dom-unavailable'
  | 'duplicate-rule-selector'
  | 'element-lifecycle-error'
  | 'integration-event-handler-error'
  | 'focus-fallback-error'
  | 'focus-prevent-scroll-error'
  | 'interaction-not-connected'
  | 'interaction-update-cleanup-failure'
  | 'invalid-a11y-keyboard-combination'
  | 'invalid-activation-key'
  | 'invalid-css-variable-name'
  | 'invalid-css-variable-value'
  | 'invalid-css-variables'
  | 'invalid-interaction-root'
  | 'invalid-marker-attribute'
  | 'invalid-marker-attribute-collision'
  | 'invalid-marker-attribute-name'
  | 'invalid-marker-attribute-reserved'
  | 'invalid-marker-attribute-value'
  | 'invalid-mount-context'
  | 'invalid-mount-target'
  | 'invalid-option-value'
  | 'invalid-options'
  | 'invalid-orientation-placement'
  | 'invalid-render-target'
  | 'invalid-rule'
  | 'invalid-rule-css-variable-name'
  | 'invalid-rule-css-variable-value'
  | 'invalid-rule-focus'
  | 'invalid-rule-focus-target'
  | 'invalid-rule-index'
  | 'invalid-rule-label'
  | 'invalid-rule-marker-class-name'
  | 'invalid-rule-marker-css-variables'
  | 'invalid-rule-marker-title'
  | 'invalid-rule-option-value'
  | 'invalid-rule-scroll'
  | 'invalid-rule-scroll-align'
  | 'invalid-rule-scroll-behavior'
  | 'invalid-rule-scroll-target'
  | 'invalid-rule-selector'
  | 'invalid-rules'
  | 'marker-attribute-name-collision'
  | 'mount-failure'
  | 'mutation-observer-observe-failed'
  | 'mutation-observer-unavailable'
  | 'operation-cleanup-error'
  | 'projection-listener-error'
  | 'query-selector-error'
  | 'render-error'
  | 'renderer-already-mounted'
  | 'renderer-contract-error'
  | 'renderer-hook-returned-thenable'
  | 'renderer-missing'
  | 'reserved-class-name'
  | 'reserved-marker-attribute'
  | 'reserved-rule-marker-class-name'
  | 'resize-observer-observe-failed'
  | 'resize-observer-unavailable'
  | 'rule-label-error'
  | 'scroll-into-view-error'
  | 'target-resolver-error'
  | 'target-selector-error'
  | 'unknown'
  | 'unknown-activation-key'
  | 'unmount-cleanup-failure'
  | 'unsupported-cross-document-target';

/**
 * Public diagnostic entry emitted by warning events and exposed in stats.
 *
 * A live `warning` event borrows `details`: Tracker does not clone or freeze
 * that value or its reachable object graph. The entry retained in
 * `getStats().warnings.last` instead contains a retention-safe sanitized
 * snapshot, so the two contexts intentionally have different ownership.
 */
interface TrackerDiagnosticEntry {
  readonly code: TrackerDiagnosticCode;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>> | null;
}

/**
 * Payload emitted by warning diagnostics. Its frozen Tracker-owned envelope
 * contains borrowed live `details`, whose object graph may remain mutable.
 */
type TrackerWarningEventPayload = TrackerDiagnosticEntry;

/** Payload emitted when an instance is destroyed. */
type TrackerDestroyEventPayload = Record<string, never>;

/** Render summary stored in diagnostics stats. */
interface TrackerRenderStatsSummary {
  readonly target: string;
  /** Total number of marker records stored after the render pass. */
  readonly markersCount: number;
  readonly clustersCount: number;
  /** Render duration when metrics are enabled. */
  readonly duration: number | null;
  /** High-resolution timestamp when metrics are enabled. */
  readonly timestamp: number | null;
}

/** Diagnostic warning or error counters. */
interface TrackerDiagnosticStats {
  readonly total: number;
  readonly byCode: Readonly<Record<string, number>>;
  readonly last: TrackerDiagnosticEntry | null;
}

/** Debug metadata included by debug builds. */
interface TrackerDebugStats {
  readonly traceLength: number;
  readonly traceLimit: number;
}

/**
 * One recorded debug-build execution trace entry.
 *
 * Only produced and retrievable in debug builds; see
 * `getTrackerInstanceDebugTrace()`. Payloads are retention-safe compact
 * summaries (scalars, identifiers, reason codes) rather than live object
 * references, so a trace entry never keeps DOM nodes or other large graphs
 * reachable.
 */
interface TrackerDebugTraceEntry {
  /** Trace entry type, e.g. "sync:start" or "mount:commit". */
  readonly type: string;
  /** High-resolution timestamp when available. */
  readonly timestamp: number | null;
  /** Compact, retention-safe trace payload. */
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Diagnostics stats snapshot exposed through getStats() and snapshots. */
interface TrackerStats {
  readonly renders: Readonly<{
    requested: number;
    started: number;
    completed: number;
    cancelled: number;
    skipped: number;
  }>;
  readonly rules: Readonly<{
    added: number;
    removed: number;
    cleared: number;
    rejected: number;
    duplicates: number;
  }>;
  /**
   * Marker counters. `current` is the number of measured marker records that
   * participated in the last render pass; records filtered out before layout
   * (for example, elements disconnected from the DOM) are excluded. The total
   * stored record count is reported as `lastRender.markersCount`.
   */
  readonly markers: Readonly<{ current: number; created: number; removed: number }>;
  readonly clusters: Readonly<{ current: number }>;
  readonly observers: Readonly<{ mutation: number; resize: number; scroll: number; interval: number }>;
  readonly warnings: TrackerDiagnosticStats;
  readonly errors: TrackerDiagnosticStats;
  readonly lastRender: TrackerRenderStatsSummary | null;
  readonly debug?: TrackerDebugStats;
}

/** Public event payload emitted by core lifecycle and interaction operations. */
type TrackerEventPayload =
  | TrackerMarkerActivateEventPayload
  | TrackerClusterActivateEventPayload
  | TrackerTrackActivateEventPayload
  | TrackerSelectionChangeEventPayload
  | TrackerSyncStartEventPayload
  | TrackerSyncEndEventPayload
  | TrackerWarningEventPayload
  | TrackerDestroyEventPayload;

/** Event payloads keyed by public event name. */
interface TrackerEventPayloadMap {
  'marker:activate': TrackerMarkerActivateEventPayload;
  'cluster:activate': TrackerClusterActivateEventPayload;
  'track:activate': TrackerTrackActivateEventPayload;
  'selection:change': TrackerSelectionChangeEventPayload;
  'sync:start': TrackerSyncStartEventPayload;
  'sync:end': TrackerSyncEndEventPayload;
  warning: TrackerWarningEventPayload;
  destroy: TrackerDestroyEventPayload;
}

/** Handles a Tracker event emitted by the core runtime. */
type TrackerEventHandler = (payload: TrackerEventPayload) => void;

/** Handles a Tracker event with payload narrowed by event name. */
type TrackerTypedEventHandler<TEventName extends TrackerEventName> = (
  payload: TrackerEventPayloadMap[TEventName],
) => void;

/** Unsubscribes a previously registered Tracker event handler. */
type TrackerEventUnsubscribe = () => void;

/** Common mutation operation parameters. */
interface TrackerOperationParams {
  /** Whether to schedule rendering. Default: true. */
  render?: boolean;
}

/** Parameters for adding a rule. */
type TrackerAddRuleParams = TrackerOperationParams & { index?: number };

/** Minimal diagnostics sink used by integration-owned renderers. */
interface TrackerDiagnosticsSink {
  error?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
  warn?: (code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) => void;
}

/** Renderer dependency context passed from core to integration renderers. */
interface TrackerRendererContext {
  /** Active diagnostics sink. */
  diagnostics: TrackerDiagnosticsSink | null;
  /** Active document, or null while unmounted. */
  document: Document | null;
  /** Active window, or null while unmounted. */
  window: Window | null;
  /** Active scroll mode, or null while unmounted. */
  scrollMode: TrackerScrollMode | null;
}

/** Explicit renderer ownership target. */
type TrackerRendererMountTarget = { kind: 'host'; host: HTMLElement } | { kind: 'root'; root: HTMLElement };

/** Staged renderer mount context. */
interface TrackerRendererMountContext {
  /** Explicit ownership target. */
  target: TrackerRendererMountTarget;
  /** Active owner document. */
  document: Document;
  /** Active owner window. */
  window: Window;
  /** Normalized scroll mode. */
  scrollMode: TrackerScrollMode;
}

/**
 * Partial custom-renderer input normalized by core.
 *
 * Every `options` parameter below ({@link mount}, {@link renderTrack},
 * {@link renderMarkers}, {@link renderViewport}) receives a deeply-frozen
 * snapshot, not core's live internal options object. Core creates one such
 * snapshot per successfully committed options version and reuses the same
 * reference across every renderer call until the next successful update, so
 * a renderer must not mutate it or any of its nested branches (mutation
 * attempts throw in strict mode) and can safely rely on reference equality
 * to detect that options did not change between two calls.
 */
interface TrackerRendererLike {
  root?: HTMLElement | null;
  viewportLayout?: TrackerViewportLayoutRecord | null;
  mount?: (context: TrackerRendererMountContext, options: TrackerReadonlyOptions) => HTMLElement | null;
  /**
   * Reverses one mount cycle so the renderer can be mounted again. When
   * omitted, core falls back to calling {@link destroy} for that cycle
   * instead, and the renderer may then be mounted again — so a renderer
   * whose `destroy()` performs irreversible teardown must implement
   * `unmount()` rather than relying on the fallback.
   */
  unmount?: () => void;
  /**
   * Tears the renderer down. Called once for final, permanent teardown.
   * When {@link unmount} is not implemented, core also calls this method as
   * a per-mount-cycle cleanup fallback on every unmount, so it may run more
   * than once over the renderer's lifetime and must stay safe to call
   * repeatedly in that case; renderers that cannot support that must
   * implement `unmount()` instead.
   */
  destroy?: () => void;
  renderTrack?: (options: TrackerReadonlyOptions) => void;
  renderMarkers?: (
    renderRecords: readonly TrackerRenderRecord[],
    options: TrackerReadonlyOptions,
    markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  ) => void;
  renderMarkerPresentation?: (
    renderRecords: readonly TrackerRenderRecord[],
    markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  ) => void;
  renderSelection?: (previousKey: string | null, nextKey: string | null) => void;
  renderViewport?: (viewportLayout: TrackerViewportLayoutRecord, options: TrackerReadonlyOptions) => void;
  /**
   * Updates renderer dependency context (diagnostics sink, active document,
   * active window, scroll mode). Called once at construction with a null
   * document/window/scrollMode, and again on every mount, unmount, and
   * options/rules/lifecycle-callback change.
   *
   * Exception safety of this call is entirely the renderer's own
   * responsibility. If it throws, core only rolls back its own bookkeeping
   * (the options/rules snapshot being applied) and re-invokes
   * `updateContext()` with the previous context as part of that rollback — it
   * never inspects or attempts to release subscriptions, DOM nodes, timers, or
   * any other resource the renderer may have already created before throwing,
   * because core cannot know what those resources are. A renderer whose
   * `updateContext()` can partially fail must leave itself in a
   * self-consistent state (e.g. via its own try/catch and cleanup) rather than
   * relying on core to undo it.
   */
  updateContext?: (context: TrackerRendererContext) => void;
}

/** Complete normalized renderer contract. */
interface TrackerRenderer {
  root: HTMLElement | null;
  viewportLayout: TrackerViewportLayoutRecord | null;
  mount: (context: TrackerRendererMountContext, options: TrackerReadonlyOptions) => HTMLElement | null;
  /** @see TrackerRendererLike.unmount */
  unmount: () => void;
  /** @see TrackerRendererLike.destroy */
  destroy: () => void;
  renderTrack: (options: TrackerReadonlyOptions) => void;
  renderMarkers: (
    renderRecords: readonly TrackerRenderRecord[],
    options: TrackerReadonlyOptions,
    markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  ) => void;
  renderMarkerPresentation: (
    renderRecords: readonly TrackerRenderRecord[],
    markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
  ) => void;
  renderSelection: (previousKey: string | null, nextKey: string | null) => void;
  renderViewport: (viewportLayout: TrackerViewportLayoutRecord, options: TrackerReadonlyOptions) => void;
  /** @see TrackerRendererLike.updateContext */
  updateContext: (context: TrackerRendererContext) => void;
}

/** Supported renderer method names used by normalizeTrackerRenderer(). */
type TrackerRendererMethodName =
  | 'mount'
  | 'unmount'
  | 'destroy'
  | 'renderTrack'
  | 'renderMarkers'
  | 'renderMarkerPresentation'
  | 'renderSelection'
  | 'renderViewport'
  | 'updateContext';

/** Non-nullable advanced integration mount request. */
interface TrackerIntegrationMountRequest {
  sourceRoot?: TrackerSourceRoot | undefined;
  scrollRoot?: TrackerScrollRoot | undefined;
  rendererTarget: TrackerRendererMountTarget;
}

/** Low-level unmount notification options. */
interface TrackerUnmountOptions {
  /** Emits the stable unmounted snapshot when true. Defaults to true. */
  emitSnapshot?: boolean;
}

/** Shared visual snapshot fields for root, viewport, marker and cluster data. */
interface TrackerVisualSnapshot {
  readonly key: string;
  readonly className: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly styleVars: Readonly<Record<string, string>>;
}

/** Snapshot item for a single marker. */
interface TrackerMarkerSnapshot extends TrackerVisualSnapshot {
  readonly kind: 'marker';
  readonly ruleIndex: number;
  readonly selector: string;
  readonly label: string | null;
  readonly title: string | null;
  readonly start: number;
  readonly size: number;
  readonly clustered: false;
  readonly clusterKey: null;
  readonly interactive: boolean;
}

/** Snapshot item for a marker cluster. */
interface TrackerClusterSnapshot extends TrackerVisualSnapshot {
  readonly kind: 'cluster';
  readonly count: number;
  readonly markerKeys: readonly string[];
  readonly primaryMarkerKey: string | null;
  readonly label: string | null;
  readonly title: string | null;
  readonly start: number;
  readonly size: number;
  readonly interactive: boolean;
}

/** Ordered marker or cluster snapshot item. */
type TrackerSnapshotItem = TrackerMarkerSnapshot | TrackerClusterSnapshot;

/** Viewport indicator snapshot. */
interface TrackerViewportSnapshot {
  readonly visible: boolean;
  readonly start: number;
  readonly size: number;
}

/** Tracker lifecycle snapshot without DOM object references. */
interface TrackerLifecycleSnapshot {
  readonly mounted: boolean;
  readonly destroyed: boolean;
  /** True only for a committed active renderer root. */
  readonly hasRenderRoot: boolean;
}

/** Render scheduling snapshot. */
interface TrackerRenderSnapshot {
  readonly dirtyTarget: TrackerRenderTarget | null;
  readonly pending: boolean;
  readonly running: boolean;
}

/** Immutable keyboard-selection state shared by snapshots and snapshot props. */
interface TrackerSelectionSnapshot {
  readonly enabled: boolean;
  readonly key: string | null;
}

/** Immutable renderer-facing tracker snapshot. */
interface TrackerSnapshot {
  readonly mounted: boolean;
  readonly scrollMode: TrackerScrollMode | null;
  readonly geometryAvailable: boolean;
  readonly lifecycle: TrackerLifecycleSnapshot;
  readonly options: TrackerOptionsSnapshot;
  readonly classes: TrackerClassNameConstants;
  readonly dataAttributes: TrackerDataAttributeConstants;
  readonly cssVariables: TrackerCssVariableConstants;
  readonly render: TrackerRenderSnapshot;
  readonly selection: TrackerSelectionSnapshot;
  readonly viewport: TrackerViewportSnapshot;
  readonly items: readonly TrackerSnapshotItem[];
  readonly markers: readonly TrackerMarkerSnapshot[];
  readonly clusters: readonly TrackerClusterSnapshot[];
  readonly diagnostics: TrackerStats;
}

/** Receives immutable tracker snapshot updates. */
type TrackerSnapshotListener = (snapshot: TrackerSnapshot) => void;

/** Unsubscribes a previously registered snapshot listener. */
type TrackerSnapshotUnsubscribe = () => void;

/** Internal snapshot store shape exposed to lifecycle helpers. */
interface TrackerSnapshotStore {
  clear: () => void;
  emit: (
    nextInstance?: TrackerInstance,
    markerOptions?: TrackerMarkerDefaultsSnapshot,
    committedViewportLayout?: TrackerViewportLayoutRecord,
  ) => void;
  emitPrepared: (
    preparedSnapshot: TrackerSnapshot,
    nextInstance?: TrackerInstance,
    markerOptions?: TrackerMarkerDefaultsSnapshot,
    committedViewportLayout?: TrackerViewportLayoutRecord,
  ) => void;
  getSnapshot: () => TrackerSnapshot;
  hasSubscribers: () => boolean;
  prepare: (
    nextInstance?: TrackerInstance,
    markerOptions?: TrackerMarkerDefaultsSnapshot,
    committedViewportLayout?: TrackerViewportLayoutRecord,
  ) => TrackerSnapshot;
  refresh: (
    nextInstance?: TrackerInstance,
    markerOptions?: TrackerMarkerDefaultsSnapshot,
    committedViewportLayout?: TrackerViewportLayoutRecord,
  ) => void;
  subscribe: (listener: TrackerSnapshotListener) => TrackerSnapshotUnsubscribe;
}

export type {
  TrackerA11yOptions,
  TrackerAddRuleParams,
  TrackerClassNameConstants,
  TrackerClusterActivateEventPayload,
  TrackerClusterRenderRecord,
  TrackerClusterSnapshot,
  TrackerClusteringOptions,
  TrackerConfiguration,
  TrackerConfigurationReplacement,
  TrackerCssVariableConstants,
  TrackerCssVariablePatch,
  TrackerCssVariablePatchValue,
  TrackerCssVariableValue,
  TrackerDataAttributeConstants,
  TrackerDebugStats,
  TrackerDebugTraceEntry,
  TrackerDestroyEventPayload,
  TrackerDiagnosticCode,
  TrackerDiagnosticEntry,
  TrackerDiagnosticStats,
  TrackerDiagnosticsOptions,
  TrackerDiagnosticsSink,
  TrackerErrorCode,
  TrackerErrorOptions,
  TrackerEventHandler,
  TrackerEventMarker,
  TrackerEventName,
  TrackerEventNameConstants,
  TrackerEventPayload,
  TrackerEventPayloadMap,
  TrackerEventUnsubscribe,
  TrackerFocusOptions,
  TrackerFocusOptionsObject,
  TrackerIntegrationMountRequest,
  TrackerInteractionOptions,
  TrackerIntervalUpdateOptions,
  TrackerLifecycleSnapshot,
  TrackerMarkerActivateEventPayload,
  TrackerMarkerDefaults,
  TrackerMarkerDefaultsSnapshot,
  TrackerMarkerLayerOptions,
  TrackerMarkerLayoutRecord,
  TrackerMarkerOptions,
  TrackerMarkerRecord,
  TrackerMarkerRecordContext,
  TrackerMarkerRenderRecord,
  TrackerMarkerSnapshot,
  TrackerMarkerStoreRebuildResult,
  TrackerMutationObserverOptions,
  TrackerMutationUpdateOptions,
  TrackerNormalizedFocusOptions,
  TrackerNormalizedMarkerAttributes,
  TrackerNormalizedMarkerOptions,
  TrackerNormalizedRule,
  TrackerNormalizedRuleCandidate,
  TrackerNormalizedScrollOptions,
  TrackerNormalizedUserAttributes,
  TrackerObserverTarget,
  TrackerObserverTargetsContext,
  TrackerObserverTargetsReason,
  TrackerObserverTargetsResolver,
  TrackerObserverType,
  TrackerOperationParams,
  TrackerOptions,
  TrackerOptionsCandidate,
  TrackerOptionsDiff,
  TrackerOptionsNormalizationContext,
  TrackerOptionsSnapshot,
  TrackerOptionsValidationContext,
  TrackerOptionsValidationResult,
  TrackerOrientation,
  TrackerOrientationConstants,
  TrackerPlacement,
  TrackerPlacementConstants,
  TrackerQueryMatch,
  TrackerReadonlyOptions,
  TrackerReadonlyRule,
  TrackerRenderControl,
  TrackerRenderReason,
  TrackerRenderReasonSource,
  TrackerRenderRecord,
  TrackerRenderSnapshot,
  TrackerRenderStatsSummary,
  TrackerRenderTarget,
  TrackerRenderer,
  TrackerRendererContext,
  TrackerRendererLike,
  TrackerRendererMethodName,
  TrackerRendererMountContext,
  TrackerRendererMountTarget,
  TrackerResizeUpdateOptions,
  TrackerResolvedA11yOptions,
  TrackerResolvedClusteringOptions,
  TrackerResolvedCssVariables,
  TrackerResolvedDiagnosticsOptions,
  TrackerResolvedInteractionOptions,
  TrackerResolvedIntervalUpdateOptions,
  TrackerResolvedMarkerDefaults,
  TrackerResolvedMarkerLayerOptions,
  TrackerResolvedMarkerPresentation,
  TrackerResolvedMutationUpdateOptions,
  TrackerResolvedOptions,
  TrackerResolvedResizeUpdateOptions,
  TrackerResolvedScrollUpdateOptions,
  TrackerResolvedTrackOptions,
  TrackerResolvedUpdateOptions,
  TrackerResolvedViewportOptions,
  TrackerRule,
  TrackerRuleCssVariables,
  TrackerRuleNormalizationContext,
  TrackerRuleSource,
  TrackerRuleValidationContext,
  TrackerRuleValidationResult,
  TrackerRulesValidationResult,
  TrackerScrollAlign,
  TrackerScrollBehavior,
  TrackerScrollMode,
  TrackerScrollOptions,
  TrackerScrollOptionsObject,
  TrackerScrollRoot,
  TrackerScrollUpdateOptions,
  TrackerSelectionChangeEventPayload,
  TrackerSelectionSnapshot,
  TrackerSnapshot,
  TrackerSnapshotItem,
  TrackerSnapshotListener,
  TrackerSnapshotStore,
  TrackerSnapshotUnsubscribe,
  TrackerSourceRoot,
  TrackerState,
  TrackerStats,
  TrackerSyncEndEventPayload,
  TrackerSyncStartEventPayload,
  TrackerTargetSpec,
  TrackerTrackActivateEventPayload,
  TrackerTrackOptions,
  TrackerTypedEventHandler,
  TrackerUnmountOptions,
  TrackerUpdateOptions,
  TrackerUserAttributeInputValue,
  TrackerUserAttributeValue,
  TrackerUserAttributes,
  TrackerValidationDiagnostic,
  TrackerViewportLayoutRecord,
  TrackerViewportOptions,
  TrackerViewportSnapshot,
  TrackerVisualSnapshot,
  TrackerWarningEventPayload,
};
