# @rightxt/tracker-core developer guide

Framework-neutral integration architecture and extension contracts for RXT Tracker. Core owns rule matching, geometry, clustering, interaction, scheduling, lifecycle, diagnostics, and immutable snapshots. Rendering is intentionally split into two first-class SPIs.

This guide is for developers implementing custom adapters, renderers, framework bindings, inspectors, and diagnostic tooling. Application developers should normally use one of the maintained adapters and consult the [application-facing Core README](./README.md) for shared options, rules, styling, keyboard behavior, events, and snapshots.

## Entry points

| Entry point                        | Purpose                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@rightxt/tracker-core`            | Shared configuration, rules, events, snapshots, errors, and validation helpers.                        |
| `@rightxt/tracker-core/projection` | Immutable granular web-presentation views for declarative DOM renderers.                               |
| `@rightxt/tracker-core/renderer`   | Direct Renderer facade, renderer hooks, records, presentation helpers, and canonical render constants. |
| `@rightxt/tracker-core/advanced`   | Privileged debug-trace access for supported integration facades.                                       |
| `@rightxt/tracker-core/style.css`  | Canonical stylesheet for renderers that implement the standard Light DOM contract.                     |

Core does not expose a raw mutable runtime instance. Use one visual SPI per integration; there is no aggregate state-renderer API.

## Choosing a visual SPI

Use Projection when a web framework owns DOM reconciliation through a reactive view graph. Element, React, Vue, and Angular use this path. Projection publishes coherent commits split into `chrome`, `items`, `mount`, `selection`, and `viewport` domains.

Use Direct Renderer when Core should call imperative rendering hooks. Vanilla and non-DOM backends such as Canvas, SVG, WebGL, and scene graphs use this path. Direct renderers receive borrowed render records and frozen renderer options.

Both paths preserve the same Core lifecycle, rule, event, interaction, and diagnostics semantics.

Projection is intentionally declarative and DOM-oriented, not a renderer-neutral semantic scene model. Its views describe element presentation through class names, attributes, and CSS custom properties. Choose Direct Renderer when the backend should receive semantic render records and map them imperatively to DOM, SVG, Canvas, WebGL, a scene graph, or another non-DOM representation.

## Runtime architecture

```text
options + rules
     |
     v
RuleStore -> QueryEngine -> MarkerStore -> LayoutEngine -> ClusterEngine
                                                       |
                                                       v
                                               render records
                                                       |
Observers -> RenderScheduler -> transactional render pipeline
                                  |              |
                                  |              +-> events / statistics / snapshots
                                  v
                         normalized renderer
                           /             \
                  direct hooks       projection domains
```

One integration facade owns one lifecycle generation, one active DOM realm, one renderer root, and one authority for rules, records, scheduling, interaction, and cleanup. Mount is transactional: Core validates roots, provisionally mounts the output boundary, connects runtime resources, completes the initial render, and only then publishes mounted state and staged events.

The raw mutable runtime, controllers, stores, scheduler state, renderer normalization, and transaction machinery are internal. Custom integrations compose through an opaque Projection or Direct Renderer facade.

## Shared configuration

```ts
import type { TrackerConfiguration } from '@rightxt/tracker-core';

const configuration: TrackerConfiguration = {
  options: {
    a11y: { enabled: true, keyboard: true },
    clustering: { enabled: true, threshold: 2 },
    orientation: 'vertical',
    placement: 'left',
  },
  rules: [
    {
      selector: '.validation-error',
      label: (element) => element.textContent,
      marker: {
        className: 'validation-marker',
        cssVariables: { '--rxtt-marker-bg': '#dc2626' },
      },
      scroll: { enabled: true, behavior: 'smooth', align: 'center', target: 'self' },
      focus: { enabled: true, target: 'self' },
    },
  ],
};
```

Configuration validation is strict and transactional. Unknown keys, invalid values, duplicate selectors, and an explicitly supplied `undefined` field reject the complete operation with `TrackerConfigurationError`. Omission and `null` retain their field-specific meanings.

Rules are ordered. The first matching rule owns a source element. `sourceRoot` accepts `Document | Element | ShadowRoot`; `scrollRoot` accepts `Window | HTMLElement`. All roots in a mounted generation must belong to the same DOM realm.

## Projection SPI

```ts
import { createTrackerProjectionIntegration } from '@rightxt/tracker-core/projection';

