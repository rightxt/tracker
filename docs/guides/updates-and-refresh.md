# Updates and manual refresh

Tracker must synchronize when tracked content or its geometry changes. Automatic update sources cover common DOM and browser signals; manual synchronization covers changes the browser does not report through those sources. This guide explains the behavior around `updates.*`; each [package README](../../README.md) owns its option and method reference.

## Update model

Four public families feed a common scheduler:

| Family   | Runtime signal                                              | Effect                                                                                 |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Mutation | `MutationObserver`                                          | Accepted external mutation batches request marker synchronization.                     |
| Resize   | `ResizeObserver` and active Window `resize`                 | Two independent mechanisms share a resize debounce and request marker synchronization. |
| Scroll   | Authoritative scroll root and relevant descendant scrolling | Frame-coalesced requests update marker and viewport geometry.                          |
| Interval | Active-realm timer                                          | Independent polling requests marker synchronization.                                   |

Mutation, resize, and scroll updates are enabled by default; interval polling is disabled by default. The five runtime mechanisms above do not imply five public option families. Initial mount performs its own synchronization and does not wait for an observer event.

Automatic marker synchronization includes querying and reconciling source records, measuring geometry, clustering/rendering markers, and updating the viewport. It can be more work than moving a viewport indicator. Disabling an update family leaves the Tracker mounted, but makes changes that depended on that family the application's synchronization responsibility.

## Mutation updates

By default, `updates.mutation` observes `sourceRoot`. Its normal native scope includes child-list changes and descendants; attributes and character data are opt-in categories. A custom synchronous `updates.mutation.targets` resolver can select a broader or narrower observation scope independently of selector scope.

Configure native behavior under `updates.mutation.options`: `childList` observes added/removed child nodes, `subtree` extends the configured categories to descendants, `attributes` observes attributes, and `characterData` observes text-node data. These fields are booleans. `attributeFilter` restricts observed attribute names; optional boolean `attributeOldValue` and `characterDataOldValue` request previous values in native records. Tracker uses accepted batches to invalidate geometry rather than publishing those individual records.

The effective native options must enable at least one of child-list, attributes, or character data; `subtree` alone is not an observation category. A nonempty `attributeFilter` or `attributeOldValue: true` enables native attribute observation even if the parent flag was false. `characterDataOldValue: true` similarly enables character data. An attribute filter must be a nonempty, nonsparse list of nonempty strings. These dependencies matter when replacing or patching the observation configuration.

Accepted external callbacks reset a trailing `updates.mutation.debounce` timer. Repeated callbacks inside the debounce window postpone one request. A batch containing only Tracker-owned DOM mutations is ignored; a mixed batch with an external change is relevant. Broad custom targets can therefore schedule work for external changes outside the source subtree, while the rules still query only `sourceRoot`.

The active Window supplies `MutationObserver`; there is no ambient-realm substitute. If it is unavailable, a warning is reported and mutation updates remain disconnected. Other families and manual synchronization remain available. A failed `observe()` target is diagnosed while other targets are attempted; successful targets remain observed. If none succeed, the mutation branch is disconnected. There is no automatic mutation emulation fallback.

### Renderer feedback

Tracker-owned output inside registered render roots is filtered, including owned additions/removals delivered around cleanup. Custom renderers must keep their visual writes within their registered actual root. Writes to unrelated application DOM outside that root are not automatically internal: if observed, they can legitimately schedule another synchronization. A broad observation target does not make all application writes part of Tracker's own output.

## Resize updates

`updates.resize.enabled` controls both active-realm `ResizeObserver` and active Window `resize`. `updates.resize.targets` affects only the observer's element targets; it does not select or disable the Window listener.

Both mechanisms reset the same trailing `updates.resize.debounce` timer. A debounce window that receives both kinds of signal preserves both source reasons in its eventual request. The observer callback is relevant without exposing individual entry data through synchronization events.

If `ResizeObserver` is unavailable, or its targets are empty or all fail to connect, the Window resize path can still work. It handles window-size changes, but does not emulate arbitrary element-box observation. Per-target failures are diagnosed without discarding other successfully observed targets.

## Scroll updates

The authoritative listener belongs to the active Window in page mode or the selected HTMLElement in element mode. Relevant descendant scrolling is also captured in the active document and, when the source belongs to a ShadowRoot, in that containing ShadowRoot. Unrelated nested shadow trees are not automatically discovered.

