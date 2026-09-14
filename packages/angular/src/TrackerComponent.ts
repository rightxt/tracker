import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  Renderer2,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { resolveTrackerOptions } from '@rightxt/tracker-core';
import { projectTrackerChromeView } from '@rightxt/tracker-core/projection';
import {
  TrackerProjectionElementDirective,
  applyElementView,
  attemptAdapterCleanup,
  createProjectionRuntime,
  createRuntimeConfiguration,
  throwAdapterLifecycleErrors,
} from './projectionAdapter.js';

import type {
  TrackerClusterActivateEventPayload,
  TrackerEventUnsubscribe,
  TrackerMarkerActivateEventPayload,
  TrackerOptions,
  TrackerRule,
  TrackerScrollRoot,
  TrackerSelectionChangeEventPayload,
  TrackerSourceRoot,
  TrackerState,
  TrackerStats,
  TrackerSyncEndEventPayload,
  TrackerSyncStartEventPayload,
  TrackerTrackActivateEventPayload,
  TrackerWarningEventPayload,
} from '@rightxt/tracker-core';
import type { TrackerItemView } from '@rightxt/tracker-core/projection';
import type { AppliedElementViewNames } from './projectionAdapter.js';

/** Applies selection transitions to registered keyed item elements. */
class AngularItemRegistry {
  readonly #elements = new Map<string, HTMLElement>();
  readonly #renderer: Renderer2;
  #selectedKey: string | null = null;

  /**
   * @param renderer - Angular renderer used for selection attribute ownership.
   */
  constructor(renderer: Renderer2) {
    this.#renderer = renderer;
  }

  /** Registers one live item element and synchronizes its selected state. */
  register(key: string, element: HTMLElement): void {
    this.#elements.set(key, element);

    if (key === this.#selectedKey) {
      this.#renderer.setAttribute(element, 'data-rxtt-selected', 'true');
    } else {
      this.#renderer.removeAttribute(element, 'data-rxtt-selected');
    }
  }

  /** Removes a key only when it still points to the retiring element. */
  unregister(key: string, element: HTMLElement): void {
    if (this.#elements.get(key) === element) {
      this.#elements.delete(key);
    }
  }

  /** Applies one Core selection transition without invalidating the item view. */
  select(previousKey: string | null, selectedKey: string | null): void {
    if (previousKey !== null && previousKey !== selectedKey) {
      const previousElement = this.#elements.get(previousKey);

      if (previousElement !== undefined) {
        this.#renderer.removeAttribute(previousElement, 'data-rxtt-selected');
      }
    }

    if (selectedKey !== null) {
      const selectedElement = this.#elements.get(selectedKey);

      if (selectedElement !== undefined) {
        this.#renderer.setAttribute(selectedElement, 'data-rxtt-selected', 'true');
      }
    }

    this.#selectedKey = selectedKey;
  }
}

/** Applies a pre-projected item view with no per-item signals or effects. */
@Directive({
  selector: '[rxtProjectionItem]',
  standalone: true,
})
class TrackerProjectionItemDirective implements OnDestroy {
  /** Current immutable item view. */
  readonly view = input.required<TrackerItemView>({ alias: 'rxtProjectionItem' });

  /** Registry shared by the item layer. */
  readonly registry = input.required<AngularItemRegistry>();

  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #renderer = inject(Renderer2);
  readonly #applied: AppliedElementViewNames = { attributeNames: new Set(), styleVariableNames: new Set() };
  #registeredKey: string | null = null;