const renderRoot = document.querySelector<HTMLElement>('#tracker')!;
const integration = createTrackerProjectionIntegration(configuration);

const unsubscribe = integration.subscribeProjection(({ changed, state }) => {
  if (changed.includes('items')) {
    reconcileItems(state.items);
  }

  if (changed.includes('selection')) {
    updateSelection(state.selection);
  }
});

integration.mount({ renderRoot, sourceRoot: document, scrollRoot: window });
```

`TrackerProjectionState` contains:

- `chrome`: immutable root and marker-layer views;
- `items`: ordered immutable `TrackerItemView[]` values;
- `mount`: mounted, scroll-mode, and geometry availability state;
- `selection`: previous and current item keys;
- `viewport`: immutable viewport view;
- `generation` and `revision`: lifecycle-generation and coherent-commit counters.

Each item view contains only `key`, `className`, `attributes`, and `styleVars`. This is a declarative web-presentation contract:

- `className` contains the canonical marker service class plus application presentation classes;
- `attributes` carries canonical kind, key, cluster count, optional title, and application attributes;
- `styleVars` carries canonical marker geometry plus application CSS custom properties;
- selection remains a separate keyed domain and is not copied into every item.

The view contains no source `Element`, normalized rule, scroll/focus policy, marker/cluster record graph, or other Direct Renderer authority. The maps, item objects, and items array are frozen. Core resolves presentation inside the same renderer transaction as the item commit, so adapters do not maintain a second marker-default authority.

The `changed` list is exact. Domains that did not change retain reference identity. In particular, viewport-only and selection-only commits do not reconstruct `items`. A failed renderer transaction publishes nothing; a listener failure causes the next successful publication to resynchronize every domain.

Projection lifecycle and operations include `mount`, `unmount`, `destroy`, `render`, `requestRender`, `flushRender`, `replaceConfiguration`, events, stats, projection reads/subscriptions, and `whenDestroyed`. Framework adapters should expose framework-native public handles rather than forwarding the complete SPI.

### Projection adapter responsibilities

A Projection adapter must:

- initialize its stores or signals from `getProjection()` before subscribing;
- apply every changed domain from one commit coherently before notifying framework consumers;
- retain stable item keys and keep selection as a separate keyed concern;
- preserve commit order when framework scheduling can defer or reorder work;
- mount only after its framework-owned `renderRoot` is connected;
- translate Core events into the framework's native outward event model;
- keep server and first-client inputs deterministic when supporting hydration;
- unsubscribe, unmount, and destroy the generation it owns.

Core attaches delegated interaction listeners to the committed framework-owned root. A Projection adapter should not add a second path through internal or manual interaction functions.

## Direct Renderer SPI

```ts
import { createTrackerRendererIntegration, type TrackerRendererLike } from '@rightxt/tracker-core/renderer';

const root = document.querySelector<HTMLElement>('#tracker')!;

const renderer: TrackerRendererLike = {
  mount(context) {
    return context.target.kind === 'root' ? context.target.root : null;
  },
  unmount() {
    root.replaceChildren();
  },
  renderTrack(options) {
    renderTrack(root, options);
  },
  renderMarkers(records, options, markerDefaults) {
    renderItems(root, records, options, markerDefaults);
  },
  renderViewport(layout, options) {
    renderViewport(root, layout, options);
  },
  renderSelection(previousKey, nextKey) {
    renderSelection(root, previousKey, nextKey);
  },
};

const integration = createTrackerRendererIntegration(configuration, { renderer });