Scroll bursts coalesce through an active-realm frame callback before entering the common scheduler. A native scroll event does not guarantee one render or one frame of work. Scroll updates keep geometry correct when sticky/fixed content or nested scrolling changes positions, and update the viewport indicator.

Disabling `updates.scroll` also stops automatic viewport synchronization from scrolling. It does not disable scrolling itself: semantic activation and `interaction.drag` can still scroll. Drag movement is separate from discrete `track:activate` notification and is not a substitute for an update source. Choose manual refresh or another suitable signal if geometry must follow those changes with scroll updates disabled.

## Interval updates

`updates.interval` provides independent polling at its configured `delay`, using the active Window's timer. Enabling it does not turn off mutation, resize, or scroll updates. Ticks request marker synchronization through the scheduler rather than starting overlapping renders. Changing the delay while mounted reconnects the timer. Polling may help when no suitable event exists, but explicit refresh after an application-owned change is more deterministic.

## Observation targets

Both target options accept synchronous resolver functions. The context provides `observerType`, `sourceRoot`, `scrollRoot`, `scrollMode`, `renderRoot`, `document`, `window`, `defaultTargets`, and `reason`. `observerType` identifies mutation or resize observation; the root/mode fields describe the current mount, and `defaultTargets` provides that observer's runtime defaults. `reason` identifies the connection trigger, such as `mount` or `options:update`. Use those active-realm values rather than an assumed ambient document. Resolvers run when observation connects, including mount and relevant configuration updates, rather than on every observer event.

| Target behavior           | Mutation                                                                       | ResizeObserver                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Default targets           | `sourceRoot`.                                                                  | Source Element or source ShadowRoot host, element scroll root if present, and actual render root; duplicates removed. |
| Accepted target kind      | Nodes belonging to the active document.                                        | Elements belonging to the active document.                                                                            |
| Internal DOM              | Tracker-internal nodes are filtered, including the actual render root.         | Internal nodes are filtered, except the exact active render root is allowed to observe its size.                      |
| Duplicate targets         | Collapsed in first-occurrence order.                                           | Collapsed in first-occurrence order.                                                                                  |
| Throw or non-array result | Warning and fresh runtime default targets.                                     | Warning and fresh runtime default targets.                                                                            |
| Explicit empty array      | Intentionally no MutationObserver target; an empty-target warning is reported. | Intentionally no ResizeObserver target; Window resize remains independent.                                            |

Invalid and foreign-document targets are diagnosed and ignored. A list emptied by filtering leaves that observer disconnected. Returning a Promise is not supported: resolvers are synchronous and an asynchronous result is not awaited. Return an array, including `[]` when deliberately disabling targets, rather than relying on an invalid result to disable observation.

Resolvers are computations, not lifecycle hooks. Do not change the same Tracker's state from a resolver during mount or configuration reconciliation. Compute targets from context/application state, then change Tracker through a normal public operation outside that computation.

## Scheduling and coalescing

Mutation debounce, shared resize debounce, and scroll frame coalescing are source-local stages. Interval ticks have no local debounce. Their requests then share the same scheduler with public manual requests and configuration work.

Pending targets merge so a broader request can subsume narrower work. Source reasons accumulate rather than simply retaining the last event. Execution normally waits for the active Window's animation frame; where the required frame APIs are unavailable, a zero-delay active-Window timer supplies the scheduling boundary.

