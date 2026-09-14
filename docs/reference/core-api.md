# Core API reference

This reference describes the public Core facades, configuration tooling, lifecycle settlement, and event contracts for custom integration authors. The [Core README](../../packages/core/README.md) owns package orientation and option/rule fields. See [custom integration](../guides/custom-integration.md) for a workflow, [rendering](core-rendering.md) for protocols, and [runtime state](core-runtime.md) for snapshots, stats, diagnostics, and debug.

## Package entry points

| Semantic entry                     | Explicit debug entry                     | Public purpose                                                                       |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `@rightxt/tracker-core`            | `@rightxt/tracker-core/debug`            | Configuration/rule helpers, errors, constants, and shared public types.              |
| `@rightxt/tracker-core/projection` | `@rightxt/tracker-core/projection/debug` | Projection factory, immutable view protocol, and chrome projection.                  |
| `@rightxt/tracker-core/renderer`   | `@rightxt/tracker-core/renderer/debug`   | Direct Renderer factory, renderer protocol, records, and presentation/CSS utilities. |
| `@rightxt/tracker-core/advanced`   | `@rightxt/tracker-core/advanced/debug`   | Debug trace lookup for an original supported Core facade.                            |

Neutral entries select debug behavior through the `development` export condition; production/default resolution selects production behavior. Explicit debug counterparts preserve the corresponding semantic entry's static public surface while selecting debug runtime behavior. Compatible integration/accessor composition is described under [Debug builds](core-runtime.md#debug-builds).

`@rightxt/tracker-core/style.css` is the canonical stylesheet export; JavaScript does not inject it. `@rightxt/tracker-core/package.json` exposes package metadata. These are not JavaScript integration factories.

## Public surface overview

The root entry contains helpers rather than an adapter class. Create a facade with `createTrackerProjectionIntegration(configuration?)` from `/projection`, or `createTrackerRendererIntegration(configuration, { renderer })` from `/renderer`. Both start unmounted. A constructor-style `TrackerConfiguration` can omit `options` and `rules`; later `TrackerConfigurationReplacement` requires both channels.

