# Projection and Direct Renderer reference

This reference defines Core's public rendering protocols: mount/root ownership, immutable Projection publications, Direct Renderer hooks and records, coordination, and failure behavior. For facade methods and lifecycle capabilities see [Core API](core-api.md); for an end-to-end task see [Building a custom integration](../guides/custom-integration.md). The [Core README](../../packages/core/README.md) remains the package entry point.

## Choose a rendering integration

| Surface              | Projection                                                       | Direct Renderer                                                     |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Entry                | `@rightxt/tracker-core/projection`                               | `@rightxt/tracker-core/renderer`                                    |
| Factory              | `createTrackerProjectionIntegration(configuration?)`             | `createTrackerRendererIntegration(configuration, { renderer })`     |
| Output ownership     | Application/framework owns DOM reconciliation.                   | A supplied renderer owns synchronous backend work.                  |
| Read/render protocol | `getProjection()` and `subscribeProjection()`.                   | `TrackerRendererLike` hooks receive current records/options/layout. |
| Configuration        | Complete envelope replacement and preflight.                     | Complete replacement plus options/rule mutation methods.            |
| Special capabilities | Preflight, adapter transaction coordination, pending-work flush. | Keyed `activateItem()` and committed root/options/rules access.     |

Both facades expose snapshots/stats, lifecycle, Core events, `render()`, and `requestRender()`. Neither exposes public renderer transaction `begin`, `commit`, or `rollback` hooks. Direct Renderer can implement another visual backend, but the mount still requires the actual HTMLElement root contract below. Its flexibility does not remove realm or ownership requirements.