  constructor() {
    effect(() => {
      const view = this.view();
      const registry = this.registry();

      if (this.#registeredKey !== null && this.#registeredKey !== view.key) {
        registry.unregister(this.#registeredKey, this.#element);
      }

      applyElementView(this.#renderer, this.#element, view, this.#applied);
      registry.register(view.key, this.#element);
      this.#registeredKey = view.key;
    });
  }

  /** Releases the retiring element from the shared registry. */
  ngOnDestroy(): void {
    if (this.#registeredKey !== null) {
      this.registry().unregister(this.#registeredKey, this.#element);
    }
  }
}

/** Angular visual tree with a single reactive boundary for all items. */
const TRACKER_PROJECTION_TEMPLATE = `
  <div #renderRoot [rxtProjectionElement]="rootView">
    <div [rxtProjectionElement]="viewport" [hidden]="viewport().hidden"></div>
    <div [rxtProjectionElement]="markersLayerView" [hidden]="markersLayerView().hidden">
      @for (item of items(); track item.key) {
        <div [rxtProjectionItem]="item" [registry]="itemRegistry"></div>
      }
    </div>
  </div>
`;

/** Angular Tracker component with domain signals and one non-reactive writer per keyed item. */
@Component({
  selector: 'rxt-tracker-angular',
  standalone: true,
  imports: [TrackerProjectionElementDirective, TrackerProjectionItemDirective],
  template: TRACKER_PROJECTION_TEMPLATE,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TrackerComponent implements AfterViewInit, OnDestroy {
  /** Non-rule Tracker options. An explicitly `undefined` value is treated as omission. */
  readonly options = input<Partial<TrackerOptions> | undefined>({});

  /** Authoritative immutable rule list. */
  readonly rules = input<readonly TrackerRule[] | undefined>();

  /** Source query root. Null keeps the adapter unmounted. */
  readonly sourceRoot = input<TrackerSourceRoot | null | undefined>();

  /** Represented page or element viewport. Null keeps the adapter unmounted. */
  readonly scrollRoot = input<TrackerScrollRoot | null | undefined>();

  /** Emits marker activation payloads. */
  readonly markerActivate = output<TrackerMarkerActivateEventPayload>();

  /** Emits cluster activation payloads. */
  readonly clusterActivate = output<TrackerClusterActivateEventPayload>();

  /** Emits after a Core synchronization transaction succeeds. */
  readonly syncEnd = output<TrackerSyncEndEventPayload>();

  /** Emits when a Core synchronization transaction starts. */
  readonly syncStart = output<TrackerSyncStartEventPayload>();

  /** Emits when the committed logical selection changes. */
  readonly selectionChange = output<TrackerSelectionChangeEventPayload>();

  /** Emits when the track is activated to scroll to a position. */
  readonly trackActivate = output<TrackerTrackActivateEventPayload>();

  /** Emits runtime warnings. */
  readonly warning = output<TrackerWarningEventPayload>();

  /** Template-reference query for the root render host. */
  @ViewChild('renderRoot') private renderRootElementRef?: ElementRef<HTMLElement>;

  readonly #ngZone = inject(NgZone);
  readonly #runtime = this.#ngZone.runOutsideAngular(() => createProjectionRuntime({ options: {}, rules: [] }));

  /** Whether this component generation may connect Core to live browser DOM. */
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  /**
   * Validated configuration shared by chrome rendering and Core mounting.
   * Throws for invalid options or rules on every platform, so a bad input
   * fails identically during server rendering and browser hydration instead
   * of silently defaulting on the server and only surfacing once the client
   * attempts to mount.
   */
  readonly #configuration = computed(() => createRuntimeConfiguration(this.options(), this.rules()));
  readonly #resolvedOptions = computed(() => resolveTrackerOptions(this.#configuration().options));
  readonly #chrome = computed(() => projectTrackerChromeView(this.#resolvedOptions(), this.#runtime.stores.mount()));

  /** Isolated root-element view. */
  readonly rootView = computed(() => this.#chrome().root);

  /** Isolated markers-layer view. */
  readonly markersLayerView = computed(() => this.#chrome().markersLayer);

  /** Isolated viewport-domain signal. */
  readonly viewport = this.#runtime.stores.viewport;

  /** Isolated items-domain signal. */
  readonly items = this.#runtime.stores.items;

  /** Registry providing O(1) selection without per-item reactive consumers. */
  readonly itemRegistry = new AngularItemRegistry(inject(Renderer2));

  #viewReady = false;
  #eventUnsubscribes: TrackerEventUnsubscribe[] = [];
  #appliedSourceRoot: TrackerSourceRoot | null | undefined;
  #appliedScrollRoot: TrackerScrollRoot | null | undefined;
  #appliedOptions: Partial<TrackerOptions> | undefined;
  #appliedRules: readonly TrackerRule[] | undefined;

  constructor() {
    effect(() => {
      const selection = this.#runtime.stores.selection();

      this.itemRegistry.select(selection.previousKey, selection.selectedKey);
    });

    effect(() => {
      const options = this.options();
      const rules = this.rules();
      const sourceRoot = this.sourceRoot();
      const scrollRoot = this.scrollRoot();

      if (!this.#viewReady || !this.#isBrowser) {
        return;
      }

      const configurationChanged = !Object.is(options, this.#appliedOptions) || !Object.is(rules, this.#appliedRules);
      const rootsChanged =
        !Object.is(sourceRoot, this.#appliedSourceRoot) ||
        !Object.is(scrollRoot, this.#appliedScrollRoot) ||
        (sourceRoot !== null && scrollRoot !== null && !this.#runtime.integration.isMounted());

      if (rootsChanged) {
        this.#remount(configurationChanged);
      } else if (configurationChanged) {
        this.#applyOptionsAndRules();
      }
    });
  }

  /** Connects event subscriptions before mounting the Core runtime. */
  ngAfterViewInit(): void {
    this.#viewReady = true;

    if (!this.#isBrowser) {
      return;
    }

    this.#eventUnsubscribes.push(
      this.#runtime.integration.on('marker:activate', (payload) => this.#emit(this.markerActivate, payload)),
      this.#runtime.integration.on('cluster:activate', (payload) => this.#emit(this.clusterActivate, payload)),
      this.#runtime.integration.on('sync:start', (payload) => this.#emit(this.syncStart, payload)),
      this.#runtime.integration.on('sync:end', (payload) => this.#emit(this.syncEnd, payload)),
      this.#runtime.integration.on('selection:change', (payload) => this.#emit(this.selectionChange, payload)),
      this.#runtime.integration.on('track:activate', (payload) => this.#emit(this.trackActivate, payload)),
      this.#runtime.integration.on('warning', (payload) => this.#emit(this.warning, payload)),
    );

    // A failed initial mount leaves Core's own runtime rolled back to a live
    // `unmounted` state (see `mountTrackerInstance()`), not destroyed. Keep
    // `#viewReady` true and the runtime/event bridges intact — rather than
    // tearing them down here — so the reconciliation `effect()` above can
    // recover the same generation once the caller corrects
    // `sourceRoot`/`scrollRoot`. Full destruction stays reserved for genuine
    // teardown in `ngOnDestroy()`.
    this.#remount(true);
  }

  /** Destroys the owned runtime and releases external subscriptions. */
  ngOnDestroy(): void {
    const errors: unknown[] = [];

    this.#releaseRuntimeResources(errors);
    throwAdapterLifecycleErrors(errors, 'Angular Tracker projection destruction failed.');
  }

  /** Returns the current lifecycle state. */
  getState(): TrackerState {
    return this.#runtime.integration.getState();
  }

  /** Returns the current diagnostics snapshot. */
  getStats(): TrackerStats {
    return this.#runtime.integration.getStats();
  }

  /** Performs an immediate refresh. */
  refresh(): void {
    this.#ngZone.runOutsideAngular(() => this.#runtime.integration.render());
  }

  /** Requests a coalesced refresh. */
  requestRefresh(): void {
    this.#ngZone.runOutsideAngular(() => this.#runtime.integration.requestRender());
  }

  /** Resets diagnostic counters. */
  resetStats(): void {
    this.#runtime.integration.resetStats();
  }

  /** Resolves after this Core runtime generation is permanently destroyed. */
  whenRuntimeDestroyed(): Promise<void> {
    return this.#runtime.integration.whenDestroyed();
  }

  /** Applies current immutable options and authoritative rules. */
  #applyOptionsAndRules(): void {
    const configuration = this.#configuration();

    this.#ngZone.runOutsideAngular(() => {
      this.#runtime.integration.replaceConfiguration(configuration);

      if (this.#runtime.integration.isMounted()) {
        this.#runtime.integration.flushRender();
      }
    });
    this.#appliedOptions = this.options();
    this.#appliedRules = this.rules();
  }

  /** Remounts Core against the current DOM-reference identities. */
  #remount(applyConfiguration = false): void {
    const runtimeConfiguration = this.#configuration();

    this.#ngZone.runOutsideAngular(() => {
      if (this.#runtime.integration.isMounted()) {
        this.#runtime.integration.unmount();
      }

      if (applyConfiguration) {
        this.#runtime.integration.replaceConfiguration(runtimeConfiguration);
      }
    });

    // Checkpoint immediately: replaceConfiguration() above already committed, independent of
    // whether the mount attempt below (for a root change bundled into the same update)
    // subsequently succeeds or throws.
    if (applyConfiguration) {
      this.#appliedOptions = this.options();
      this.#appliedRules = this.rules();
    }

    const renderRoot = this.renderRootElementRef;
    const sourceRoot = this.sourceRoot();
    const scrollRoot = this.scrollRoot();

    this.#ngZone.runOutsideAngular(() => {
      if (renderRoot !== undefined && sourceRoot !== null && scrollRoot !== null) {
        this.#runtime.integration.mount({
          ...(sourceRoot === undefined ? {} : { sourceRoot }),
          ...(scrollRoot === undefined ? {} : { scrollRoot }),
          renderRoot: renderRoot.nativeElement,
        });
      }
    });

    // Reached only when mount() above either succeeded or was intentionally skipped (null
    // roots); a thrown mount leaves this reflecting the roots of the last actually-mounted
    // generation instead of the rejected candidate.
    this.#appliedSourceRoot = sourceRoot;
    this.#appliedScrollRoot = scrollRoot;
  }

  /** Destroys the runtime and releases every adapter-owned subscription. */
  #releaseRuntimeResources(errors: unknown[]): void {
    attemptAdapterCleanup(() => this.#ngZone.runOutsideAngular(() => this.#runtime.integration.destroy()), errors);
    this.#eventUnsubscribes.forEach((unsubscribe) => attemptAdapterCleanup(unsubscribe, errors));
    this.#eventUnsubscribes = [];
  }

  /** Emits one runtime payload inside Angular's zone. */
  #emit<TPayload>(emitter: { emit: (payload: TPayload) => void }, payload: TPayload): void {
    this.#ngZone.run(() => emitter.emit(payload));
  }
}

export { AngularItemRegistry, TrackerComponent, TrackerProjectionItemDirective };