integration.mount({
  rendererTarget: { kind: 'root', root },
  sourceRoot: document,
  scrollRoot: window,
});
```

The opaque `TrackerRendererIntegration` facade provides supported lifecycle, configuration/rule mutation, full render/request-render, events, stats, snapshots, destruction observation, and semantic keyed activation. It does not expose controllers, stores, scheduler state, renderer normalization, transactions, or the underlying runtime instance.

Renderer hooks are synchronous. Returned promises are not awaited. Render records and their source elements are borrowed for the duration of a hook and must not be mutated or retained. Renderer options and marker defaults are immutable snapshots.

### Semantic activation for non-DOM items

A renderer with adapter-owned hit testing activates the current marker or cluster by key:

```ts
canvas.addEventListener('click', (event) => {
  const key = hitTestCanvas(event);

  if (key !== null && integration.activateItem(key, { sourceEvent: event })) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
});
```

`activateItem()` returns `true` only when Core handled a current key. It preserves stale-key diagnostics, marker/cluster events, configured scroll and focus behavior, lifecycle guards, reentrancy, and duplicate suppression for the same `sourceEvent`.

Background track activation, drag, keyboard navigation, and keyboard activation normally use Core's delegated listeners on the renderer root. A renderer should not forward those DOM events through a second manual API.

### Direct Renderer ownership and failures

The renderer owns its output nodes or backend objects, keyed reconciliation, local hit-test data, and cleanup of resources created by renderer hooks. Core owns record computation, invalidation, hook ordering, semantic activation, runtime events, and lifecycle state.

`mount()` must return the exact connected root target or a connected strict descendant created for a host target. Returning a disconnected element, a foreign-realm element, or a root containing the tracked source rejects the mount. One root cannot belong to competing active integrations.

Core rolls back its records, selection, statistics, dirty target, and publication staging when a renderer hook throws. It cannot undo renderer-owned DOM writes, Canvas commands, subscriptions, timers, or partially changed external dependencies. Validate before creating resources or clean up partial work locally before rethrowing.

Implement reversible `unmount()` whenever `destroy()` performs permanent teardown. If `unmount()` is absent, Core uses `destroy()` as the per-mount cleanup fallback, so that method must remain idempotent and compatible with remounting.

## Snapshots and events

Both `TrackerProjectionIntegration` and `TrackerRendererIntegration` expose `getSnapshot()` and `subscribeSnapshot()` for the runtime owned by that facade. `TrackerSnapshot` is a deeply frozen observation graph, independent of both visual update protocols. Snapshot subscriptions support devtools, telemetry, diagnostics, and assertions, not a third rendering architecture.

Supported event names are:

- `marker:activate`;
- `cluster:activate`;
- `track:activate`;
- `selection:change`;
- `sync:start`;
- `sync:end`;
- `warning`;
- `destroy`.

Integration event handlers run synchronously in registration order. Because these handlers implement the renderer/projection bridge, Core isolates their failures and observes returned thenables as `integration-event-handler-error` diagnostics. First-party adapters register only their bridge forwarder here; application callbacks stay in the adapter or framework-native notification channel.

Snapshot listeners are application observers. Their synchronous failures are reported through the host error channel, returned thenables are not inspected, and neither case becomes Core health diagnostics. Projection subscribers are different: they are integration-owned and may still produce `projection-listener-error`. A mutation requested reentrantly from an event or snapshot callback is validated at call time and applied after the active public-dispatch boundary.

## Mounting and DOM realms

- `sourceRoot: Document | Element | ShadowRoot` scopes selector matching and default mutation observation. An `Element` source matches descendants, not itself.
- `scrollRoot: Window | HTMLElement` identifies the represented viewport. An element root must satisfy Core's supported scroll-profile validation.
- Projection receives a framework-owned `renderRoot`; Direct Renderer receives a root or host `rendererTarget`.
- Source, scroll root, renderer target/root, observers, scheduling, and scrolling must belong to one document and window.
- Core does not combine parent and iframe nodes, project output across documents, or automatically traverse arbitrary Shadow DOM boundaries.

Mount only after `document.body` and the intended renderer target are connected. When the active DOM realm changes, unmount and remount instead of trying to mutate internal context.

## Lifecycle

`mount()` begins one reversible generation. `unmount()` releases roots, observers, listeners, scheduled work, and renderer-owned resources while allowing a later mount. `destroy()` is permanent and idempotent. `whenDestroyed()` resolves after terminal cleanup, including when destruction was deferred by reentrant work.

A Direct Renderer `mount()` must return its connected root. With a `host` target it may create and attach a root; with a `root` target it normally adopts that exact element. Implement `unmount()` when `destroy()` performs irreversible teardown, because Core otherwise uses `destroy()` as the per-cycle cleanup fallback.

## Styling contract

Import `@rightxt/tracker-core/style.css` only when the custom renderer produces the canonical Light DOM structure:

```html
<div class="rxtt" data-rxtt-orientation="vertical" data-rxtt-placement="left">
  <div class="rxtt__viewport"></div>
  <div class="rxtt__markers">
    <div class="rxtt__marker" data-rxtt-kind="marker" data-rxtt-key="..."></div>
  </div>
