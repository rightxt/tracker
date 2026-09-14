# Core runtime state, diagnostics, and debug

This reference describes the runtime read and diagnostic contracts of the Core Projection and Direct Renderer facades. Start with the [Core API](core-api.md) for methods, lifecycle, and events, or [Core rendering](core-rendering.md) for the integration protocols. The [Core README](../../packages/core/README.md) owns configuration fields and package orientation.

## Runtime read surfaces

| Surface                                                   | Purpose and ownership                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSnapshot(): TrackerSnapshot`                          | Cached, deeply frozen, DOM-free runtime DTO for the current observable revision. Safe to retain.                                                     |
| `subscribeSnapshot(listener): TrackerSnapshotUnsubscribe` | Synchronous delivery of future snapshot publications; no immediate initial callback.                                                                 |
| `getStats(): TrackerStats`                                | Fresh detached stats clone; not runtime-frozen. Available after destroy.                                                                             |
| `resetStats(): void`                                      | Clears counters, retained diagnostics, last render, and debug trace while alive. Does not request rendering.                                         |
| Projection `getProjection()` / `subscribeProjection()`    | Immutable rendering views and changed-domain commits. A separate [Projection protocol](core-rendering.md#projection-protocol), not a snapshot alias. |
| `getTrackerDebugTrace(integration)`                       | Optional debug execution history from a compatible advanced accessor and original Core facade. See [Advanced trace](#advanced-trace).                |

`TrackerSnapshot`, its branch/item types, `TrackerStats`, `TrackerDebugStats`, `TrackerDiagnosticStats`, `TrackerDiagnosticEntry`, `TrackerDiagnosticCode`, and the error types are root exports from `@rightxt/tracker-core`. `TrackerSnapshotListener` is `(snapshot: TrackerSnapshot) => void`; `TrackerSnapshotUnsubscribe` is `() => void`. `TrackerDiagnosticsSink` is independently exported from `/renderer`. Advanced types are exported from `/advanced`; corresponding explicit `/debug` entries expose the same static type surfaces.

These contracts apply to original Core facades. An adapter's public object is governed by that package's API; sharing Core does not establish snapshot, subscription, or advanced-accessor parity.

## Snapshots

Every snapshot is a detached, deeply frozen Tracker-owned graph. It contains no source Elements, root nodes, Events, or live application callback graphs. Later runtime changes cannot mutate an earlier snapshot. This differs from borrowed [event payload details](core-api.md#events) and [renderer records](core-rendering.md#renderer-dtos-and-records).

### Snapshot structure

`TrackerSnapshot` has these 15 top-level fields:

| Field               | Type and meaning                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mounted`           | Boolean; true only for committed mounted lifecycle state.                                                                                                                                              |
| `scrollMode`        | `'window' \| 'element' \| null`; null without active runtime context.                                                                                                                                  |
| `geometryAvailable` | Mounted runtime context exists and geometry is not suspended. Can be false while mounted.                                                                                                              |
| `lifecycle`         | `TrackerLifecycleSnapshot`: `{ mounted: boolean; destroyed: boolean; hasRenderRoot: boolean }`. Root availability requires active mounted context and the renderer's root to match the committed root. |
| `options`           | `TrackerOptionsSnapshot`: the committed renderer-facing option subset described below.                                                                                                                 |
| `classes`           | `TrackerClassNameConstants`: standard render class names.                                                                                                                                              |
| `dataAttributes`    | `TrackerDataAttributeConstants`: standard render attribute names.                                                                                                                                      |
| `cssVariables`      | `TrackerCssVariableConstants`: render-contract variable names, distinct from configured values.                                                                                                        |
| `render`            | `TrackerRenderSnapshot`: `{ dirtyTarget; pending: boolean; running: boolean }`.                                                                                                                        |
| `selection`         | `TrackerSelectionSnapshot`: `{ enabled: boolean; key: string \| null }`.                                                                                                                               |
| `viewport`          | `TrackerViewportSnapshot`: `{ visible: boolean; start: number; size: number }`.                                                                                                                        |
| `items`             | `readonly TrackerSnapshotItem[]`: ordered mixed marker/cluster items; empty without available geometry.                                                                                                |
| `markers`           | `readonly TrackerMarkerSnapshot[]`: top-level unclustered marker items filtered from `items`.                                                                                                          |
| `clusters`          | `readonly TrackerClusterSnapshot[]`: cluster items filtered from `items`.                                                                                                                              |
| `diagnostics`       | `TrackerStats` captured for this revision and frozen as part of the snapshot.                                                                                                                          |

`TrackerOptionsSnapshot` includes `orientation`, `placement`, `cssVariables`, `track`, `viewport`, `markerLayer`, optional `marker`, `clustering`, `interaction`, and `a11y`. It omits `updates`, `diagnostics`, rules, and mount roots. It is not a complete `TrackerOptions` clone or a configuration-replacement payload. `options.cssVariables` retains committed strings, including blank strings; input null tombstones are absent from committed values.

The three name tables describe supported render hooks, not live DOM state or proof that a custom renderer materializes each hook. Their types are `/renderer` exports. The variable constant map is not the exhaustive configurable theme inventory; see [Styling](styling.md).

