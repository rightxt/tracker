import type {
  TrackerAddRuleParams,
  TrackerConfigurationReplacement,
  TrackerEventName,
  TrackerEventUnsubscribe,
  TrackerLifecycleSnapshot,
  TrackerOperationParams,
  TrackerOptions,
  TrackerOrientation,
  TrackerPlacement,
  TrackerReadonlyOptions,
  TrackerReadonlyRule,
  TrackerRenderSnapshot,
  TrackerRendererContext,
  TrackerRule,
  TrackerScrollMode,
  TrackerScrollRoot,
  TrackerSelectionSnapshot,
  TrackerSnapshot,
  TrackerSnapshotListener,
  TrackerSnapshotUnsubscribe,
  TrackerSourceRoot,
  TrackerState,
  TrackerStats,
  TrackerTypedEventHandler,
} from '../../types.js';
import type { TrackerInstance } from '../../tracker/createTrackerInstance.js';
import type { TrackerStateRenderer } from './stateRenderer.js';

/** Test renderer construction context. */
type TrackerStateRendererContext = Partial<TrackerRendererContext>;

/** Test runtime mount request with a framework-owned root. */
interface TrackerStateMountRequest {
  sourceRoot?: TrackerSourceRoot | undefined;
  scrollRoot?: TrackerScrollRoot | undefined;
  renderRoot: HTMLElement;
}

/** Element-like visual props retained only by legacy behavioral comparisons. */
interface TrackerElementProps {
  readonly className: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly styleVars: Readonly<Record<string, string>>;
}

/** Root props retained only by legacy behavioral comparisons. */
interface TrackerRootProps extends TrackerElementProps {
  readonly orientation: TrackerOrientation;
  readonly placement: TrackerPlacement;
  readonly mounted: boolean;
  readonly scrollMode: TrackerScrollMode | null;
  readonly geometryAvailable: boolean;
}

/** Marker-layer props retained only by legacy behavioral comparisons. */
interface TrackerMarkersProps extends TrackerElementProps {
  readonly hidden: boolean;
}

/** Viewport props retained only by legacy behavioral comparisons. */
interface TrackerViewportProps extends TrackerElementProps {
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly hidden: boolean;
  readonly start: number;
  readonly size: number;
}

/** Item props retained only by legacy behavioral comparisons. */
interface TrackerMarkerProps extends TrackerElementProps {
  readonly key: string;
  readonly activationKey: string;
  readonly kind: 'marker' | 'cluster';
  readonly ruleIndex: number | null;
  readonly selector: string | null;
  readonly label: string | null;
  readonly title: string | null;
  readonly count: number | null;
  readonly markerKeys: readonly string[];
  readonly primaryMarkerKey: string | null;
  readonly selected: boolean;
  readonly clustered: boolean;
  readonly clusterKey: string | null;
  readonly interactive: boolean;
}

/** Snapshot-derived props retained only by test harnesses for comparison coverage. */
interface TrackerSnapshotProps {
  readonly mounted: boolean;
  readonly scrollMode: TrackerScrollMode | null;
  readonly geometryAvailable: boolean;
  readonly lifecycle: TrackerLifecycleSnapshot;
  readonly render: TrackerRenderSnapshot;
  readonly selection: TrackerSelectionSnapshot;
  readonly root: TrackerRootProps;
  readonly viewport: TrackerViewportProps;
  readonly markersLayer: TrackerMarkersProps;
  readonly items: readonly TrackerMarkerProps[];
  readonly markers: readonly TrackerMarkerProps[];
  readonly clusters: readonly TrackerMarkerProps[];
}

/** Test-only raw runtime facade used to preserve low-level behavior coverage. */
interface TrackerTestRuntime {
  instance: TrackerInstance;
  renderer: TrackerStateRenderer;
  addRule: (rule: unknown, params?: TrackerAddRuleParams) => void;
  activateFromEvent: (sourceEvent: PointerEvent | MouseEvent) => boolean;
  activateRenderRecord: (key: string, sourceEvent?: Event | null) => boolean;
  activateTrack: (sourceEvent: PointerEvent | MouseEvent) => boolean;
  destroy: () => void;
  getOptions: () => TrackerReadonlyOptions;
  getRoot: () => HTMLElement | null;
  getRules: () => readonly TrackerReadonlyRule[];
  getSnapshot: () => TrackerSnapshot;
  getSnapshotProps: () => TrackerSnapshotProps;
  getState: () => TrackerState;
  getStats: () => TrackerStats;
  handleKeyboardEvent: (sourceEvent: KeyboardEvent) => boolean;
  isDestroyed: () => boolean;
  isMounted: () => boolean;
  mount: (request: TrackerStateMountRequest) => void;
  off: <TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ) => boolean;
  on: <TEventName extends TrackerEventName>(
    eventName: TEventName,
    handler: TrackerTypedEventHandler<TEventName>,
  ) => TrackerEventUnsubscribe;
  removeRuleByIndex: (index: number, params?: TrackerOperationParams) => void;
  removeRuleBySelector: (selector: string, params?: TrackerOperationParams) => void;
  requestRender: () => void;
  render: (...args: unknown[]) => void;
  resetStats: () => void;
  replaceConfiguration: (configuration: TrackerConfigurationReplacement, params?: TrackerOperationParams) => void;
  replaceOptions: (options: Partial<TrackerOptions>, params?: TrackerOperationParams) => void;
  patchOptions: (options: Partial<TrackerOptions>, params?: TrackerOperationParams) => void;
  replaceRules: (rules: readonly TrackerRule[], params?: TrackerOperationParams) => void;
  subscribe: (listener: TrackerSnapshotListener) => TrackerSnapshotUnsubscribe;
  unmount: () => void;
  whenDestroyed: () => Promise<void>;
}

export type {
  TrackerElementProps,
  TrackerMarkerProps,
  TrackerMarkersProps,
  TrackerRootProps,
  TrackerSnapshotProps,
  TrackerStateMountRequest,
  TrackerStateRendererContext,
  TrackerTestRuntime,
  TrackerViewportProps,
};