</div>
```

`CLASS_NAMES`, `DATA_ATTRIBUTES`, and `CSS_VARIABLES` are exported from `/renderer`. Load application theme CSS after the canonical stylesheet and in the same document or ShadowRoot as the rendered tree.

## First-party reference mapping

| Package | Core boundary   | Rendering ownership                                 | Public integration style       |
| ------- | --------------- | --------------------------------------------------- | ------------------------------ |
| Vanilla | Direct Renderer | `DomRenderer` imperatively owns canonical Light DOM | `Tracker` class facade         |
| Element | Projection      | Custom Element reconciles owned Light DOM           | element properties and methods |
| React   | Projection      | React components and external stores                | props and imperative ref       |
| Vue     | Projection      | Vue VNodes and shallow refs                         | props, emits, and exposed API  |
| Angular | Projection      | template, signals, directives, and `Renderer2`      | inputs, outputs, and methods   |

These packages are reference ownership patterns, not a requirement to expose one shared declarative handle. Each adapter should present native lifecycle and event conventions while keeping the Core facade private.

## Diagnostics and advanced access

`getStats()` is available on both integration facades. Enable timing metrics with `options.diagnostics.metrics`; warnings use the configured diagnostics sink or the console.

`@rightxt/tracker-core/advanced` exports only `getTrackerDebugTrace()` and its integration/entry types. It accepts an opaque Projection or Direct Renderer facade. Production builds return `null`; development/debug builds return retention-safe trace entries. Scheduler mutation and raw record inspection are intentionally internal.

The `/advanced` admission rule is deliberately strict: a symbol may enter this subpath only when a concrete external privileged use exists and the capability cannot reasonably be exposed through a normal SPI. Test convenience, hypothetical future use, and access to an internal implementation detail are not sufficient.

## Performance evidence scope

The Projection boundary benchmark is a local regression guard. Its before/after workloads use the same item counts, scenarios, warm-up policy, sample count, environment, and total-work accounting. It verifies preserved narrow-update identity and found no substantial unexplained regression in the controlled run.

It does not measure framework reconciliation, browser layout or paint, and it does not prove that Projection is universally faster. Its allocation proxy counts item-array and corresponding item-reference identity changes; it does not measure heap bytes, garbage-collection cost, or every temporary allocation.

## Integration anti-patterns

- Mixing source, scroll, target, or renderer roots from different DOM realms.
- Returning a disconnected renderer root or one that contains the tracked source root.
- Mutating Core from synchronous label or target resolver callbacks.
- Treating framework reconciliation as synchronous work completed inside a Core renderer hook.
- Mutating or retaining borrowed Direct Renderer records across hooks or lifecycle generations.
- Building a whole-snapshot visual adapter when Projection supplies narrower domains.
- Wiring manual interaction handling in addition to Core's delegated root listeners.
- Assuming Core can roll back renderer-owned output or resources after a hook throws.
- Omitting adapter-owned subscription, effect, node, observer, or timer cleanup.
- Depending on debug traces or diagnostic timings in production application logic.

## Cleanup

Renderers and adapters must release event listeners, observers, item caches, source-element references, and owned nodes during `unmount()` and terminal cleanup. Projection drops its retained source-bearing records at unmount while published item views remain DOM-reference-free. Do not retain borrowed Direct Renderer records beyond their callback.

## License

[MIT](https://github.com/rightxt/tracker/blob/main/LICENSE)