Render runs do not overlap. A request arriving during a run remains pending for follow-up work. Unmount/destroy cancels pending scheduler work and delayed observer work for that generation; callbacks from retired Core connections do not revive it. Iframe navigation itself is not a Core reconnect—use the [remount workflow](environments.md#navigation-and-remounting).

### Reading synchronization reasons

Observation/manual source names include `mutation`, `resize-observer`, `window-resize`, `scroll`, `interval`, `public-render`, and `request-render`. The reason can contain nested `reasons` combining several origins. Do not assume a one-event-to-one-render ratio or an exhaustive event history.

`render()` requests complete work and immediately flushes the same scheduler. Consequently a Core `sync:start` can report `scheduled: true` even though `render()` ran synchronously from the caller's perspective. This flag describes scheduler ownership, not a promise that execution happened after the call returned. `sync:start` and `sync:end` describe Core synchronization, not a framework DOM commit, browser layout, or paint.

## Manual synchronization

| Integration                        | Immediate complete synchronization          | Scheduled/coalesced complete synchronization       |
| ---------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| Core Projection or Direct Renderer | `render()`                                  | `requestRender()`                                  |
| Vanilla                            | `render()`                                  | `requestRender()`                                  |
| Element                            | `render()` on the custom element            | `requestRender()` on the custom element            |
| React                              | `refresh()` on the imperative handle        | `requestRefresh()` on the imperative handle        |
| Vue                                | `refresh()` on the exposed component handle | `requestRefresh()` on the exposed component handle |
| Angular                            | `refresh()` on the component instance       | `requestRefresh()` on the component instance       |

Synchronize after a successful mount. Core's render requests require mounted state; Element needs a current mounted runtime, and framework handles must be used according to their package lifecycle. A root deliberately set to `null` in a component integration keeps it unmounted rather than providing geometry to refresh.

Use immediate synchronization when application code has completed a change and needs Core to process it now. Use the scheduled form when several changes may be combined. Calls made from public event/snapshot dispatch can be deferred by Core's operation boundary, so “immediate” is not permission to interrupt an active dispatch.

Projection's `flushRender()` is a different integration-author tool: it flushes already-pending work and creates no refresh request. Calling it without pending work is not a way to force geometry measurement.

## Changing update configuration

Use the package's normal configuration API. Relevant changes include enabled flags, target resolver identity, effective mutation options, debounce delays, and interval delay. Successful mounted changes take effect during configuration reconciliation. Relevant changes reconnect the observation resources and re-run target resolution with reason `options:update`; unchanged observation settings do not reconnect merely because another option changed.

Reconnection tears down old observation resources before creating the new ones. A failed operation attempts to restore previous committed settings and wiring; secondary cleanup/rollback failure can still leave resources degraded. Avoid assuming old and new observers are simultaneously live during a swap.

Observer-local delayed work is canceled by reconnection, but a request already handed to the scheduler can survive and merge with configuration work. Unmount/destroy also cancels that scheduler work.

## Geometry recovery

Element-mode geometry is revalidated at render boundaries. If an external profile change suspends it, restore a supported profile and request synchronization. Observers stay connected during suspension, but they can only respond to signals they actually receive.

CSS/CSSOM-only changes—such as editing a stylesheet rule—are not guaranteed MutationObserver triggers. If automatic signals do not cover the change, call `render()` or the package's `refresh()` after restoration. The same responsibility applies when relevant automatic families are intentionally disabled. See the [container profile](environments.md#supported-container-profile).

## Framework adapter update boundaries

React, Vue, and Angular reconcile whole `options` and `rules` values through top-level reference identity. Replace the options object or rules array; mutating the existing value in place is not a supported request for declarative reconciliation. These adapters provide neither an incremental rules/patch-options handle nor declarative `render: false`.

A normal framework rerender with unchanged tracked identities is not a generic Core refresh request. Rendering new source content must still produce a configured observation signal or be followed by `refresh()`/`requestRefresh()` when necessary. Children, default slots, and content projection do not automatically define source scope. Set `sourceRoot` explicitly when the intended scope differs from the mount default.

Whole-value configuration, root-change failure behavior, and component teardown remain package-owned contracts. See the [React](../../packages/react/README.md), [Vue](../../packages/vue/README.md), and [Angular](../../packages/angular/README.md) READMEs.

## Examples

This Vanilla configuration observes body mutations even when selector queries are restricted to `#content`. The resolver uses the active document, so it also works with a supported child-document mount:

```js
import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';

const tracker = new Tracker({
  options: {
    updates: {
      mutation: {
        targets: ({ document }) => [document.body],
      },
    },
  },
  rules: [{ selector: 'h2' }],
});

tracker.mount({ sourceRoot: document.querySelector('#content') });
```

After an application-owned stylesheet change, a mounted Vanilla tracker can deterministically recompute geometry:

```js
tracker.render();
```

Explore the [observation scenario](../../site/demos/scenarios/observation/README.md) for source-scoped versus body observation, [writing modes](../../site/demos/scenarios/writing-mode/README.md) for geometry-sensitive layouts, and [diagnostics](../../site/demos/scenarios/diagnostics/README.md) for warnings and failure channels. These are scenario materials in the repository.