Explicit `/projection/debug` and `/renderer/debug` entries have the same static protocol with debug behavior; neutral condition selection is described in [Core API entry points](core-api.md#package-entry-points).

## Mount request surfaces

Import `TrackerProjectionMountRequest` from `/projection`:

```ts
interface TrackerProjectionMountRequest {
  readonly renderRoot: HTMLElement;
  readonly sourceRoot?: TrackerSourceRoot | undefined;
  readonly scrollRoot?: TrackerScrollRoot | undefined;
}
```

Import `TrackerRendererIntegrationMountRequest` and `TrackerRendererMountTarget` from `/renderer`:

```ts
type TrackerRendererMountTarget = { kind: 'host'; host: HTMLElement } | { kind: 'root'; root: HTMLElement };

interface TrackerRendererIntegrationMountRequest {
  readonly rendererTarget: TrackerRendererMountTarget;
  readonly sourceRoot?: TrackerSourceRoot | undefined;
  readonly scrollRoot?: TrackerScrollRoot | undefined;
}
```

The shared `TrackerSourceRoot` and `TrackerScrollRoot` types are root-entry exports. Omission delegates defaults; these Core requests do not use the component adapters' `null`-means-unmounted convention. Projection has `assertMountRequest()`; Direct Renderer has no facade-level equivalent.

## Active realm and root ownership

Projection's `renderRoot` or Direct Renderer's target host/root chooses the active Document and Window. The source and scroll identities are validated against it. Use active-realm constructors and capabilities, not ambient globals that may belong to another document. Environment defaults, page aliases, supported container profiles, Shadow DOM boundaries, and iframe navigation are owned by [Environments](../guides/environments.md).

Every actual render root must be:

- A connected HTMLElement in the selected active realm.
- Consistent with the exact root or host ownership form.
- Separate from source ownership: it cannot equal or be a composed ancestor of the source root. The source may contain output, as with a body source.
- Available for unique active Tracker-root registration in that document.
- The fixed actual-root identity for that mount generation.

| Mount form                | Returned/actual root                                                                   | Cleanup ownership                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Projection                | Exactly the application's `renderRoot`.                                                | Core releases its ownership/metadata; application owns the node and children/reconciliation. Core does not remove the root.            |
| Direct `{ kind: 'root' }` | Renderer `mount()` must return exactly the supplied root.                              | Caller-owned root is preserved; renderer releases its own resources.                                                                   |
| Direct `{ kind: 'host' }` | Renderer returns a connected strict HTMLElement descendant of host, never host itself. | Returned root is renderer-owned mount output; Core can attempt safe fallback removal. Host and unrelated children remain caller-owned. |

A non-null renderer `root` property must equal the root returned at mount commit. A custom renderer cannot substitute a different root later without a new mount. Active or still-quarantined output is not available for another integration. Composed source-isolation checks cross ShadowRoots through hosts, not assigned slots.

## Projection protocol

`TrackerProjectionIntegration` is the opaque 22-method facade from `/projection`; its [full method inventory](core-api.md#projection-integration-api) distinguishes it from Direct Renderer. `getProjection()` reads the latest committed `TrackerProjectionState`. Read current state explicitly and subscribe for future state; subscription does not replay.

The Projection graph is detached, DOM-free, and runtime-frozen, including arrays and attribute/style maps. It contains no source Elements, roots, document/window objects, native events, callback functions, or diagnostics sink. Application bindings must not mutate it.

Projection is a rendering protocol, while `TrackerSnapshot` is an observation representation. Their fields, identity and publication rules differ. A stats reset can publish a snapshot without a Projection commit. The [snapshot reference](core-runtime.md#snapshots) owns observation data.

## Projection state and commits

All types in this section are exported from `/projection`.

| Type                           | Shape and meaning                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrackerElementView`           | `className: string`, `attributes: Readonly<Record<string, string>>`, `styleVars: Readonly<Record<string, string>>`; a DOM-independent element presentation. |
| `TrackerChromeView`            | `root: TrackerElementView`, `markersLayer: TrackerElementView & { hidden: boolean }`; root/layer chrome.                                                    |
| `TrackerItemView`              | Element view plus `key: string`; keyed rendered marker/cluster item.                                                                                        |
| `TrackerViewportView`          | Element view plus `hidden: boolean`; viewport presentation.                                                                                                 |
| `TrackerMountView`             | `mounted: boolean`, `scrollMode: TrackerScrollMode \| null`, `geometryAvailable: boolean`.                                                                  |
| `TrackerSelectionView`         | `previousKey: string \| null`, `selectedKey: string \| null`; logical selection transition.                                                                 |
| `TrackerProjectionState`       | `revision`, `generation`, `chrome`, `items: readonly TrackerItemView[]`, `mount`, `selection`, `viewport`.                                                  |
| `TrackerProjectionDomain`      | `'chrome' \| 'items' \| 'mount' \| 'selection' \| 'viewport'`.                                                                                              |
| `TrackerProjectionCommit`      | `{ changed: readonly TrackerProjectionDomain[]; state: TrackerProjectionState }`; one coherent published state.                                             |
| `TrackerProjectionListener`    | Receives a coherent commit synchronously; future publications only.                                                                                         |
| `TrackerProjectionUnsubscribe` | Idempotent no-argument release of one listener registration owner.                                                                                          |

The initial state has revision/generation zero, unmounted/null scroll mode/unavailable geometry, empty items, null selection keys, hidden viewport, and chrome derived from initial committed options. `getProjection()` remains readable after unmount and destroy. The view has no `destroyed` field; use lifecycle reads for terminality.

`revision` increments by one for each published commit. A commit normally requires a domain reference change; listener recovery can force a full publication. `generation` increments whenever the projected `mount.mounted` boolean changes, including unmount, not just successful mounts. The canonical changed-domain order is chrome, items, mount, selection, viewport. A recovery publication includes all five.

### Subscription and failure

Repeated subscription of the same listener identity delivers once per commit but creates independent reference-counted owners. Each cleanup releases one owner; the final release removes delivery. After destroy, a new subscription returns an inert cleanup. Existing listeners receive terminal unmounted Projection before release.

A synchronous throw is contained as `projection-listener-error`; the already-committed state is not rolled back. Core marks the next successful publication for full-domain resynchronization. Returned thenables are not awaited; a later rejection produces the same diagnostic/recovery flag and refreshes retained stats/snapshot state. Integration bindings should be able to reconcile complete state after a failed partial application.

### Publication order

For ordinary successful rendering: `sync:start` → Projection commit/listener delivery → `sync:end` → optional `selection:change` → snapshot publication. Initial mount differs: lifecycle commits mounted, the staged Projection commits, then the initial sync pair is released. Provisional stages do not publish.

A synchronous Core commit is not proof that a framework binding has committed DOM, measured layout, or painted. Bind classes, attributes, variables, hidden state, and keyed items through the application's own commit model. Remove obsolete values as well as adding current values.

### Pure chrome projection

`projectTrackerChromeView(options: TrackerReadonlyOptions, mount: TrackerMountView): TrackerChromeView` is exported by `/projection`. It performs no DOM work or configuration validation. It produces frozen root/layer presentation: service/application classes, orientation/placement, scroll mode when present, geometry state, drag capability, accessibility/disabled metadata, root variables, and marker-layer hidden state.

Root `styleVars` trims nonblank strings and omits blank/whitespace-only values. Committed option/snapshot strings remain unchanged. This is a root-output rule, not a claim about every low-level renderer input. See [root CSS values](styling.md#root-values-configuration-vs-rendered-output).

## Adapter coordination and preflight

These methods expose Core capabilities; an official adapter is not required to use every one.

| Method                                                   | Exact boundary                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assertMountRequest(request)`                            | Same mount-context normalization as actual mount; no lifecycle change. Invalid input records `invalid-mount-context`, refreshes available snapshot state, then rethrows. No destroyed guard; successful preflight does not authorize a destroyed instance to mount.      |
| `assertConfigurationReplacement(configuration, params?)` | Requires alive state. Validates complete envelope, captures call-time configuration/params, validates `render`, resolves options and rules against current context. No commit/queue; execution later validates against then-live state again.                            |
| `coordinateAdapterTransaction({ name, run, settle? })`   | Executes or queues one outer adapter body through Core FIFO. Ordinary operations in `run()` can report synchronous success/failure while deferred work cannot interleave across body/settlement. Active lifecycle-transition reentrancy outside public dispatch rejects. |
| `flushRender()`                                          | Flushes an existing pending scheduler target immediately. Creates no request; unmounted dirty-but-unscheduled work is not rendered. No pending work is harmless and destroyed is a no-op; reentrant invocation can defer.                                                |

The transaction argument structurally contains `readonly name: string`, `readonly run: () => void`, and optional `readonly settle?: () => void`. Its support name `TrackerProjectionAdapterTransaction` is not independently exported from `/projection`; use the callable's inferred/structural shape rather than a deep import.

`settle` runs exactly once after direct execution, deferred execution, rejection before enqueue, or queue removal. Body, settlement, and deferred-drain failures preserve a sole error or aggregate multiple failures. This coordination does not grant a general rollback transaction over arbitrary application side effects.

## Direct Renderer protocol

`TrackerRendererIntegrationOptions` contains the required `renderer: TrackerRendererLike`. Construction without it rejects with `ERR_TRACKER_INVALID_CONFIGURATION`. The [26-method facade](core-api.md#direct-renderer-integration-api) owns lifecycle/configuration; the supplied renderer owns its rendering implementation and resources.

`TrackerRendererLike` has two optional read properties and nine optional hooks. Missing render/update hooks behave as no-ops. Although `mount` is optional in the type, omission yields no valid root, so a real successful mount requires it. No public `begin`, `commit`, or `rollback` hooks exist.

## TrackerRendererLike

| Property                                               | Contract                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root?: HTMLElement \| null`                           | Optional exposed actual root. A non-null value at commit must agree with `mount()`'s returned root. Core then uses its committed bound identity for the generation.                   |
| `viewportLayout?: TrackerViewportLayoutRecord \| null` | Public optional property, but current Core does not consume it as viewport authority. Core measures and publishes its own viewport record; assigning this field does not override it. |

The callable signatures below use types exported from `/renderer` except shared root types where noted:

```ts
mount?(context: TrackerRendererMountContext, options: TrackerReadonlyOptions): HTMLElement | null;
unmount?(): void;
destroy?(): void;
renderTrack?(options: TrackerReadonlyOptions): void;
renderMarkers?(
  records: readonly TrackerRenderRecord[],
  options: TrackerReadonlyOptions,
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
): void;
renderMarkerPresentation?(
  records: readonly TrackerRenderRecord[],
  markerOptions: TrackerMarkerDefaultsSnapshot | undefined,
): void;
renderSelection?(previousKey: string | null, nextKey: string | null): void;
renderViewport?(layout: TrackerViewportLayoutRecord, options: TrackerReadonlyOptions): void;
updateContext?(context: TrackerRendererContext): void;
```

These are interface member signatures, not standalone implementations. All hooks are synchronous. Any returned thenable is not awaited; rejection is reported as `renderer-hook-returned-thenable`. A Promise from `mount()` is additionally not a valid root and cannot produce a successful mount.

## Renderer context

`TrackerRendererContext` supplies `diagnostics: TrackerDiagnosticsSink | null`, `document: Document | null`, `window: Window | null`, and `scrollMode: TrackerScrollMode | null`. `updateContext()` first receives a construction context with null realm/mode, then receives rewiring for mount, unmount, and committed context changes. The diagnostics value is Core's diagnostics facade, not ownership transfer of the configured application sink.

`TrackerRendererMountContext` contains `target: TrackerRendererMountTarget`, `document: Document`, `window: Window`, and `scrollMode: 'window' | 'element'`. Create nodes and bind platform resources in that context's realm. Borrowed document, Window, and DOM values remain platform-owned; release references/subscriptions on cleanup rather than disposing the platform objects.

`TrackerReadonlyOptions`, also exported from the root entry, is a detached frozen committed options view reused for one options version. Nested data is readonly; the configured diagnostics sink remains caller-owned by identity and is not frozen. Do not mutate it through a render-hook argument.

## Renderer hooks

| Hook                       | Call stage and responsibility                                                                                                     | Omission and synchronous failure                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `mount`                    | After active context staging, before actual-root validation/registration; acquire mount resources and return the conforming root. | Required for successful mounting. Throw aborts mount and triggers rollback.                                                  |
| `unmount`                  | Reversible cleanup of a mounted generation; release per-mount resources.                                                          | If absent, `destroy` is the per-cycle fallback. Throw is retained while state still settles unmounted.                       |
| `destroy`                  | Permanent cleanup; also fallback when `unmount` is absent.                                                                        | Optional; repeat-safe behavior is necessary when used as per-cycle fallback. Throw is retained while terminal state commits. |
| `renderTrack`              | Full or track-target work; apply root/track presentation from options.                                                            | Missing is no-op; throw fails this render attempt.                                                                           |
| `renderMarkers`            | Full/marker work after query/layout/clustering; reconcile ordered items.                                                          | Missing is no-op; throw fails this attempt. Selection reapply and viewport may follow on success.                            |
| `renderMarkerPresentation` | Presentation-only update; apply global/rule presentation without rebuilding query/layout.                                         | Missing is no-op; throw fails this attempt.                                                                                  |
| `renderSelection`          | Standalone logical key transition or current-selection reapply after marker rendering.                                            | Missing is no-op. Standalone failure retains logical transition; failure during marker work fails that render attempt.       |
| `renderViewport`           | After viewport measurement in complete, marker, track, or viewport work.                                                          | Missing is no-op; throw fails this attempt.                                                                                  |
| `updateContext`            | Construction and context rewiring; update dependencies and own resource transitions safely.                                       | Missing is no-op. Throw belongs to the owning operation; Core cannot undo arbitrary partial external effects.                |

### Hook order

| Work                 | Calls                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Complete             | `renderTrack` → `renderMarkers` → selected-key reapply when selected → `renderViewport`. |
| Markers              | `renderMarkers` → selected-key reapply when selected → `renderViewport`.                 |
| Marker presentation  | `renderMarkerPresentation`.                                                              |
| Track                | `renderTrack` → `renderViewport`.                                                        |
| Viewport             | `renderViewport`.                                                                        |
| Standalone selection | `renderSelection(previousKey, nextKey)`.                                                 |

Public `render()` and `requestRender()` request complete work. The table describes hook responsibilities under Core's selected work, not extra facade methods or a transaction-hook protocol.

## Renderer DTOs and records

All names in this section are `/renderer` exports. Render-record arrays and their reachable records are borrowed Core-owned current data, not mutable application caches. They may contain live source Elements and normalized rule callbacks. Treat them as read-only and avoid retaining them when DOM-free [snapshots](core-runtime.md#snapshots) meet the use case.

### Marker and cluster records

| Type                          | Fields and meaning                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrackerMarkerRecord`         | `kind: 'marker'`, `key`, borrowed `element`, `rule: Readonly<TrackerNormalizedRule>`, `ruleIndex`, `selector`, resolved `label: string \| null`, normalized readonly `scroll`/`focus`, and `cluster: string \| null`. Represents a logical source marker and activation configuration. |
| `TrackerMarkerRenderRecord`   | `kind: 'marker'`, `key`, `marker: TrackerMarkerRecord`, `start`, `end`, `size`, `orientation`. Represents one measured marker item.                                                                                                                                                    |
| `TrackerClusterRenderRecord`  | `kind: 'cluster'`, `key`, `markers: readonly TrackerMarkerRecord[]`, `count`, `primaryMarker: TrackerMarkerRecord`, `start`, `end`, `size`, `orientation`. Represents a spatial cluster with primary navigation/presentation ownership.                                                |
| `TrackerRenderRecord`         | Union of marker and cluster render records; discriminate on `kind`.                                                                                                                                                                                                                    |
| `TrackerViewportLayoutRecord` | `start`, `end`, `size`, `visible`, `orientation`, and `source: { scrollOffset; viewportSize; contentSize }`. Percent placement plus raw represented-scroll measurements.                                                                                                               |

Marker/cluster and viewport `start`, `end`, and `size` are track-axis percentages. Viewport `source` contains raw scroll geometry. Records are ordered spatially, using rule order to break equal start positions. A cluster's first spatial marker is primary. These renderer records are distinct from snapshots: they include `end`, orientation, source/configuration data where relevant, and borrowed identities.

The viewport layout passed to `renderViewport()` is an operation-local borrowed measurement. Core makes its own publication copy before the hook runs; treat the argument as read-only even though mutating it does not define snapshot authority.

`TrackerMarkerRecord` is public renderer data. Use it for the hooks/helpers that expose it rather than assuming its fields are a state-mutation API.

### Normalized rule and presentation shapes

| Type                                | Shape and interpretation                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TrackerNormalizedMarkerAttributes` | `values: Readonly<Record<string, string>>` and `removals: ReadonlySet<string>`; serialized application attributes plus persistent rule suppressions.                                             |
| `TrackerNormalizedMarkerOptions`    | `className`, `title: boolean \| undefined`, normalized `attributes`, and readonly `cssVariables: TrackerRuleCssVariables`.                                                                       |
| `TrackerNormalizedRule`             | `index`, trimmed `selector`, static/callable/null `label`, normalized `marker`, normalized `scroll`, normalized `focus`, and `source: TrackerRuleSource`.                                        |
| `TrackerMarkerDefaultsSnapshot`     | Detached frozen global item defaults for the operation: optional `attributes: Readonly<Record<string, string>>`, `className: string`, and `title: boolean`. Distinct from borrowed full records. |
| `TrackerResolvedMarkerPresentation` | Readonly `attributes`, `className`, `cssVariables`, `title: string \| null`; the composed application presentation result.                                                                       |

Normalized scroll has `enabled`, `target`, `behavior`, `align`; normalized focus has `enabled`, `target`. The shared `TrackerTargetSpec`, `TrackerScrollBehavior`, `TrackerScrollAlign`, `TrackerOrientation`, and `TrackerRuleSource` names are imported from the root entry. `TrackerRuleSource` preserves a detached public-rule round-trip view with callback/non-plain identities retained. Exact behavior and precedence are explained in [rule composition](../guides/rules-and-marker-behavior.md).

`TrackerUserAttributeValue` is string/number/boolean, `TrackerUserAttributeInputValue` adds null, and `TrackerUserAttributes` maps names to those inputs. Runtime attribute validation requires finite numbers and supported names. Rule null means suppression; supported global patches use null for deletion. These types are `/renderer` exports; normalized output is serialized strings.

`TrackerRuleCssVariables`, `TrackerCssVariableValue`, `TrackerCssVariablePatchValue`, and `TrackerCssVariablePatch` are available from both `/renderer` and root. They describe complete rule string maps versus root string/null patches. They do not expand the accepted name sets in [Styling](styling.md).

Some named support shapes reachable from declarations are not independent entry exports. Use exported DTOs, inference, or the structural fields given here instead of inventing imports for normalized scroll/focus support names. `TrackerNormalizedRule` itself is explicitly exported from `/renderer`.

### Record helpers

| Export from `/renderer`                                                                                                                                      | Behavior                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isMarkerRenderRecord(record)`                                                                                                                               | Discriminant guard narrowing to `TrackerMarkerRenderRecord`.                                                                                                                |
| `isClusterRenderRecord(record)`                                                                                                                              | Discriminant guard narrowing to `TrackerClusterRenderRecord`.                                                                                                               |
| `getPrimaryMarkerRecord(record)`                                                                                                                             | Returns single record's `marker`, cluster's `primaryMarker`, or null for null/undefined input. No mutation.                                                                 |
| `resolveMarkerPresentation(markerOptions: TrackerMarkerDefaultsSnapshot \| undefined, renderRecord: TrackerRenderRecord): TrackerResolvedMarkerPresentation` | Uses primary marker to combine global/rule classes, override attributes and apply suppressions, copy rule CSS variables, and derive nullable title from label/title policy. |

The presentation helper returns detached application presentation. Rendering geometry and semantic activation remain separate from presentation resolution.

## Transactions and reentrancy

| Calling boundary                                             | State-changing operation behavior                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Stable outer public call                                     | Runs through the normal operation boundary.                                                                                                |
| Public Core event/snapshot dispatch                          | Valid requests defer in FIFO until public dispatch/enclosing operation exits. Call-time validation/capture can still throw before enqueue. |
| Active lifecycle/renderer transition outside public dispatch | Non-terminal reentrant mutation can reject with `ERR_TRACKER_TRANSITION_IN_PROGRESS`. Do not assume every reentrant call queues.           |
| Terminal `unmount()` / `destroy()` request in a transition   | Can defer through the coordinator rather than interrupting the active transition. State-based idempotent paths still apply.                |

Do not treat immediate-returning void operations as confirmation of deferred completion. Use committed state, events, or destruction settlement. A deferred execution failure is reported through `deferred-operation-error`; settlement failure can use `operation-cleanup-error`. Bounded synchronous feedback loops can raise `ERR_TRACKER_REENTRANCY_LIMIT` and drop remaining work according to the owning boundary.

Core can commit/roll back its own state and Projection staging, but offers no user-defined renderer transaction hook set. Custom renderer side effects outside Core's ownership require their own exception safety. See [lifecycle settlement](core-api.md#mount-and-cleanup-settlement).

## Failure and cleanup behavior

Mount failure aborts the provisional generation, attempts rollback cleanup, and leaves stable unmounted state. Invalid actual-root identity, connection, realm, ownership, or exposed `root` agreement produces renderer-contract failure. Cleanup errors can aggregate with the original error.

Synchronous render-hook failure fails that render attempt and leaves complete work dirty for recovery. Initial mount uses error-propagating rendering, so it fails mount. Ordinary scheduled/public rendering contains the render failure as `render-error`, omits successful `sync:end`, and publishes settlement state. A standalone selection-render failure keeps the logical selection transition and notification, although the visual backend may be out of date.

Unmount/destroy continue toward stable unmounted/destroyed state even when hooks throw, then propagate retained cleanup failures. Missing `unmount()` uses `destroy()` as a cycle fallback; implement it safely for remount if relying on that fallback. Context-update failure can restore Core bookkeeping and reapply an earlier context, but cannot automatically undo renderer-created nodes, subscriptions, timers, or other partial effects.

For host-owned output, Core attempts safe fallback removal if renderer cleanup leaves its root connected under host. If the root still remains connected, it is quarantined and remount is blocked while it remains unavailable. Caller-owned root targets are preserved, and temporary Core-owned lifecycle metadata is restored. Root registration and owned output cleanup do not authorize deleting unrelated application children.

## Styling and CSS-value helpers

`CLASS_NAMES`, `DATA_ATTRIBUTES`, and `CSS_VARIABLES` are `/renderer` runtime exports, typed by `TrackerClassNameConstants`, `TrackerDataAttributeConstants`, and `TrackerCssVariableConstants`. `DATA_ATTRIBUTES` is also a `/projection` runtime export. They name supported render hooks; `CSS_VARIABLES` is a mixed, non-exhaustive renderer convenience map that includes geometry names. It is not the full configurable theme inventory.

| `/renderer` helper                                        | Exact conversion                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `toCssValue(value: unknown): string \| null`              | Finite number to string; nonblank string trimmed; blank/other values to null.                                                    |
| `createCssValueMap(map: unknown): Record<string, string>` | Non-plain input to empty map; keep nonempty keys only when `toCssValue` is non-null. No Tracker custom-property-name validation. |
| `toPercent(value: unknown): string`                       | Finite number clamped only at zero and suffixed `%`; non-number/nonfinite to `0%`. Values above 100 are not capped.              |

For example, `toPercent(120)` returns `120%`; it is a formatting helper rather than a geometry validator. A helper accepting a number does not mean root configuration accepts numeric CSS values. Committed root strings remain retained according to configuration semantics, while Projection root output trims/drops as described above. Low-level custom renderer inputs are not universally normalized like root chrome.

The complete 33 root/17 rule variables, classes, data attributes, stylesheet scope, and Theme Builder workflow belong to [Styling Tracker](styling.md).

## Related guides and reference

- [Core API](core-api.md) — facade methods, validation, lifecycle, and events.
- [Core runtime](core-runtime.md) — snapshots, stats, diagnostics, and trace.
- [Custom integration workflow](../guides/custom-integration.md) and [environment guide](../guides/environments.md).
- [Vanilla Shadow DOM](../../site/demos/scenarios/shadow-dom-vanilla/README.md) and [Vanilla iframe](../../site/demos/scenarios/iframe-vanilla/README.md) illustrate shared environment behavior through an adapter. No dedicated custom-renderer demo is provided; these are not renderer-protocol templates.