`render.dirtyTarget` is retained work, especially from unmounted changes or `render: false`; null means no retained dirty target. Render targets distinguish `'all'`, `'markers'`, `'marker-presentation'`, `'track'`, and `'viewport'`. The declaration's support type is not independently root-exported. `pending` indicates a pending scheduler target and/or frame; `running` is reported execution state. Successful terminal render events and settlement snapshots observe `running: false`.

`selection.enabled` follows keyboard accessibility enablement; `selection.key` names a current render record, either a marker or a cluster. Item DTOs do not contain a selected boolean. Selection is a separate domain and does not automatically transfer identity when clustering changes the render key.

### Marker items

`TrackerMarkerSnapshot` has 14 fields:

| Field         | Type and meaning                                                             |
| ------------- | ---------------------------------------------------------------------------- |
| `key`         | `string`; logical source-Element identity within this Tracker instance.      |
| `className`   | `string`; resolved application presentation classes.                         |
| `attributes`  | `Readonly<Record<string, string>>`; resolved application attributes.         |
| `styleVars`   | `Readonly<Record<string, string>>`; resolved application custom properties.  |
| `kind`        | Literal `'marker'`.                                                          |
| `ruleIndex`   | `number`; current owning normalized rule index.                              |
| `selector`    | `string`; current owning normalized selector.                                |
| `label`       | `string \| null`; label resolved when the marker record was created/rebuilt. |
| `title`       | `string \| null`; native-title presentation after global/rule policy.        |
| `start`       | `number`; track-axis start percentage.                                       |
| `size`        | `number`; track-axis size percentage.                                        |
| `clustered`   | Literal `false`; this is a top-level unclustered item.                       |
| `clusterKey`  | Literal `null`.                                                              |
| `interactive` | `boolean`; global semantic activation enablement, `interaction.activation`.  |

There is no `element` field. Clustered logical markers do not also appear in `snapshot.markers`; their keys appear in cluster membership. Use `items` when mixed spatial order matters. Equal start positions use rule order as the tie-breaker.

### Cluster items

`TrackerClusterSnapshot` has 13 fields:

| Field              | Type and meaning                                                                   |
| ------------------ | ---------------------------------------------------------------------------------- |
| `key`              | `string`; derived from ordered member marker keys.                                 |
| `className`        | `string`; global/primary-marker presentation classes.                              |
| `attributes`       | `Readonly<Record<string, string>>`; resolved cluster application attributes.       |
| `styleVars`        | `Readonly<Record<string, string>>`; resolved application custom properties.        |
| `kind`             | Literal `'cluster'`.                                                               |
| `count`            | `number`; logical member marker count.                                             |
| `markerKeys`       | `readonly string[]`; ordered member identities, without member DTOs or Elements.   |
| `primaryMarkerKey` | `string \| null`; primary identity, normally present for an actual cluster record. |
| `label`            | `string \| null`; primary marker label.                                            |
| `title`            | `string \| null`; primary-marker/global title policy result.                       |
| `start`            | `number`; track-axis start percentage.                                             |
| `size`             | `number`; track-axis size percentage.                                              |
| `interactive`      | `boolean`; global semantic activation enablement.                                  |

The first spatially ordered marker in a cluster is primary and owns its rule presentation. `TrackerSnapshotItem` is the union of marker and cluster snapshots, discriminated by `kind`. `diagnostics.markers.current` counts logical markers before clustering, so it can exceed `snapshot.markers.length`.

### Viewport

The three `TrackerViewportSnapshot` fields are `visible`, `start`, and `size`. Start and size are track-axis percentages. Visibility requires enabled viewport output and a visible committed layout. Disabled, unavailable, suspended, unmounted, or destroyed output is `{ visible: false, start: 0, size: 0 }`.