| Public family                                                | Semantic home                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Configuration validation, normalization, and mutation types  | This reference; option/rule field descriptions remain in the Core README.               |
| Projection's 22 methods and Direct Renderer's 26 methods     | Inventories below; specialized protocol details in [Core rendering](core-rendering.md). |
| Event names, payloads, and subscriptions                     | [Events](#events).                                                                      |
| Projection views and renderer records/hooks/helpers          | [Projection and Direct Renderer reference](core-rendering.md).                          |
| Snapshot, stats, error, diagnostic, and advanced trace types | [Core runtime reference](core-runtime.md).                                              |
| Theme variables and render-contract CSS hooks                | [Styling](styling.md).                                                                  |

## Configuration and rule validation

The following functions and context/result types are exported from `@rightxt/tracker-core`:

```ts
validateOptions(options: unknown, context?: TrackerOptionsValidationContext): TrackerOptionsValidationResult;
validateRule(rule: unknown, context?: TrackerRuleValidationContext): TrackerRuleValidationResult;
validateRules(rules: unknown, context?: TrackerRuleValidationContext): TrackerRulesValidationResult;
```

They do not commit state, emit runtime events, call a diagnostics sink, or update stats. They return new mutable tooling arrays/objects; retained-runtime sanitation and freezing do not apply. `TrackerValidationDiagnostic` extends the diagnostic entry shape with `type: 'warning' | 'error'`. The separate `warnings` and `errors` arrays preserve order and share entry identities with their corresponding `diagnostics` entries.

| Result                           | Fields and interpretation                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TrackerOptionsValidationResult` | `options: TrackerOptionsCandidate`, `diagnostics`, `warnings`, `errors`. There is no `valid` boolean. Invalid known fields can recover previous/default values.                                                    |
| `TrackerRuleValidationResult`    | `valid: boolean`, `rule: TrackerNormalizedRule \| null`, and the three diagnostic arrays. Fatal shape/selector failure can yield `null`; optional-field warnings can coexist with a recovered rule.                |
| `TrackerRulesValidationResult`   | `valid: boolean`, recovered `rules: TrackerNormalizedRule[]`, and diagnostic arrays in input-rule order. Rejected entries are omitted. Duplicate warnings can make the result invalid even when `errors` is empty. |

`TrackerNormalizedRule` is independently importable from `/renderer`, not the root entry. Result fields referencing that type remain usable through inference from the root validators.

### Context and recovery

`TrackerOptionsValidationContext` has optional `previousOptions: Partial<TrackerOptions>` and `inputOptions: unknown`. The former supplies recovery values, falling back to defaults when unusable. The latter supplies the raw input for unknown-key detection; an omitted/non-plain raw input contributes no unknown keys. Normalization and raw-input diagnostics are separate concerns: retain the original input when composing these helpers.

`TrackerRuleValidationContext` has optional `selectorRoot: TrackerSourceRoot | null | undefined` and `hasSelector: (selector: string) => boolean`. A real selector root enables DOM selector syntax validation. `validateRule()` uses `hasSelector` for duplicates; `validateRules()` supplies its own accumulating selector set. Before a source root exists, validation cannot necessarily prove environment-dependent selector syntax. Mount and mounted replacement revalidate against the actual source.

Invalid rule-marker CSS names produce diagnostics and are removed from recovered normalized rules; valid entries remain. This recovery does not imply permission to commit a diagnostic-bearing candidate. See [rule validation behavior](../guides/rules-and-marker-behavior.md#validation-recovery-and-strict-updates).

### Strict mutation boundary

Normal configuration/rule operations reject **any** validation diagnostic, including warnings, with no partial candidate commit. The diagnostic-assertion path throws `TrackerConfigurationError` with `ERR_TRACKER_INVALID_CONFIGURATION` and the complete diagnostic array in native `cause`. Other configuration errors need not have that cause shape. Helper diagnostics are not automatically replayed as runtime warnings/errors during rejection.

An own known option/rule field set to `undefined` is invalid; omission is different. Replacement uses defaults for omitted options, while supported patches merge from committed options. A complete rules list preserves ordered first-match ownership. `TrackerOperationParams` supplies optional `render?: boolean`, defaulting to true. `render: false` preserves render-required work as dirty rather than scheduling it; it does not turn strict validation off. `TrackerAddRuleParams` adds optional insertion `index`; valid insertion indices run from zero through the current list length, while removal indices must identify an existing entry.

## Configuration helpers

All helpers in this section are current public exports of `@rightxt/tracker-core`. They are usable independently of a mounted facade.

| Helper                                                                           | Signature/input and behavior                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertCompleteTrackerConfigurationEnvelope(configuration)`                      | Asserts `TrackerConfigurationReplacement` from `unknown`: plain object, own `options` and `rules`, no extra top-level keys, plain options object, array rules. It checks the envelope, not deep semantic validity. Non-plain whole input throws native `TypeError`; malformed envelopes reject as configuration errors.            |
| `assertValidTrackerConfiguration(configuration)`                                 | Asserts constructor-style `TrackerConfiguration` from `unknown`; omitted channels use empty defaults. Non-plain whole input throws `TypeError`; unknown keys, own known `undefined`, wrong containers, or any validation diagnostic reject. Does not establish selector-root-dependent syntax without a root.                      |
| `cloneTrackerConfiguration<T extends TrackerConfiguration>(configuration: T): T` | Recursively detaches arrays/plain data, including cycles and sparse array shape. Functions, platform objects, other non-plain instances, and `diagnostics.output` preserve identity. Cloning does not validate.                                                                                                                    |
| `createDefaultOptions()`                                                         | Produces fresh mutable complete defaults. Observer target defaults are lazy functions; this helper does not read DOM or execute resolvers.                                                                                                                                                                                         |
| `isTrackerConfigurationObject(value)`                                            | Container predicate over `unknown`: accepts cross-realm plain and null-prototype objects, rejects arrays/functions/DOM/built-ins/class instances. It does not validate option keys or values.                                                                                                                                      |
| `normalizeOptions(options = {}, context = {})`                                   | Creates a merged `TrackerOptionsCandidate`; usable `baseOptions` takes precedence over `currentOptions`, then defaults. A non-plain overlay contributes no overlay. Keeps known-invalid values for later validation, lowercases marker attribute keys, and preserves sink identity. Does not validate, read DOM, or run resolvers. |
| `normalizeRule(rule, context = {})`                                              | Trims selector, applies candidate shorthands/defaults, and retains invalid known values for validation. Uses integer `context.index`, otherwise zero. Produces normalized candidate fields plus detached `source`; no selector syntax check or acceptance decision.                                                                |
| `resolveTrackerOptions(inputOptions, context = {})`                              | Strict option resolution, rejecting own known `undefined` and diagnostics. Default replacement resolves from defaults; `replace: false` patches from `previousOptions`. Returns complete resolved options, not a facade commit.                                                                                                    |
| `diffOptions(previousOptions, nextOptions): TrackerOptionsDiff`                  | Compares options by recursive array/plain-object value equality, with identity for functions/platform/non-plain values. Cyclic pairs are supported. Does not compare rules or mutate either input.                                                                                                                                 |

`TrackerOptionsNormalizationContext` exposes optional `baseOptions` and `currentOptions`, both partial option values. `TrackerRuleNormalizationContext` exposes optional `index`. `TrackerOptionsCandidate` is a partial options intermediate, not a guarantee of complete or validated state. `TrackerRuleSource` is a detached public-rule round-trip representation with trimmed selector; callback/platform identities are preserved.

### Option diff domains

`TrackerOptionsDiff` has nine boolean fields:

| Flag                 | Compared option family                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `track`              | Orientation, placement, track/viewport/marker-layer classes, accessibility enabled/keyboard/label. |
| `styles`             | Root CSS variables.                                                                                |
| `viewport`           | Orientation and viewport enabled state.                                                            |
| `markers`            | Orientation and clustering enabled/threshold.                                                      |
| `markerPresentation` | Global marker class, attributes, title policy.                                                     |
| `observers`          | Mutation/resize/scroll/interval enablement, targets, native options, debounce, delay.              |
| `interaction`        | Orientation, activation/drag, accessibility enabled/keyboard.                                      |
| `diagnostics`        | Warning fallback, metrics, output sink.                                                            |
| `changed`            | OR of the eight domain flags.                                                                      |

These flags describe differences; invoking the helper does not schedule any work.

### Support shapes and importability

Some support shapes appear in callable declarations without an independent entry export. Do not invent deep package imports for them. `normalizeRule()`'s candidate return shape is inferred; its support name `TrackerNormalizedRuleCandidate` is not a root-entry export. Likewise `resolveTrackerOptions()` references `TrackerOptionsResolutionContext` and `TrackerResolvedOptions` without exporting those names there. Its context structurally supplies optional `previousOptions` (a complete resolved value, for example inferred from a prior resolution) and `replace?: boolean`.

Use inferred return types or structural descriptions where needed. Publicly exported context/candidate/diff types above are ordinary supported public types; normalization still does not confer validation.

## Projection integration API

Factory and facade types are imported from `@rightxt/tracker-core/projection`. `createTrackerProjectionIntegration(configuration = {})` returns `TrackerProjectionIntegration`. The following is its complete 22-method inventory; specialized semantics are expanded in [Projection protocol](core-rendering.md#projection-protocol).

| Method                                                   | Meaning and constraints                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertConfigurationReplacement(configuration, params?)` | Preflight complete replacement while alive; no commit or queue.                                                                                               |
| `assertMountRequest(request)`                            | Validate mount context without lifecycle change. Can validate after destroy, but cannot make a subsequent mount legal.                                        |
| `coordinateAdapterTransaction({ name, run, settle? })`   | Coordinate an outer adapter transaction and exactly-once settlement through Core's operation boundary. No generic alive guard; transition restrictions apply. |
| `destroy()`                                              | Terminal, idempotent teardown; cleanup errors may propagate after terminal settlement.                                                                        |
| `getProjection()`                                        | Read latest committed immutable view state, including before mount and after destroy.                                                                         |
| `flushRender()`                                          | Flush already-pending scheduler work. No new request; harmless without pending work; destroyed no-op.                                                         |
| `getState()`                                             | Read `TrackerState`: unmounted, mounted, or destroyed.                                                                                                        |
| `getSnapshot()`                                          | Read current immutable observation snapshot; terminal snapshot retained.                                                                                      |
| `getStats()`                                             | Read detached current/terminal stats.                                                                                                                         |
| `isDestroyed()`                                          | Query terminal lifecycle state.                                                                                                                               |
| `isMounted()`                                            | Query committed mounted state.                                                                                                                                |
| `mount(request)`                                         | Mount exact `renderRoot`; alive-unmounted only.                                                                                                               |
| `off(eventName, handler)`                                | Remove all current owners for that event/handler; return whether an entry existed. Destroyed returns false.                                                   |
| `on(eventName, handler)`                                 | Subscribe an integration-owned typed event handler; returns one-owner unsubscribe. Requires alive state.                                                      |
| `render()`                                               | Mounted-only immediate complete synchronization through scheduler flush.                                                                                      |
| `replaceConfiguration(configuration, params?)`           | Strict atomic complete options/rules replacement; alive stable states.                                                                                        |
| `requestRender()`                                        | Mounted-only scheduled/coalesced complete synchronization.                                                                                                    |
| `resetStats()`                                           | Clear diagnostics state and publish snapshot; alive states only.                                                                                              |
| `subscribeProjection(listener)`                          | Subscribe future coherent view commits; destroyed returns inert unsubscribe.                                                                                  |
| `subscribeSnapshot(listener)`                            | Subscribe future observation publications; destroyed returns inert unsubscribe.                                                                               |
| `unmount()`                                              | Reversible mounted-to-unmounted cleanup; unmounted/destroyed no-op.                                                                                           |
| `whenDestroyed()`                                        | Same completion Promise per integration; resolved by terminal destroy publication.                                                                            |

Projection exposes no options/rules/root getters, incremental rules methods, or public `activateItem()`.

## Direct Renderer integration API

Import `createTrackerRendererIntegration`, `TrackerRendererIntegration`, and `TrackerRendererIntegrationOptions` from `@rightxt/tracker-core/renderer`. The factory accepts `(configuration, integrationOptions)`; `configuration` may be `undefined`, but `integrationOptions.renderer` is required. Missing renderer rejects construction. See [renderer protocol](core-rendering.md#direct-renderer-protocol).

| Method                                         | Meaning and constraints                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `addRule(rule, params?)`                       | Add an ordered rule, optionally at `params.index`; strict validation before acceptance.                                               |
| `activateItem(key, options?)`                  | Activate a current marker/cluster after renderer-owned hit testing; optional `sourceEvent`. Returns boolean; destroyed returns false. |
| `destroy()`                                    | Terminal idempotent teardown.                                                                                                         |
| `getOptions()`                                 | Committed detached/frozen `TrackerReadonlyOptions`; same options-version reference can be reused. Destroyed rejects.                  |
| `getRoot()`                                    | Current committed actual HTMLElement or null without an active root.                                                                  |
| `getRules()`                                   | Fresh detached/frozen `readonly TrackerReadonlyRule[]` in priority order. Destroyed rejects.                                          |
| `getSnapshot()`                                | Immutable current/terminal observation snapshot.                                                                                      |
| `getState()`                                   | Stable lifecycle state.                                                                                                               |
| `getStats()`                                   | Detached current/terminal statistics.                                                                                                 |
| `isDestroyed()`                                | Terminal-state query.                                                                                                                 |
| `isMounted()`                                  | Committed mount query.                                                                                                                |
| `mount(request)`                               | Alive-unmounted mount using `rendererTarget`.                                                                                         |
| `off(eventName, handler)`                      | Remove all current owners for the pair; boolean result, false after destroy.                                                          |
| `on(eventName, handler)`                       | Alive-state event subscription with owner-specific unsubscribe.                                                                       |
| `patchOptions(options, params?)`               | Strict deep patch from committed options.                                                                                             |
| `removeRuleByIndex(index, params?)`            | Strictly validate an existing index, then remove that rule; returns void.                                                             |
| `removeRuleBySelector(selector, params?)`      | Remove by normalized selector; returns void, not a prediction of queued work.                                                         |
| `render()`                                     | Mounted-only complete request and immediate scheduler flush; unexpected runtime arguments are rejected.                               |
| `replaceConfiguration(configuration, params?)` | Atomic complete options-plus-rules replacement.                                                                                       |
| `replaceOptions(options, params?)`             | Replace options from defaults; preserves separate rules.                                                                              |
| `replaceRules(rules, params?)`                 | Replace the full ordered rule list.                                                                                                   |
| `requestRender()`                              | Mounted-only complete scheduled/coalesced request.                                                                                    |
| `resetStats()`                                 | Alive-state diagnostics reset and snapshot publication.                                                                               |
| `subscribeSnapshot(listener)`                  | Future-only observation subscription; post-destroy inert unsubscribe.                                                                 |
| `unmount()`                                    | Reversible mount cleanup, preserving configuration/rules.                                                                             |
| `whenDestroyed()`                              | Same terminal completion Promise across repeated calls.                                                                               |

These are all 26 methods. There is no Projection getter/subscription, `flushRender()`, or facade preflight/adapter-coordinator counterpart. `TrackerActivateItemOptions` is a renderer-entry type with optional `sourceEvent`; invalid/unknown keys warn and return false, and disabled/unavailable activation does not become a successful action.

## Lifecycle capability matrix

| Capability                                       | Alive/unmounted                              | Mounted                                    | Destroyed                           |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------ | ----------------------------------- |
| Mount                                            | Allowed after request validation.            | Rejects already-mounted state.             | Rejects terminal state.             |
| Configuration/rule mutations exposed by facade   | Allowed; required render work remains dirty. | Allowed; normally schedules required work. | Rejects.                            |
| `render()` / `requestRender()`                   | Rejects invalid context.                     | Allowed.                                   | Rejects destroyed state.            |
| Lifecycle queries                                | Available.                                   | Available.                                 | Available.                          |
| Direct options/rules reads                       | Available.                                   | Available.                                 | Rejects.                            |
| Direct root read                                 | Null.                                        | Committed root.                            | Null.                               |
| Projection read                                  | Initial/unmounted view.                      | Committed view.                            | Final unmounted view.               |
| Snapshot/stats reads                             | Available.                                   | Available.                                 | Retained terminal data.             |
| Reset stats                                      | Allowed.                                     | Allowed.                                   | Rejects.                            |
| Event `on()`                                     | Allowed.                                     | Allowed.                                   | Rejects.                            |
| Event `off()`                                    | Removes valid registration or false.         | Same.                                      | False.                              |
| Snapshot/Projection subscriptions, where exposed | Future-only registration.                    | Future-only registration.                  | Inert unsubscribe; no new listener. |
| `unmount()`                                      | No-op.                                       | Cleanup then unmounted.                    | No-op.                              |
| `destroy()`                                      | Terminal cleanup.                            | Mount cleanup then terminal cleanup.       | No-op.                              |
| `whenDestroyed()`                                | Pending until destroy.                       | Pending until destroy.                     | Resolved.                           |

### Mount and cleanup settlement

Creation starts unmounted. Mount commits only after required provisional setup and initial synchronization succeed. Failed request normalization reports its diagnostic and leaves unmounted state; failure after acquisition triggers rollback, publishes stable unmounted state, and propagates the failure, possibly aggregated with cleanup errors. No successful initial sync pair escapes a failed mount.

Unmount is reversible and effectively idempotent at the public lifecycle level. Configuration/rules persist, while active roots, observer/listener/timer resources, and pending generation work do not. Cleanup failure can propagate after state has already become unmounted. A renderer-owned root left connected can prevent safe remount; see [root cleanup](core-rendering.md#failure-and-cleanup-behavior).

Destroy is terminal even when cleanup throws. State commits destroyed, terminal notifications/publication are attempted, subscriptions are cleared, and retained failures are then rethrown. A sole failure can be rethrown directly; multiple failures can be an `AggregateError`. Repeating destroy is a no-op, not a retry of failed cleanup. `whenDestroyed()` resolves even when cleanup failure is propagated.

## Events

Root exports `EVENT_NAMES`, `EVENT_NAME_VALUES`, and event types. `TrackerEventName` contains exactly the eight names below; `TrackerEventNameConstants` types the named constant map, `TrackerEventPayloadMap` maps names to payload types, and `TrackerEventPayload` is their union. `TrackerTypedEventHandler<TName>` narrows by name; `TrackerEventHandler` accepts the payload union. `TrackerEventUnsubscribe` is a no-argument cleanup function.

All notifications are synchronous and non-canceling. There are no generic public mount, unmount, configuration, render, or error events.

| Event / payload type                                      | Trigger, payload, and lifecycle                                                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `marker:activate` / `TrackerMarkerActivateEventPayload`   | Mounted semantic marker activation: `key`, borrowed source `element`, `ruleIndex`, `selector`, resolved `label: string \| null`, and `sourceEvent: Event \| null`. Scroll then focus are attempted before notification.        |
| `cluster:activate` / `TrackerClusterActivateEventPayload` | Mounted semantic cluster activation: `key`, `count`, `markers: readonly TrackerEventMarker[]`, `primaryMarker: TrackerEventMarker \| null`, `sourceEvent: Event \| null`. Navigation uses the primary marker first.            |
| `track:activate` / `TrackerTrackActivateEventPayload`     | Discrete track activation: `position: number \| null` in clamped 0–100 track percent, and borrowed `sourceEvent: Event`. Null means no usable activation geometry. Scrolling precedes notification; drag movement is excluded. |
| `selection:change` / `TrackerSelectionChangeEventPayload` | Real committed logical transition: `previousKey` and `selectedKey`, both string or null. Can accompany initial/mounted synchronization or standalone selection; clearing on unmount/destroy alone emits no selection event.    |
| `sync:start` / `TrackerSyncStartEventPayload`             | Normal render transaction start; initial mount notification is staged. `reason`, `scheduled: boolean`, `timestamp: number \| null`. A started attempt may fail and have no end event.                                          |
| `sync:end` / `TrackerSyncEndEventPayload`                 | Successful transaction only: `markersCount`, `clustersCount`, `duration: number \| null`, `timestamp: number \| null`. Does not promise framework DOM commit, layout, paint, or application effects.                           |
| `warning` / `TrackerWarningEventPayload`                  | An already-recorded warning, possible before mount, while mounted, or during cleanup. Alias of `TrackerDiagnosticEntry`: `code`, `message`, `details`. Stats/output precede the event.                                         |
| `destroy` / `TrackerDestroyEventPayload`                  | Once per terminal transition after cleanup attempts and terminal state commit. Frozen empty `Record<string, never>` payload; subscriptions have not yet been globally cleared at handler time.                                 |

`TrackerEventMarker` is the marker's `key`, borrowed `element`, owning `ruleIndex`/`selector`, and nullable label; the marker-activation payload adds `sourceEvent`. Cluster envelopes, marker DTOs, arrays, and reason trees are Tracker-owned and frozen. Borrowed Elements and native Events are not frozen. Warning `details` is a deliberate live borrowed graph rather than a frozen/cloned nested DTO; [retained diagnostic details](core-runtime.md#diagnostic-codes-and-retained-details) have different ownership.

`sync:start.reason` is structurally `{ source?: string; scheduled?: boolean; reasons?: readonly ...[] } | null | undefined`. Its support names `TrackerRenderReason` and `TrackerRenderReasonSource` are not root-entry imports. Reasons include observation and manual sources and can combine several origins. `scheduled: true` can accompany synchronous `render()` because it immediately flushes scheduler-owned work. Timing fields are null without enabled/available metrics. See [scheduling reasons](../guides/updates-and-refresh.md#reading-synchronization-reasons).

### Activation and selection ordering

Marker/cluster scroll and focus are attempted before their event. Return values, thrown handlers, and late `preventDefault()` do not cancel those actions. `interaction.activation: false` suppresses marker, cluster, discrete track, and selected-item keyboard activation. Drag is separately controlled and does not emit `track:activate` for its movement.

Ordinary successful synchronization orders `sync:start`, rendering/Projection commit, completed stats, `sync:end`, an optional real selection transition, then snapshot publication. Initial mount commits lifecycle and Projection first, then releases the staged initial sync pair and snapshot batch. A failed render has no `sync:end`.

A standalone logical selection transition can emit without sync events. Failure to render its selection does not erase the committed logical transition. Selected key is therefore not proof that every backend painted selection successfully. See [rule behavior](../guides/rules-and-marker-behavior.md#selection-and-accessibility).

## Event subscription and ordering

`on(eventName, handler)` requires an alive facade, known event name, and function handler. Destroyed subscription throws `ERR_TRACKER_DESTROYED`; invalid names/handlers throw `TypeError`. `off()` returns false after destroy; otherwise invalid names/handlers throw, absent valid pairs return false, and removal returns true.

Duplicate handler identity is delivered once per emission but has reference-counted registration owners. Each returned unsubscribe releases only its own owner and is idempotent. The last owner removes delivery. `off()` removes all current owners for the pair; an old unsubscribe cannot affect a new registration created after removal.

Core facade handlers are integration-owned bridges. Return values are ignored; synchronous throws are contained, returned thenables are not awaited, and later rejections are observed. Both failures produce `integration-event-handler-error` without rolling back the emitting operation. Do not transfer this contract to adapter-native callbacks, outputs, emits, or CustomEvents.

Valid state-changing operations requested during public event/snapshot dispatch queue until dispatch exits. Many arguments are validated and captured before queuing, so invalid calls can still throw synchronously within a handler. Later deferred-operation failure is diagnosed rather than retroactively changing the already-returned call. Active renderer/lifecycle callbacks have different [reentrancy rules](core-rendering.md#transactions-and-reentrancy).

## Snapshot and stats entry points

Both facades expose `getSnapshot()`, `subscribeSnapshot()`, `getStats()`, and `resetStats()`. Snapshots are immutable DOM-free observation data; standalone stats are detached mutable clones. Projection subscriptions are a separate integration protocol. Full shapes, publication/identity rules, listener failure boundaries, metrics, reset, and terminal retention belong to [Core runtime](core-runtime.md).

## Low-level public helpers and types

The following grouped root-entry types describe configuration rather than introducing another option schema. Their field authority remains in the [Core README](../../packages/core/README.md); workflow references explain composition and runtime effects.

| Root type family                                                                                                                                                                     | Public meaning                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrackerOptions`, `TrackerConfiguration`, `TrackerConfigurationReplacement`                                                                                                          | Option graph, optional constructor envelope, and required two-channel replacement envelope respectively.                                                                                           |
| `TrackerReadonlyOptions`, `TrackerReadonlyRule`                                                                                                                                      | Deep-readonly committed option/public-rule views. Renderer options are detached/frozen except borrowed sink identity; rule getter copies preserve callback/non-plain identities.                   |
| `TrackerTrackOptions`, `TrackerViewportOptions`, `TrackerMarkerLayerOptions`                                                                                                         | Track class, viewport enablement/class, and marker-layer class configuration.                                                                                                                      |
| `TrackerMarkerDefaults`, `TrackerMarkerOptions`, `TrackerRule`                                                                                                                       | Global item defaults, per-rule presentation overrides, and ordered selector/label/presentation/scroll/focus behavior.                                                                              |
| `TrackerClusteringOptions`, `TrackerInteractionOptions`, `TrackerA11yOptions`                                                                                                        | Proximity grouping, activation/drag switches, and accessible label/keyboard policy.                                                                                                                |
| `TrackerUpdateOptions`, `TrackerMutationUpdateOptions`, `TrackerMutationObserverOptions`, `TrackerResizeUpdateOptions`, `TrackerScrollUpdateOptions`, `TrackerIntervalUpdateOptions` | Four update families, target resolvers/native mutation controls, debounce, and polling configuration. See [observation targets](../guides/updates-and-refresh.md#observation-targets).             |
| `TrackerDiagnosticsOptions`                                                                                                                                                          | Warning-console fallback, metrics, optional output sink; [diagnostic channels](core-runtime.md#diagnostic-channels) define behavior.                                                               |
| `TrackerFocusOptions`, `TrackerFocusOptionsObject`, `TrackerScrollOptions`, `TrackerScrollOptionsObject`                                                                             | Boolean shorthands or objects controlling enabled state/target; scroll also carries behavior and alignment.                                                                                        |
| `TrackerTargetSpec`, `TrackerScrollBehavior`, `TrackerScrollAlign`                                                                                                                   | `'self'`, selector, or synchronous Element/null resolver; scrolling `'auto'`/`'smooth'`; alignment `'start'`/`'center'`/`'end'`/`'nearest'`.                                                       |
| `TrackerOrientation`, `TrackerOrientationConstants`, `TrackerPlacement`, `TrackerPlacementConstants`                                                                                 | Physical axis and compatible edge types/maps. Runtime `ORIENTATIONS` and `PLACEMENTS` expose corresponding named values.                                                                           |
| `TrackerState`, `TrackerScrollMode`, `TrackerSourceRoot`, `TrackerScrollRoot`                                                                                                        | Stable lifecycle union, window/element mode, Document/Element/ShadowRoot source, and Window/HTMLElement scroll root. [Environment restrictions](../guides/environments.md) still apply at runtime. |
| `TrackerCssVariableValue`, `TrackerCssVariablePatchValue`, `TrackerCssVariablePatch`, `TrackerRuleCssVariables`                                                                      | String values; root string/null patch entries and map; complete rule string map without null tombstones. Exact accepted names and normalization are in [Styling](styling.md).                      |

Configuration normalization/validation types are documented with their helpers above. Event types are documented with payloads. Root snapshot/stat/diagnostic/error/debug types have their semantic home in [Core runtime](core-runtime.md). Renderer-specific attribute, record, context, constant, and normalized-rule types are imported from `/renderer` and described in [renderer DTOs](core-rendering.md#renderer-dtos-and-records). Projection types belong to `/projection`, and advanced trace types to `/advanced`; none requires an invented deep import.

## Error classes and codes

Root exports `TrackerError`, `TrackerConfigurationError`, and `TrackerLifecycleError` as runtime classes and TypeScript types, with `TrackerErrorOptions` and `TrackerErrorCode`. Native `TypeError`, original thrown values, and `AggregateError` can also cross public operation boundaries. Branch on a known Tracker error's stable code rather than human message text. The [nine error codes](core-runtime.md#errors) and separate diagnostic-code catalog are in the runtime reference.

## Related reference

- [Rendering protocols](core-rendering.md): root ownership, DTOs, hooks, coordination, and cleanup.
- [Runtime state and diagnostics](core-runtime.md): snapshots, stats, error channels, debug trace.
- [Custom integration guide](../guides/custom-integration.md): applying the facades in a complete workflow.
- [Environments](../guides/environments.md), [updates](../guides/updates-and-refresh.md), [rules](../guides/rules-and-marker-behavior.md), and [styling](styling.md): shared behavioral depth without replacing package APIs.