This DTO has no `end`, orientation, or raw pixel measurements. The richer renderer layout is documented under [renderer records](core-rendering.md#marker-and-cluster-records).

## Snapshot identity and publication

Repeated `getSnapshot()` calls within the same observable revision return the same object. A later revision produces a new snapshot; no stable nested-object identity protocol is promised. The revision is not a public snapshot field. A read may lazily materialize a revision without invoking listeners, and snapshot publication does not mean browser paint or framework commit.

| Boundary                               | Snapshot behavior                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Creation / initial read                | Valid unmounted state; no synthetic initial subscription callback.                                                                                           |
| Successful mount                       | Publishes committed lifecycle/runtime state after staging; successful initial sync notifications do not escape a failed mount.                               |
| Invalid mount context / mount rollback | Publishes the relevant diagnostic/settled unmounted state before propagating failure.                                                                        |
| `requestRender()`                      | Can publish pending state, then render settlement. Multiple requests can merge into one render.                                                              |
| Synchronous `render()`                 | Suppresses an intermediate pending publication; exposes settlement.                                                                                          |
| Configuration/rule mutation            | Publishes observable committed changes; unmounted or `render: false` work can remain dirty. No-effective-change operations do not require a new publication. |
| Selection                              | Publishes a committed logical key transition at the owning operation boundary.                                                                               |
| `resetStats()`                         | Publishes cleared stats without requesting rendering or requiring a Projection view commit.                                                                  |
| Ordinary diagnostics                   | Not a universal independent snapshot-publication source. Use `getStats()` for immediate diagnostic totals rather than waiting for every warning to publish.  |
| Unmount / destroy                      | Publishes settled lifecycle state; destroy's final snapshot precedes subscription teardown.                                                                  |

This is a settlement-oriented read surface, not an event for every internal write. Snapshot revision, snapshot publication, and Projection commit are distinct. A diagnostic or render-state revision need not change any Projection view domain.

### Key lifetime

Marker keys follow source Element identity within one Core instance. The same Element preserves its key across ordinary renders, record rebuilds, owning-rule changes, disappearance/reappearance, and unmount/remount. A replacement Element gets a new key. Presentation, label, rule index, and selector can change while the key remains the same. Destroy terminates that instance's identity lifetime.

Cluster keys use ordered membership:

```text
c:<markerKey>|<markerKey>|...
```

The same ordered membership preserves the key; a membership or order change produces a different key. Marker and cluster keys describe distinct render records, so clustering/declustering is not a semantic selection-identity transfer.

### Snapshot subscriptions

Register a function, read the initial state explicitly, and release each owned registration:

```ts
import type { TrackerSnapshot } from '@rightxt/tracker-core';
import type { TrackerProjectionIntegration } from '@rightxt/tracker-core/projection';

function observe(integration: TrackerProjectionIntegration, consume: (state: TrackerSnapshot) => void) {
  const unsubscribe = integration.subscribeSnapshot(consume);
  consume(integration.getSnapshot());
  return unsubscribe;
}
```

Delivery is synchronous and future-only. Repeated registration of the same listener identity creates independently releasable ownership while invoking the listener once per publication. Each returned unsubscribe is idempotent; releasing one registration does not remove the others. An invalid non-function listener or registration after destroy returns an inert unsubscribe. Existing listeners are released after the final destroy publication.

Synchronous listener throws are contained and reported through the host error-reporting/async error transport; they do not become Core event-handler diagnostic counters or abort the state commit. Returned values, including thenables, are ignored and uninspected. A snapshot callback should handle its own asynchronous work and rejections. This differs from [Core event handlers](core-api.md#event-subscription-and-ordering) and Projection listeners, whose rejected thenables are observed.

Valid state-changing calls during public dispatch defer until that dispatch/enclosing operation exits; call-time validation can still throw. Synchronous feedback is bounded: more than 1,000 continuously generated snapshot emissions reaches the reentrancy limit and remaining work is bounded/dropped at that boundary. See [transaction boundaries](core-rendering.md#transactions-and-reentrancy) for the distinct behavior of renderer/lifecycle callbacks.

## Stats

`getStats()` returns a detached clone. Unlike a snapshot, the standalone result is not runtime-frozen; modifying it cannot modify Core's counters. `snapshot.diagnostics` is the frozen value captured for its snapshot revision.

`TrackerStats` has nine declared top-level fields, including optional `debug`; normal production materializes eight. The counter groups contain 20 fixed public counters: 5 render, 5 rule, 3 marker, 1 cluster, 4 observer, and 2 diagnostic totals. Dynamic per-code maps, timing, and debug fields are additional values.

| Group / field                         | Meaning                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renders.requested`                   | Requests before scheduler merging; not the number of native events or completed renders.                                                                       |
| `renders.started`                     | Render transactions that start with available geometry.                                                                                                        |
| `renders.completed`                   | Successful completed render transactions.                                                                                                                      |
| `renders.cancelled`                   | Discarded pending render targets; not a generic counter for every interrupted running operation.                                                               |
| `renders.skipped`                     | Attempts skipped because rendering/geometry is unavailable.                                                                                                    |
| `rules.added`                         | Installed nonempty-selector rules, including initial installation and later additions.                                                                         |
| `rules.removed`                       | Removed rule deltas, including replacement/removal.                                                                                                            |
| `rules.cleared`                       | Rule-store clear operations, not the number of rules removed. No public `clearRules()` facade method; replacing rules with `[]` uses removal deltas.           |
| `rules.rejected` / `rules.duplicates` | Rejection/duplicate accounting on rule-store paths. Not a ledger of every strict validation failure; strict rejection can precede counter commit.              |
| `markers.current`                     | Current logical marker records before clustering.                                                                                                              |
| `markers.created` / `markers.removed` | Record-presence additions/removals, including removal during unmount. Created is not the number of distinct keys ever assigned.                                |
| `clusters.current`                    | Current cluster render-record count, with no historical cluster counter.                                                                                       |
| `observers.mutation`                  | Accepted external mutation batches before debounce.                                                                                                            |
| `observers.resize`                    | Accepted ResizeObserver callbacks plus active Window resize events before debounce.                                                                            |
| `observers.scroll`                    | Accepted scroll work after local frame gates; authoritative and descendant sources have separate gates. Not every native scroll event.                         |
| `observers.interval`                  | Accepted interval ticks while the source is active.                                                                                                            |
| `warnings` / `errors`                 | Each is `TrackerDiagnosticStats`: `{ total; byCode; last }`, described below.                                                                                  |
| `lastRender`                          | Null or last successful render record: `{ target: string; markersCount: number; clustersCount: number; duration: number \| null; timestamp: number \| null }`. |
| `debug?`                              | `TrackerDebugStats`: `{ traceLength: number; traceLimit: number }`; present for debug-capable integrations only.                                               |

Observer counters are signals accepted by their respective transport stages, not a uniform raw-event count. There is no general ignored/dropped-event counter. See [updates and refresh](../guides/updates-and-refresh.md) for scheduling and observation workflow.

`TrackerDiagnosticStats.total` counts that severity, `byCode: Record<string, number>` accumulates code counts, and `last: TrackerDiagnosticEntry | null` retains only the latest sanitized entry. It is not diagnostic history.

### Timing and metrics

All counters continue updating regardless of `diagnostics.metrics`. That option gates render timing values only. Without metrics or a usable performance clock, `lastRender.duration` and `lastRender.timestamp` are null. Changing the flag does not itself request a render or rewrite an existing `lastRender`; a subsequent successful render reflects the new setting.

`lastRender` is the last successful result, not live geometry. It can survive unmount or geometry suspension while current marker/cluster counts are cleared. Timing uses the active performance-style clock and is not a wall-clock timestamp.

## Stats reset and lifecycle

`resetStats()` requires an alive facade and participates in public-operation deferral. It zeros every fixed counter, including `markers.current` and `clusters.current`, clears `byCode` maps, sets retained diagnostics and `lastRender` to null, and clears debug trace. It leaves configuration, rules, logical records, selection, pending work, observers, and lifecycle in place.

Consequently, current counters may read zero immediately after reset while render items still exist. Reset does not remeasure them, request rendering, or force a Projection commit. It publishes a snapshot of the changed stats.

Reads remain available after destroy. Terminal stats include cleanup and callback failures already recorded at capture. A rejected event-handler thenable can be reported later and refresh retained final stats and the read revision; the previously retained snapshot remains unchanged. This does not reopen lifecycle operations or subscriptions. `resetStats()` after destroy rejects with `ERR_TRACKER_DESTROYED`.

## Errors

The root exports three runtime classes: `TrackerError extends Error`, `TrackerConfigurationError extends TrackerError`, and `TrackerLifecycleError extends TrackerError`. Their construction uses a message and `TrackerErrorOptions`, which extends native `ErrorOptions` with required `code: TrackerErrorCode` and supports native `cause`.

The concrete class sets `name`; `code` is readonly at the TypeScript boundary, not a runtime-freeze guarantee. Strict diagnostic assertion can put the complete validation array in `cause`; do not assume every Tracker error has that cause shape.

| Stable `TrackerErrorCode`             | Class and circumstance                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ERR_TRACKER_INVALID_CONFIGURATION`   | `TrackerConfigurationError`: invalid configuration/rule input or operation parameters.       |
| `ERR_TRACKER_INVALID_CONTEXT`         | `TrackerLifecycleError`: invalid/inactive runtime or an operation requiring mounted context. |
| `ERR_TRACKER_REALM_MISMATCH`          | `TrackerLifecycleError`: incompatible document/window realms.                                |
| `ERR_TRACKER_UNSUPPORTED_SCROLL_ROOT` | `TrackerConfigurationError`: unsupported scroll-root contract.                               |
| `ERR_TRACKER_RENDERER_CONTRACT`       | `TrackerConfigurationError`: renderer actual-root contract violation.                        |
| `ERR_TRACKER_DESTROYED`               | `TrackerLifecycleError`: alive-only operation after terminal destroy.                        |
| `ERR_TRACKER_ALREADY_MOUNTED`         | `TrackerLifecycleError`: another mount while mounted.                                        |
| `ERR_TRACKER_TRANSITION_IN_PROGRESS`  | `TrackerLifecycleError`: prohibited mutation during an active transition.                    |
| `ERR_TRACKER_REENTRANCY_LIMIT`        | `TrackerLifecycleError`: bounded synchronous feedback budget exceeded.                       |

These nine codes do not cover every public thrown value. Native `TypeError`, `AggregateError`, and original renderer/callback failures can also propagate. Cleanup failure can throw after unmounted/destroyed state has already committed; see [lifecycle settlement](core-api.md#mount-and-cleanup-settlement).

## Diagnostic channels

| Channel                         | Observable role                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Thrown error                    | Synchronous operation failure; inspect class/code where applicable. It is not automatically a runtime diagnostic event. |
| Configured `diagnostics.output` | Best-effort immediate warning/error output, with borrowed contextual details.                                           |
| Core `warning` event            | Warning notification after stats and output. No public Core `error` event exists.                                       |
| Stats / snapshot diagnostics    | Retained sanitized totals, per-code counts, and last entry per severity. Snapshots capture a revision.                  |
| Pure validation results         | Non-committing diagnostic arrays with `type`, `code`, `message`, and open details. Not runtime output or stats.         |
| Console fallback                | Used independently per severity when no matching sink method exists.                                                    |
| Advanced debug trace            | Selected execution boundaries; a separate debug surface, not a full diagnostic log.                                     |

A warning need not throw, and an error-level runtime diagnostic need not throw. Strict mutation rejection does not automatically route every validation diagnostic through runtime channels. The [validator reference](core-api.md#configuration-and-rule-validation) explains recovered candidates and atomic rejection.

`TrackerDiagnosticEntry` has `code: TrackerDiagnosticCode`, `message: string`, and `details: Readonly<Record<string, unknown>> | null`. `TrackerWarningEventPayload` uses this entry shape. `TrackerValidationDiagnostic` adds `type: 'warning' | 'error'`. Codes are stable branching keys; human-readable messages and incidental detail keys are not stable per-code schemas.

### Warning delivery

The ordinary warning order is:

```text
sanitized retained copy / warning stats
→ configured output.warn or console.warn fallback
→ Core warning event
```

`diagnostics.warnings` controls **only fallback `console.warn`**. Setting it to false leaves a configured `output.warn`, warning counters, and the Core warning event active. It does not control errors or `console.error`.

The warning event envelope is frozen; its contextual `details` is borrowed and can contain live objects. Output/event consumers should copy what they need rather than assuming retained-stats sanitation applies to the immediate path. Handler return values do not cancel the warning or prior work.

## Diagnostic output sink

`TrackerDiagnosticsOptions.output` accepts a `TrackerDiagnosticsSink | null`. Import the named sink type from `@rightxt/tracker-core/renderer`:

```ts
import type { TrackerDiagnosticCode } from '@rightxt/tracker-core';
import type { TrackerDiagnosticsSink } from '@rightxt/tracker-core/renderer';

const output: TrackerDiagnosticsSink = {
  warn(code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) {
    console.info('Tracker warning', code, message, details);
  },
  error(code: TrackerDiagnosticCode, message: string, details?: Record<string, unknown>) {
    console.error('Tracker error', code, message, details);
  },
};
```

Both methods are optional independently, return `void`, and replace console fallback only for their own severity. They complement stats and warning events. `output: null` clears the sink; complete option replacement can also restore the default of no sink.

The sink is caller-owned. Its identity survives configuration cloning; Core does not freeze, flush, close, or dispose it. Destroy releases Core's references. Synchronous sink throws are swallowed. Returned thenables are not awaited; rejections are observed and swallowed without recursively generating a sink-failure diagnostic. A sink cannot change the operation's original success/failure outcome.

## Diagnostic codes and retained details

`TrackerDiagnosticCode` contains 83 stable values. The catalog identifies normal severity and emission surface; it does not promise an exact human message or a typed `details` object. Some defensive/internal-boundary diagnostics remain public union values even though normal facade validation prevents callers from reaching those paths. Integration-owned values are included to account for the union, without defining adapter API behavior here.

| Code                                         | Normal severity  | Emission surface            | Meaning                                                                                                                                                   |
| -------------------------------------------- | ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_TRACKER_REENTRANCY_LIMIT`               | error            | Runtime + thrown error code | Synchronous warning/snapshot/deferred-operation feedback exceeded Core batch budget; remaining work is bounded/dropped per owning subsystem.              |
| `WARN_TRACKER_FOCUS_TARGET_OUTSIDE_ROOT`     | warning          | Runtime                     | Element-mode focus target is outside the authoritative scroll subtree and is skipped.                                                                     |
| `WARN_TRACKER_GEOMETRY_SUSPENDED`            | warning          | Runtime                     | Element scroll root left the supported geometry profile; geometry output is suspended until a later valid render boundary.                                |
| `WARN_TRACKER_OBSERVER_EMPTY_TARGETS`        | warning          | Runtime                     | Resolved observer target list was empty, or no target could be observed; that observer branch remains disconnected.                                       |
| `WARN_TRACKER_OBSERVER_FOREIGN_REALM_TARGET` | warning          | Runtime                     | Resolved observer target belongs to another document realm and is ignored.                                                                                |
| `WARN_TRACKER_OBSERVER_INVALID_RESULT`       | warning          | Runtime                     | Observer targets option/resolver produced a non-function/non-array result; defaults are used.                                                             |
| `WARN_TRACKER_OBSERVER_INVALID_TARGET`       | warning          | Runtime                     | Resolved observer target has wrong type or is Tracker-internal and is ignored.                                                                            |
| `WARN_TRACKER_OBSERVER_RESOLVER_FAILED`      | warning          | Runtime                     | Observer target resolver threw; runtime defaults are used.                                                                                                |
| `WARN_TRACKER_RENDER_ROOT_QUARANTINED`       | warning          | Runtime                     | A previous renderer-owned root remains connected/quarantined, so remount cannot safely proceed.                                                           |
| `WARN_TRACKER_SCROLL_PADDING_FALLBACK`       | warning          | Runtime                     | Element-mode scroll-padding value could not be resolved and Core used 0 CSS px.                                                                           |
| `WARN_TRACKER_SCROLL_TARGET_OUTSIDE_ROOT`    | warning          | Runtime                     | Element-mode scroll target is outside the authoritative scroll subtree and is skipped.                                                                    |
| `WARN_TRACKER_UNKNOWN_OPTION`                | warning          | Validation helper           | Unknown raw option path is ignored in the recovered validation candidate.                                                                                 |
| `WARN_TRACKER_UNKNOWN_RULE_OPTION`           | warning          | Validation helper           | Unknown raw rule option path is ignored in recovered normalized rule.                                                                                     |
| `WARN_TRACKER_WINDOW_ALIGNMENT_FALLBACK`     | warning          | Runtime                     | Window physical principal-flow alignment was unresolved and Core used its legacy alignment fallback.                                                      |
| `deferred-operation-error`                   | error            | Runtime                     | A deferred Core operation failed after the initiating reentrant call had already returned.                                                                |
| `destroy-cleanup-failure`                    | error            | Runtime                     | One or more destroy cleanup steps failed; terminal destroy still commits before cleanup failure is rethrown.                                              |
| `dom-unavailable`                            | error            | Integration runtime         | Standard DOM renderer cannot create DOM output because target ownerDocument lacks createElement.                                                          |
| `duplicate-rule-selector`                    | warning          | Validation helper           | Normalized selector duplicates an earlier/committed selector; rule is rejected.                                                                           |
| `element-lifecycle-error`                    | error            | Adapter-owned output        | Custom Element host lifecycle reaction failed and the Element integration reports it without throwing from the browser-owned callback.                    |
| `integration-event-handler-error`            | error            | Runtime                     | A Core .on() integration handler threw synchronously or its returned thenable rejected; event delivery remains contained.                                 |
| `focus-fallback-error`                       | error            | Runtime                     | Plain HTMLElement.focus() fallback failed after preventScroll focus failed.                                                                               |
| `focus-prevent-scroll-error`                 | error            | Runtime                     | HTMLElement.focus({preventScroll:true}) failed; Core attempts plain focus fallback.                                                                       |
| `interaction-not-connected`                  | warning          | Runtime                     | Manual interaction/activation path has no connected interaction root and is ignored.                                                                      |
| `interaction-update-cleanup-failure`         | warning          | Runtime                     | An interaction option update committed, but cleanup of obsolete listeners/resources failed.                                                               |
| `invalid-a11y-keyboard-combination`          | warning          | Validation helper           | a11y.keyboard is true while a11y.enabled is false; candidate reports the invalid combination.                                                             |
| `invalid-activation-key`                     | warning          | Runtime                     | Imperative activation key is empty/non-string; activation returns false.                                                                                  |
| `invalid-css-variable-name`                  | warning          | Validation helper           | Root cssVariables contains a name not allowed by root Tracker CSS-variable contract.                                                                      |
| `invalid-css-variable-value`                 | warning          | Validation helper           | Root cssVariables value is neither string nor allowed null tombstone.                                                                                     |
| `invalid-css-variables`                      | warning          | Validation helper           | Root cssVariables container is not a plain object.                                                                                                        |
| `invalid-interaction-root`                   | error            | Runtime                     | InteractionController was asked to connect an invalid/inactive root.                                                                                      |
| `invalid-marker-attribute`                   | warning          | Validation helper           | Rule marker attribute name fails supported attribute grammar.                                                                                             |
| `invalid-marker-attribute-collision`         | warning          | Validation helper           | Global marker attribute keys collide after ASCII lowercasing.                                                                                             |
| `invalid-marker-attribute-name`              | warning          | Validation helper           | Global marker attribute name fails supported grammar.                                                                                                     |
| `invalid-marker-attribute-reserved`          | warning          | Validation helper           | Global marker attribute name is reserved by Tracker.                                                                                                      |
| `invalid-marker-attribute-value`             | warning          | Validation helper           | Marker attribute value is not supported; used by both global-option and rule validation.                                                                  |
| `invalid-mount-context`                      | error            | Runtime                     | Public mount prevalidation failed; Core records the failure before rethrowing the underlying lifecycle/context error.                                     |
| `invalid-mount-target`                       | error            | Integration runtime         | The standard DOM renderer was given a non-HTMLElement host target.                                                                                        |
| `invalid-option-value`                       | warning          | Validation helper           | Known option field/container has an invalid value and recovered candidate restores prior/default value.                                                   |
| `invalid-options`                            | error            | Validation helper           | validateOptions() input is not a plain object.                                                                                                            |
| `invalid-orientation-placement`              | warning          | Validation helper           | Explicit placement is incompatible with orientation; recovered candidate applies axis fallback.                                                           |
| `invalid-render-target`                      | warning          | Runtime                     | An invalid internal render target reached scheduler/render request code; request is skipped.                                                              |
| `invalid-rule`                               | error            | Validation helper           | Rule candidate is not an object, or complete list contains a sparse/empty entry.                                                                          |
| `invalid-rule-css-variable-name`             | warning          | Validation helper           | Rule marker cssVariables contains a name not allowed at rule-marker scope.                                                                                |
| `invalid-rule-css-variable-value`            | warning          | Validation helper           | Rule marker cssVariables value is not a string.                                                                                                           |
| `invalid-rule-focus`                         | warning          | Validation helper           | rule.focus.enabled is invalid and fallback is applied.                                                                                                    |
| `invalid-rule-focus-target`                  | warning          | Validation helper           | rule.focus.target has invalid target specification and fallback is applied.                                                                               |
| `invalid-rule-index`                         | warning          | Strict validation only      | Rule insertion/removal index is outside the supported range; strict mutation rejects without committing.                                                  |
| `invalid-rule-label`                         | error            | Validation helper           | Rule label is not string/function/null.                                                                                                                   |
| `invalid-rule-marker-class-name`             | warning          | Validation helper           | Rule marker className is not a valid string form.                                                                                                         |
| `invalid-rule-marker-css-variables`          | warning          | Validation helper           | Rule marker cssVariables container is not a plain object.                                                                                                 |
| `invalid-rule-marker-title`                  | warning          | Validation helper           | Rule marker title override is not boolean/omitted.                                                                                                        |
| `invalid-rule-option-value`                  | error            | Validation helper           | Known raw rule field is explicitly undefined.                                                                                                             |
| `invalid-rule-scroll`                        | warning          | Validation helper           | rule.scroll.enabled is invalid and fallback is applied.                                                                                                   |
| `invalid-rule-scroll-align`                  | warning          | Validation helper           | rule.scroll.align is invalid and fallback is applied.                                                                                                     |
| `invalid-rule-scroll-behavior`               | warning          | Validation helper           | rule.scroll.behavior is invalid and fallback is applied.                                                                                                  |
| `invalid-rule-scroll-target`                 | warning          | Validation helper           | rule.scroll.target has invalid target specification and fallback is applied.                                                                              |
| `invalid-rule-selector`                      | error            | Validation helper           | Rule selector is missing/empty or fails CSS selector validation.                                                                                          |
| `invalid-rules`                              | error            | Validation helper           | validateRules() input is not an array.                                                                                                                    |
| `marker-attribute-name-collision`            | warning          | Validation helper           | Rule marker attribute keys collide after ASCII lowercasing.                                                                                               |
| `mount-failure`                              | error            | Runtime                     | A mount transaction failed after acquisition began and Core rolled back to stable unmounted state.                                                        |
| `mutation-observer-observe-failed`           | warning          | Runtime                     | MutationObserver.observe() failed for one resolved target; Core continues with other targets.                                                             |
| `mutation-observer-unavailable`              | warning          | Runtime                     | Active realm has no MutationObserver; mutation source is not connected.                                                                                   |
| `operation-cleanup-error`                    | error            | Runtime                     | Cleanup/settlement hook for a deferred coordinated operation failed.                                                                                      |
| `projection-listener-error`                  | error            | Runtime                     | Projection integration subscriber threw or returned a rejected thenable; Core marks projection for full resynchronization.                                |
| `query-selector-error`                       | error            | Runtime                     | A selector query/revalidation threw at runtime; affected rule/element query is skipped rather than crashing query reconciliation.                         |
| `render-error`                               | warning          | Runtime                     | A render/selection/scheduler transaction failed or its cleanup failed; Core rolls back/marks dirty and omits successful sync completion for that attempt. |
| `renderer-already-mounted`                   | warning          | Runtime                     | Normalized renderer received a second provisional mount while its current mount cycle is still active.                                                    |
| `renderer-contract-error`                    | error            | Runtime                     | Custom renderer violated root identity/connection/realm/ownership/exposed-root contract.                                                                  |
| `renderer-hook-returned-thenable`            | warning          | Runtime                     | A renderer hook returned a thenable that later rejected; async renderer hooks are unsupported and the rejection is not awaited.                           |
| `renderer-missing`                           | error            | Runtime                     | Renderer is missing at the composition boundary; the supported factory rejects missing renderer input during construction.                                |
| `reserved-class-name`                        | warning          | Validation helper           | Application className uses Tracker-reserved service class namespace/token.                                                                                |
| `reserved-marker-attribute`                  | warning          | Validation helper           | Rule marker attribute name is reserved by Tracker.                                                                                                        |
| `reserved-rule-marker-class-name`            | warning          | Validation helper           | Rule marker className includes Tracker-reserved service class token.                                                                                      |
| `resize-observer-observe-failed`             | warning          | Runtime                     | ResizeObserver.observe() failed for one resolved target; Core continues with other targets.                                                               |
| `resize-observer-unavailable`                | warning          | Runtime                     | Active realm has no ResizeObserver; element resize source is unavailable while Window resize can remain active.                                           |
| `rule-label-error`                           | error            | Runtime                     | Function-valued rule label callback threw; marker keeps no computed label for that attempt.                                                               |
| `scroll-into-view-error`                     | error            | Runtime                     | Configured marker scroll activation failed unexpectedly.                                                                                                  |
| `target-resolver-error`                      | error            | Runtime                     | Rule scroll/focus target resolver callback threw; no target is used for that resolution.                                                                  |
| `target-selector-error`                      | error            | Runtime                     | Rule scroll/focus target selector query threw; no target is used.                                                                                         |
| `unknown`                                    | warning or error | Runtime fallback            | Fallback code used by Diagnostics when called with a missing/empty code at runtime.                                                                       |
| `unknown-activation-key`                     | warning          | Runtime                     | Imperative activation key does not identify a current marker/cluster render record; activation returns false.                                             |
| `unmount-cleanup-failure`                    | error            | Runtime                     | One or more unmount cleanup steps failed; state still becomes unmounted before failure propagation.                                                       |
| `unsupported-cross-document-target`          | warning          | Runtime                     | Resolved scroll/focus target is outside the active document and is ignored.                                                                               |

`invalid-rule-index` belongs to strict insertion/removal validation and is not returned by the three pure validators. `duplicate-rule-selector` is warning-level but can invalidate the result. Recovered rule CSS values exclude invalid names as well as unsupported values. Normal Tracker mutations still reject any diagnostic. `render-error` is warning-level despite its spelling; severity cannot be inferred from the suffix.

### Retained detail ownership

Stats retain a sanitized copy before output/event delivery. Primitives are preserved, including values that are not JSON-compatible. Plain objects and arrays are recursively copied with bounded depth; functions become compact markers, DOM/Events become non-live descriptions, Errors become `{ name, message }`, and other instances become type tags. Cross-realm/platform objects are not deliberately retained as live application graphs.

The depth bound also terminates ordinary cyclic data. There is no breadth, array-item, or byte cap, so very wide metadata can still produce a large retained copy. This is a retention contract, not a guarantee of JSON serialization or containment of every possible custom getter/proxy.

Core retains totals, code maps, and one last entry per severity rather than an unbounded diagnostic history. Pure validation entries and immediate sink/warning details use their own ownership contracts and are not covered by this retained-copy guarantee.

## Debug builds

Neutral semantic entries select debug runtime behavior with the `development` export condition. Explicit debug paths provide deterministic debug selection:

```text
@rightxt/tracker-core/debug
@rightxt/tracker-core/projection/debug
@rightxt/tracker-core/renderer/debug
@rightxt/tracker-core/advanced/debug
```

Each has static public-surface parity with its corresponding neutral entry. Successful trace lookup requires both a debug-capable integration and a compatible debug advanced accessor. Enabling debug only for the accessor does not retrofit a production integration; a production accessor returns null even for a debug integration.

Use compatible entries from the same resolved package instance. An original facade is the lookup identity; a spread copy, wrapper/proxy, foreign package copy, or unrelated object does not acquire trace access merely by resembling the public interface.

## Advanced trace

The `/advanced` and `/advanced/debug` entries export:

```ts
getTrackerDebugTrace(integration: TrackerDebugIntegration): TrackerDebugTraceEntry[] | null;
```

`TrackerDebugIntegration` is the union of Core `TrackerProjectionIntegration` and `TrackerRendererIntegration`. `TrackerDebugTraceEntry` has readonly declared fields:

```ts
{
  type: string;
  timestamp: number | null;
  payload: Readonly<Record<string, unknown>>;
}
```

There is no sequence number, ID, or closed discriminated trace-label union. Lookup does not mutate integration state or emit diagnostics. Unsupported/production mismatches return null; a recognized debug facade before mount returns an empty array.

An explicit-entry composition example:

```ts
import { createTrackerProjectionIntegration } from '@rightxt/tracker-core/projection/debug';
import { getTrackerDebugTrace } from '@rightxt/tracker-core/advanced/debug';

const integration = createTrackerProjectionIntegration();
const initialTrace = getTrackerDebugTrace(integration); // []
integration.destroy();
const clearedTrace = getTrackerDebugTrace(integration); // []
```

### Current execution boundaries

These nine labels describe current emitted boundaries; `type` remains an open-ended string:

| Current label            | Current payload context                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `mount:start`            | `scrollMode`; provisional mount begins.                                                         |
| `mount:commit`           | `scrollMode`; mount commits.                                                                    |
| `mount:rollback`         | `hadCleanupErrors`; provisional mount rolls back.                                               |
| `unmount`                | `hadCleanupErrors`; cycle cleanup settles.                                                      |
| `destroy`                | `hadCleanupErrors`; terminal cleanup settles.                                                   |
| `sync:start`             | `target`, `reason`; selected synchronization begins.                                            |
| `sync:end`               | `target`, `markersCount`, `clustersCount`, `duration`, `timestamp`; successful synchronization. |
| `configuration:commit`   | `reasonSource`, `replace`, `rulesChanged`.                                                      |
| `configuration:rollback` | `reasonSource`, `replace`, `errorCount`.                                                        |

Trace records selected execution boundaries, not every warning, error, activation, selection, validation result, or observer signal. Provisional initial boundaries can appear in trace even when mount later rolls back and successful public initial sync events are withheld. Payload fields are contextual metadata, not a closed per-label type schema.

### Trace retention and timestamps

Trace uses FIFO retention with a current limit of 100 entries, observable through debug stats and not configurable. Payload retention uses sanitized copies. Every retrieval returns a detached copy with mutable runtime arrays/objects despite readonly declaration fields; it does not expose or freeze the retained store. Editing a returned copy cannot change later lookup results.

Array insertion order is authoritative. Entry timestamps use a performance-style active/fallback clock when available and may be null. Realm/clock changes across lifecycle transitions do not guarantee globally comparable or numerically monotonic timestamps. They are not wall-clock times.

Trace entry timestamps are independent of `diagnostics.metrics`. The nested render timing values in a `sync:end` payload remain subject to the render metrics gate.

### Debug stats, reset, and destroy

`TrackerDebugStats` is a root type; debug stats expose `debug.traceLength` and `debug.traceLimit`. Production stats omit `debug` rather than materializing an empty branch.

| Lifecycle boundary                 | Trace lookup for a compatible debug facade                   |
| ---------------------------------- | ------------------------------------------------------------ |
| Before mount                       | `[]`.                                                        |
| Mounted work                       | Retained entries in insertion order.                         |
| Unmount                            | History retained, plus unmount entry.                        |
| Remount                            | Same history continues within the FIFO limit.                |
| `resetStats()`                     | Base stats and trace cleared; no reset trace entry is added. |
| Destroy, including cleanup failure | Retrievable trace cleared; subsequent lookup is `[]`.        |

Destroy can capture terminal debug stats after recording its destroy entry but before trace storage is cleared. Thus captured `debug.traceLength` may be nonzero while a subsequent trace lookup returns `[]`. A later terminal stats refresh can observe length zero. Already retained snapshots/stats copies keep their captured values.

## Related reference and examples

- [Core API](core-api.md) — validation, lifecycle capabilities, and event payload/order contracts.
- [Core rendering](core-rendering.md) — Projection publication and Direct Renderer callback ownership.
- [Updates and refresh](../guides/updates-and-refresh.md) and [environments](../guides/environments.md) — observation and geometry workflows.
- [Diagnostics demo source](../../site/demos/scenarios/diagnostics/README.md) — adapter-based warning/stat/metrics exploration, not an advanced trace API template.
- [Vanilla events demo source](../../site/demos/scenarios/events/vanilla/README.md) — event-oriented workflow; Core handler ownership/failure semantics remain defined in the Core references.
