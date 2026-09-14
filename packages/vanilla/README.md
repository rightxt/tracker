# @rightxt/tracker-vanilla

[![npm version](https://img.shields.io/npm/v/%40rightxt%2Ftracker-vanilla)](https://www.npmjs.com/package/@rightxt/tracker-vanilla) [![TypeScript declarations](https://img.shields.io/npm/types/%40rightxt%2Ftracker-vanilla)](https://www.npmjs.com/package/@rightxt/tracker-vanilla)

## Overview

An imperative browser adapter for RXT Tracker. Create a Tracker, supply selector rules, and mount a rail showing where matching content sits in a page or scroll container. Markers navigate to source elements, nearby markers can form clusters, and a viewport indicator shows the visible region.

Vanilla internally uses one persistent Direct Renderer-based Core integration. The public Tracker class owns generated DOM and exposes all configuration, lifecycle, events, and read APIs needed for normal use here; consumers do not need Core APIs.

## Installation and package artifacts

```sh
pnpm add @rightxt/tracker-vanilla
```

| Entry / artifact                                        | Contract                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@rightxt/tracker-vanilla`                              | ESM: named Tracker and default Tracker are the same class; also exports the TrackerVanillaMountRequest type. |
| `@rightxt/tracker-vanilla/style.css`                    | Separate canonical stylesheet; JavaScript does not inject it.                                                |
| `@rightxt/tracker-vanilla/rxt-tracker-vanilla.js`       | Production standalone IIFE with Core bundled; constructor global is window.RXTTracker.                       |
| `@rightxt/tracker-vanilla/rxt-tracker-vanilla.debug.js` | Debug standalone IIFE; same global/facade with debug instrumentation.                                        |
| `@rightxt/tracker-vanilla/package.json`                 | Package metadata resource.                                                                                   |

The named/default Tracker class also participates in the type namespace. Core types referenced in method declarations are not re-exported from Vanilla. There is **no Vanilla `/debug` ESM entry**. Normal ESM keeps Core external; a resolver enabling Core's development condition composes debug Core beneath the same adapter. The standalone files are the explicit package-local production/debug choices.

For script-tag use, copy the chosen standalone file and rxt-tracker.css from the installed package's dist assets into your served asset directory. Load the CSS and script, then use `new window.RXTTracker(...)` with the same constructor/method contracts. Debug adds instrumentation, not just different minification. Hosted production assets are also available directly from a CDN; see the [CDN guide](https://rightxt.github.io/tracker/docs/guides/cdn/).

## Quick start

Run after the body and headings exist, with a bundler supporting CSS imports:

```js
import Tracker from '@rightxt/tracker-vanilla';
import '@rightxt/tracker-vanilla/style.css';

const tracker = new Tracker({
  options: { placement: 'right', a11y: { enabled: true, keyboard: true } },
  rules: [{ selector: 'h2', label: (element) => element.textContent }],
});
tracker.mount();

// When the owning view is removed:
// tracker.destroy();
```

`new Tracker()` creates an unmounted instance with defaults and no rules. Mount performs initial synchronization before returning. Use unmount for later reuse or destroy for final cleanup.

## Concepts and mounting

| Concept                       | Package meaning                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tracker / track               | The complete instance coordinating content, output, interaction, and lifecycle / its visual rail.          |
| Viewport / viewport indicator | The visible scroll region / the visual item representing it on the rail.                                   |
| Marker / cluster              | A matched source-element representation / one rendered group of nearby markers.                            |
| Rule                          | An ordered selector plus label, presentation, scroll, and focus behavior.                                  |
| sourceRoot                    | Query scope, distinct from scroll context and output location.                                             |
| scrollRoot                    | The authoritative page/window or element scrolling context.                                                |
| renderHost                    | Caller-owned HTMLElement containing Vanilla's generated .rxtt subtree; not automatically the source scope. |

`mount(request?)` accepts a plain object:

| Field        | Accepted identities                                     | Omitted / undefined                                                                                    |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `sourceRoot` | Document, Element, or directly supplied open ShadowRoot | Active document body in window mode; normalized scroll element in element mode.                        |
| `scrollRoot` | Window or HTMLElement                                   | Window mode. Active-document body/documentElement/scrollingElement aliases also select page scrolling. |
| `renderHost` | HTMLElement                                             | In page mode, the inferred request document's body. Required explicitly in element mode.               |

Request-document inference is **renderHost → scrollRoot → sourceRoot → ambient document**. An omitted host can therefore resolve to a same-origin child document's body, not necessarily ambient document.body. Wait for that body to exist or supply a connected explicit host. Null is rejected for known root fields; omission/undefined select defaults. Root defaults differ from strict own-undefined configuration rules. Use only documented mount keys.

The host target and generated root select the active realm; source/scroll identities must agree. Element sources match descendants, not themselves. Vanilla owns/removes .rxtt and its viewport/marker children, but never owns/removes the caller's host or unrelated children. Do not repurpose the generated root while mounted. See [Environments](#environments) for container, shadow, and iframe forms.

## Configuration

Constructor input is `{ options?, rules? }`; omitted channels default to empty input resolved against defaults. All **36 option leaves** are exposed, with no Vanilla-only leaves. sourceRoot, scrollRoot, and renderHost are mount context, not options. Every option field is optional.

### Track geometry and placement

| Option        | Type / values                            | Default                                 | Meaning and constraints                                                                                                                                                                                           |
| ------------- | ---------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orientation` | `'vertical' \| 'horizontal'`             | `'vertical'`                            | Physical Y or X axis. Changing orientation while mounted in element mode revalidates that scroll root for the requested axis and can reject before commit.                                                        |
| `placement`   | `'left' \| 'right' \| 'top' \| 'bottom'` | Vertical: `'left'`; horizontal: `'top'` | Vertical accepts left/right; horizontal accepts top/bottom. An explicitly incompatible pair rejects. An omitted/inherited incompatible placement falls back to the new axis default. No scrollbar-side inference. |

### Presentation

| Option                  | Type / values                                      | Default | Meaning and constraints                                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cssVariables`          | Plain map of string or null values                 | `{}`    | Root custom-property input. Supported Tracker names and valid application names are accepted; renderer geometry/unknown `--rxtt-*` names reject. Strings remain unchanged in committed reads; null deletes a configured entry in a patch. Replacement removes omitted entries. See [Styling](#styling) for output normalization. |
| `track.className`       | `string`                                           | `''`    | Application classes appended to the standard `.rxtt` root. Whitespace normalized and tokens deduplicated; reserved Tracker service classes reject.                                                                                                                                                                               |
| `viewport.enabled`      | `boolean`                                          | `true`  | Show the viewport indicator when geometry is available. Does not enable/disable update sources.                                                                                                                                                                                                                                  |
| `viewport.className`    | `string`                                           | `''`    | Application classes on `.rxtt__viewport`; same class normalization/reservation rules.                                                                                                                                                                                                                                            |
| `markerLayer.className` | `string`                                           | `''`    | Application classes on `.rxtt__markers`; same class rules.                                                                                                                                                                                                                                                                       |
| `marker.attributes`     | Plain map: string, finite number, boolean, or null | `{}`    | Global application attributes for marker/cluster items. Names lowercased; collisions/reserved names reject. Global patch null deletes an entry; rule null suppresses inheritance. See the name constraints below.                                                                                                                |
| `marker.className`      | `string`                                           | `''`    | Application classes for every marker/cluster, combined with its owning rule's classes. Same class rules.                                                                                                                                                                                                                         |
| `marker.title`          | `boolean`                                          | `true`  | Use a nonempty resolved label as native title; an explicit rule boolean overrides the global policy.                                                                                                                                                                                                                             |

Application attributes support `role`, supported `data-*`, and supported `aria-*` names. `role` requires a nonempty trimmed string; other supported non-null values serialize to strings. `class`, `style`, `id`, `tabindex`, `title`, event-handler/framework-special names, and `data-rxtt-*` are reserved. Use the dedicated class/title/CSS options. Global and per-rule presentation composition is defined in the [rule guide](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/#marker-presentation).

### Clustering

| Option                 | Type / values        | Default | Meaning and constraints                                                                                                                                                                                      |
| ---------------------- | -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clustering.enabled`   | `boolean`            | `true`  | Group nearby measured markers; false keeps individual marker records.                                                                                                                                        |
| `clustering.threshold` | Finite number `>= 0` | `2`     | Distance in track percentage points, not pixels/CSS length. Grouping compares against accumulated cluster bounds. The first spatial member is primary and supplies cluster presentation/activation behavior. |

### Automatic updates

Each family is independently enabled. Delays/debounces use milliseconds. Observer target callbacks are synchronous functions returning arrays; a bare array is not the configuration type.

| Option                      | Type / values            | Default                                                                                               | Meaning and constraints                                                                                                                                                                                |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `updates.mutation.enabled`  | `boolean`                | `true`                                                                                                | Connect the MutationObserver source for relevant external source changes.                                                                                                                              |
| `updates.mutation.targets`  | `(context) => Node[]`    | Resolver returning `[sourceRoot]`                                                                     | Select mutation targets in the active document. Invalid/foreign/Tracker output targets are filtered. A throw/non-array result falls back to defaults; explicit `[]` leaves this observer disconnected. |
| `updates.mutation.debounce` | Finite number `>= 0`     | `100`                                                                                                 | Debounce relevant mutation batches before requesting marker synchronization.                                                                                                                           |
| `updates.resize.enabled`    | `boolean`                | `true`                                                                                                | Control both ResizeObserver and active Window resize updates.                                                                                                                                          |
| `updates.resize.targets`    | `(context) => Element[]` | Source Element or ShadowRoot host, element scroll root when applicable, and render root; deduplicated | Configure ResizeObserver only; Window resize is independent of this target list. Throw/non-array falls back to defaults; `[]` disconnects ResizeObserver, not Window resize.                           |
| `updates.resize.debounce`   | Finite number `>= 0`     | `50`                                                                                                  | Shared debounce for ResizeObserver and Window resize signals.                                                                                                                                          |
| `updates.scroll.enabled`    | `boolean`                | `true`                                                                                                | Frame-coalesced scroll invalidation, including marker geometry and viewport synchronization. False stops automatic viewport synchronization as well.                                                   |
| `updates.interval.enabled`  | `boolean`                | `false`                                                                                               | Enable polling independently of the other update sources.                                                                                                                                              |
| `updates.interval.delay`    | Finite number `> 0`      | `1000`                                                                                                | Polling period while interval updates are active.                                                                                                                                                      |

Target context contains `observerType`, `sourceRoot`, `scrollRoot`, `scrollMode`, `renderRoot`, `document`, `window`, `defaultTargets`, and `reason`. `reason` describes connection/reconnection; `defaultTargets` supplies fresh runtime defaults. Results are deduplicated. Mutation accepts Nodes; resize requires Elements and allows the integration's own render root. Callbacks may inspect the active DOM but must return synchronously and must not mutate the same Tracker during resolution. See [observation targets](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/#observation-targets).

The seven native mutation controls are separate configurable leaves:

| Option                                           | Type / values                                  | Default | Meaning and constraints                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updates.mutation.options.childList`             | `boolean`                                      | `true`  | Observe added/removed children. At least one effective category must remain enabled.                                                              |
| `updates.mutation.options.subtree`               | `boolean`                                      | `true`  | Extend observation to descendants; this alone is not an observation category.                                                                     |
| `updates.mutation.options.attributes`            | `boolean`                                      | `false` | Observe attributes. Effective native value becomes true when an attribute filter exists or old values are requested, even if this field is false. |
| `updates.mutation.options.attributeFilter`       | Nonempty, non-sparse array of nonempty strings | Omitted | Restrict observed attribute names and enable effective attribute observation.                                                                     |
| `updates.mutation.options.attributeOldValue`     | `boolean`                                      | Omitted | Request old attribute values when true; also enables effective attribute observation.                                                             |
| `updates.mutation.options.characterData`         | `boolean`                                      | `false` | Observe text data. Effective native value becomes true when character-data old values are requested.                                              |
| `updates.mutation.options.characterDataOldValue` | `boolean`                                      | Omitted | Request old text-data values when true and enable effective character-data observation.                                                           |

The effective configuration must enable child-list, attributes, or character data. An all-disabled effective configuration rejects; turn off `updates.mutation.enabled` to disable the source instead.

### Interaction

| Option                   | Type / values | Default | Meaning and constraints                                                                                                                                     |
| ------------------------ | ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interaction.activation` | `boolean`     | `true`  | Enable marker, cluster, discrete track, and selected-item keyboard activation. False suppresses their semantic action/activation notifications.             |
| `interaction.drag`       | `boolean`     | `false` | Enable continuous track dragging independently of activation. Standard root `data-rxtt-drag="true"` denotes enabled capability, not a current drag session. |

### Accessibility

| Option          | Type / values     | Default             | Meaning and constraints                                                                                                          |
| --------------- | ----------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `a11y.enabled`  | `boolean`         | `false`             | Standard root gets an accessible label when enabled, or `aria-hidden="true"` when disabled.                                      |
| `a11y.keyboard` | `boolean`         | `false`             | Enable arrows/Home/End selection and Enter/Space activation when a11y is also enabled. `enabled: false, keyboard: true` rejects. |
| `a11y.label`    | Nonempty `string` | `'Content tracker'` | Root accessible label when enabled. Use a meaningful name for the represented content.                                           |

Patch validation includes inherited values: disabling `a11y.enabled` while an inherited `a11y.keyboard` remains true rejects. Change both together when disabling keyboard accessibility. Logical selection is separate from browser focus; preserve visible focus and selected-item styling in custom output.

### Diagnostics

| Option                 | Type / values                                               | Default                 | Meaning and constraints                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnostics.warnings` | `boolean`                                                   | `true`                  | Gate fallback `console.warn` only; configured `output.warn`, warning stats, and the warning event remain active.                                                                 |
| `diagnostics.metrics`  | `boolean`                                                   | `false`                 | Collect render timing when a clock is available. Counters update independently of this flag.                                                                                     |
| `diagnostics.output`   | Sink object with optional `warn`/`error` functions, or null | Omitted; no custom sink | Replace console fallback per implemented severity. Null clears the sink. It is caller-owned and callbacks are best-effort; see [Diagnostics and errors](#debug-and-diagnostics). |

### Configuration methods

Normal construction/mutation is strict and atomic: any validation diagnostic, including a warning, rejects without partial commit. Unknown fields, invalid values, and known own undefined values reject. Omit fields for replacement defaults or patch inheritance; null is accepted only where permitted. Pure validation tooling can return recovered candidates, but Vanilla never silently commits only their valid subset.

| Method                                              | Meaning / return / lifecycle                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `replaceOptions(options, params?)`                  | void; replace from defaults, preserving rules.                                                               |
| `patchOptions(options, params?)`                    | void; deep patch from committed options, retaining omitted fields and applying field-specific null deletion. |
| `replaceConfiguration({ options, rules }, params?)` | void; atomic complete replacement; both own channels required.                                               |
| `getOptions()`                                      | Immutable committed options view, including complete defaults.                                               |
| `getRules()`                                        | Detached readonly rule copies in priority order, preserving callbacks and rule suppressions.                 |

These methods require an alive instance and reject after destroy. Changes work before mount and while mounted. Relevant observers reconnect on commit; needed visual work is normally scheduled while mounted. params.render defaults to true; `{ render: false }` leaves work dirty without requesting that render. Vanilla does not perform Element's extra Projection flush. Batch changes with render false, then call render or requestRender while mounted.

## Rules

Rules are processed in priority order. `selector` is required, trimmed, nonempty, and unique after normalization. The first matching rule owns an overlapping source element. Selector queries follow the source scope; DOM-dependent syntax is validated against the actual source at mount/mounted update boundaries.

The tables cover all **12 rule leaves**. `marker`, `scroll`, and `focus` are containers; `scroll` and `focus` also accept boolean shorthands.

### Selection, labels, and presentation

| Field                 | Type / values                                      | Default               | Meaning and constraints                                                                                                                                                                                |
| --------------------- | -------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `selector`            | Nonempty CSS selector string                       | Required              | Trimmed unique selector; rule order determines overlapping element ownership.                                                                                                                          |
| `label`               | String, null, or `(element) => string \| null`     | `null`                | Static or synchronous source-Element label. Throw is diagnosed; non-string callback output gives no label. Promises are not awaited. Nonempty labels can supply native title.                          |
| `marker.className`    | `string`                                           | `''`                  | Normalized application classes combined with global marker classes. Reserved service classes reject.                                                                                                   |
| `marker.title`        | `boolean`                                          | Inherit global policy | Explicit true/false overrides global `marker.title`; title still needs a nonempty label. Omit to inherit, rather than supplying own `undefined`.                                                       |
| `marker.attributes`   | Plain map: string, finite number, boolean, or null | `{}`                  | Same supported names/serialization as global attributes. Rule values override globals; rule null persistently suppresses the matching inherited attribute.                                             |
| `marker.cssVariables` | Plain string map                                   | `{}`                  | Complete item map, not a patch. Accepts 17 marker/cluster Tracker variables and valid application custom properties; null rejects. Inline item values override inherited values; strings may be blank. |

For a cluster, the primary spatial marker supplies rule presentation. Global/rule classes combine, attributes override or suppress, and rule title policy overrides the global flag. See [rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/).

### Scroll and focus

| Field             | Type / values                                                  | Default   | Meaning and constraints                                                                                                                    |
| ----------------- | -------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `scroll.enabled`  | `boolean`                                                      | `true`    | Attempt scrolling during accepted activation, before focus. `scroll: false` disables just this phase.                                      |
| `scroll.target`   | `'self'`, nonempty selector, or `(element) => Element \| null` | `'self'`  | Resolve the navigation target synchronously. It must belong to the active document and, in element mode, the authoritative scroll subtree. |
| `scroll.behavior` | `'auto' \| 'smooth'`                                           | `'auto'`  | Requested scrolling behavior.                                                                                                              |
| `scroll.align`    | `'start' \| 'center' \| 'end' \| 'nearest'`                    | `'start'` | Alignment along the represented physical axis.                                                                                             |
| `focus.enabled`   | `boolean`                                                      | `false`   | Attempt focus after scrolling. `focus: true` enables it with the default target.                                                           |
| `focus.target`    | Same target forms as `scroll.target`                           | `'self'`  | Same realm/subtree constraints; final target must be an HTMLElement.                                                                       |

Boolean `scroll`/`focus` shorthands toggle their enabled value while retaining other defaults. Target selectors search source descendants, then the containing ShadowRoot when present, then the owner document. Invalid targets, selector failures, or throwing target callbacks yield no usable target for that phase and diagnostics. Callbacks must return synchronously and must not mutate the same Tracker while resolving.

Strict normal mutations reject diagnostic-bearing rules. Pure rule validation removes invalid rule-marker CSS names/entries from its recovered candidate, keeps valid entries, and reports diagnostics. This sanitation does not allow a normal mutation to silently accept only the valid portion. [Validation and recovery](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/#validation-recovery-and-strict-updates) and [activation behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/#activation) provide the detailed contracts.

### Rule mutations

| Method                                    | Meaning / return                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `replaceRules(rules, params?)`            | void; complete ordered replacement; [] clears it.                                        |
| `addRule(rule, params?)`                  | void; append by default or insert at params.index from zero through current list length. |
| `removeRuleByIndex(index, params?)`       | void; remove an existing validated index.                                                |
| `removeRuleBySelector(selector, params?)` | void; remove by normalized selector, not a boolean prediction of deferred work.          |

All require alive state, preserve strict atomic validation, and accept params.render with the same scheduled/default or suppressed-render behavior as option changes. Selectors must remain unique. Vanilla exposes no activateItem method; normal activation comes from rendered interaction.

## Lifecycle

Construction creates one persistent integration and no DOM root. Stable states are unmounted, mounted, and destroyed.

| Readonly property | Meaning                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `state`           | 'unmounted', 'mounted', or 'destroyed'.                                                           |
| `mounted`         | Whether a mount is committed.                                                                     |
| `destroyed`       | Whether the instance is terminal.                                                                 |
| `root`            | Borrowed generated HTMLElement while mounted; null before mount, after unmount, or after destroy. |
| `version`         | Package version string.                                                                           |

All five properties remain readable after destroy.

| Method            | Meaning / return                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `mount(request?)` | void; alive-unmounted only, synchronous initial render. Second mount rejects; unmount before changing context identities. |
| `unmount()`       | void; reversible cleanup and generated-root removal; unmounted/destroyed calls are no-ops.                                |
| `destroy()`       | void; terminal and idempotent, with no remount.                                                                           |
| `whenDestroyed()` | Stable `Promise<void>` for terminal cleanup completion, including when cleanup reports errors.                            |

Successful unmount/remount uses the same Vanilla/Core instance: options, ordered rules, event and snapshot subscriptions survive. Active context, generated root, observers/listeners, and pending mount-generation work do not. Marker keys for the same source Elements and stats history follow that same-instance lifetime; current records are cleared on unmount.

Failed mount rolls back to unmounted state without publishing a successful initial sync pair. Cleanup can throw after unmounted/destroyed state commits; repeating destroy is not a cleanup retry. Event/snapshot-triggered changes may defer until dispatch completes, while call-time validation can still throw. Lifecycle, terminal snapshot/stats, and whenDestroyed remain readable after destroy. Configuration/rule methods, rendering, reset, and new event subscriptions reject then.

## Synchronization and updates

| Method            | Meaning / return                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `render()`        | void; immediate full synchronization through the scheduler, mounted-only. Extra JavaScript arguments throw TypeError. |
| `requestRender()` | void; scheduled/coalesced full synchronization, mounted-only.                                                         |

There is no public refresh or flushRender method on Vanilla. Mount performs initial synchronization independently of automatic-update settings. Mutation, resize, scroll, and interval families are configured above. Resize combines ResizeObserver and active Window resize; targets affect only ResizeObserver. Scroll work includes marker geometry and viewport synchronization.

CSS/CSSOM-only changes are not guaranteed mutation triggers. External layout/content changes require a relevant enabled automatic source or explicit synchronization. Disabling scroll updates stops automatic viewport synchronization too; disabling all sources makes external invalidation the caller's responsibility. See [updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/) and [observation](https://rightxt.github.io/tracker/scenarios/observation/).

## Events

| Event              | Trigger and payload                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marker:activate`  | After scroll then focus attempts: key, source element, ruleIndex, selector, nullable label and sourceEvent.                                                    |
| `cluster:activate` | After primary-marker activation: key, count, markers, nullable primaryMarker and sourceEvent. Member descriptors contain key/element/ruleIndex/selector/label. |
| `track:activate`   | After discrete track scrolling: nullable percentage position and sourceEvent. Continuous drag movement is excluded.                                            |
| `selection:change` | Committed logical transition: nullable previousKey and selectedKey; not browser focus.                                                                         |
| `sync:start`       | Synchronization starts: reason, scheduled flag, nullable timestamp. Initial mount notifications are staged.                                                    |
| `sync:end`         | Successful synchronization: markersCount, clustersCount, nullable duration and timestamp.                                                                      |
| `warning`          | After warning stats/output: code, message, open nullable details.                                                                                              |
| `destroy`          | Terminal notification after cleanup attempts: frozen empty payload; application event registrations are then cleared.                                          |

| Method               | Registration behavior                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `on(name, handler)`  | Synchronous delivery; returns an idempotent unsubscribe owning one registration. Requires alive state; invalid name/handler throws TypeError. |
| `off(name, handler)` | Removes all current owners for the pair; true when removed, false when absent or destroyed. Validates inputs while alive.                     |

Duplicate handler identities are invoked once per publication with independent reference-counted registrations. One unsubscribe releases one owner; the last removes delivery. Old unsubscribes are harmless after destroy. This is Vanilla's dispatcher, not DOM EventTarget ownership.

```js
const unsubscribe = tracker.on('marker:activate', (payload) => {
  console.log(payload.selector, payload.key);
});
// Release this registration when no longer needed:
// unsubscribe();
```

Activation events notify after behavior; listener return values cannot cancel it. sync:end means successful synchronization, not browser paint. Disabling activation suppresses semantic activation/notifications; drag is independently controlled. No generic error, mount, or unmount event exists.

Payload objects are forwarded unchanged. Tracker-owned containers are frozen; Elements/native Events are borrowed. Warning details is a borrowed live graph, not a deeply frozen retained diagnostic copy. Timing is null without enabled/available metrics; sync reason can describe combined manual/observer sources.

Synchronous consumer callback exceptions are caught and host-reported through reportError or an asynchronous-throw fallback; sibling handlers continue. They do not become Core integration-handler diagnostic stats. Returned Promises/thenables are not awaited or inspected: catch asynchronous work explicitly. See the [Vanilla events example](https://rightxt.github.io/tracker/scenarios/events/vanilla/).

## Snapshots and stats

| Method                        | Meaning / lifecycle                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `getSnapshot()`               | Exact untransformed Core TrackerSnapshot: deeply frozen DOM-free runtime graph, including retained terminal snapshot.        |
| `subscribeSnapshot(listener)` | Future synchronous publications, no initial replay; idempotent unsubscribe. After destroy returns an inert unsubscribe.      |
| `getStats()`                  | Detached, unfrozen stats clone in all states, including terminal stats. Debug composition may add debug.                     |
| `resetStats()`                | void; alive-only counter/diagnostic/last-render reset, including internal debug trace; no render request. Destroyed rejects. |

Snapshots cover lifecycle, an options subset, render/selection/viewport state, ordered marker/cluster items, and captured stats. Reads in one observable revision can reuse identity; retained snapshots do not change. Read initial state explicitly. Duplicate listener identities have independent subscription owners with one delivery per publication. Synchronous throws use the host error channel; returned thenables are ignored. Final destroy state is published before listeners are released.

Stats contain render/rule/marker/cluster/observer counters, warning/error totals and last entries, last-render timing, and optional debug data. diagnostics.metrics gates timing only. Reset zeros current counters too without clearing rendered records or configuration/subscriptions. Stats and same-Element marker-key history survive same-instance unmount/remount. For exact underlying shapes/publication details, see [runtime state and diagnostics](https://rightxt.github.io/tracker/docs/reference/core-runtime/); Vanilla's exposure is fully defined by the four methods above.

## Environments

### Page and element containers

Page defaults use the inferred request document's body and Window. An element scroll root must satisfy the supported geometry/CSS profile and have an explicit HTMLElement `renderHost`. Source defaults to the scroll element when omitted. Use connected nodes and place the overlay so it corresponds to that container:

```js
const scrollRoot = document.querySelector('.scroller');
const renderHost = document.querySelector('.tracker-overlay');
tracker.mount({ scrollRoot, renderHost });
```

Each instance represents one authoritative scroll context. Relevant descendant scrolling can invalidate geometry; it does not create multiple independently represented ranges. The [environment guide](https://rightxt.github.io/tracker/docs/guides/environments/) defines supported container profiles, page aliases, and source containment.

### Shadow DOM

An open ShadowRoot may be `sourceRoot`; queries do not automatically enter nested shadow trees. To place the output inside a user ShadowRoot, supply an HTMLElement container inside it as `renderHost`. The ShadowRoot itself is not a valid render host. Load the package stylesheet and theme in that shadow scope; document CSS cannot cross it. Source scope and output placement remain separate decisions.

### Same-origin iframe

Parent-owned code can mount into a loaded same-origin child document by supplying child identities. For page mode, child source/scroll identities can also infer an omitted host as the child body's HTMLElement. An explicit child `renderHost` selects that document directly:

```js
// iframe is loaded and same-origin; its document already has the stylesheet.
const frameDocument = iframe.contentDocument;
tracker.unmount();
tracker.mount({
  sourceRoot: frameDocument.body,
  scrollRoot: iframe.contentWindow,
  renderHost: frameDocument.body,
});
```

All identities must agree with the host's active document. There is no cross-origin bridge or parent/child marker projection. Unmount before navigation, obtain fresh child objects after load, then mount the same Tracker again. The caller owns iframe readiness, stylesheet installation, and navigation sequencing. See [iframe navigation](https://rightxt.github.io/tracker/scenarios/iframe-vanilla/) and [Shadow DOM](https://rightxt.github.io/tracker/scenarios/shadow-dom-vanilla/).

## Styling

Import `@rightxt/tracker-vanilla/style.css` before your theme. JavaScript does not inject it. CSS and theme must reach the actual `.rxtt` document or user ShadowRoot, including child-document CSS for an iframe rail.

| Output hook       | Application configuration                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.rxtt`           | `track.className`, root `cssVariables`.                                                                           |
| `.rxtt__viewport` | `viewport.className`, viewport theme variables.                                                                   |
| `.rxtt__markers`  | `markerLayer.className`.                                                                                          |
| `.rxtt__marker`   | Global and owning/primary rule classes, attributes, title, and item variables; used for marker and cluster items. |

The host is caller-owned and has no additional Vanilla wrapper-selector contract. Preserve service hooks when styling generated output. Public data attributes describe orientation, placement, scroll mode, geometry, item kind/count/key/selection, and enabled drag capability. `data-rxtt-drag="true"` means capability enabled, not an active drag session; keys are rendering identities, not business identifiers. Configure behavior through options/rules rather than editing service attributes.

There are 33 public root Tracker variables, including 17 supported at rule-marker scope, plus valid application-owned custom properties. Global marker presentation combines with rule overrides; a cluster uses its primary marker's rule. Rule null attributes suppress matching global attributes; root patches delete configured entries. Reserved Tracker variables/attributes cannot be used as arbitrary application extension names.

Vanilla applies root and marker custom-property output through `toCssValue()` normalization: nonblank strings are trimmed and blank/whitespace-only output is omitted. Committed options/rule strings remain their configured values according to the field contract. This output conversion does not turn root values into numbers or make rule maps accept null.

The [styling reference](https://rightxt.github.io/tracker/docs/reference/styling/) contains the exhaustive variable/class/attribute contract. [Theme Builder source](https://rightxt.github.io/tracker/tools/theme-builder/) is the tool entry for previewing choices and exporting application overrides; this repository link opens source, and the styling reference remains authoritative. See the [styling scenario](https://rightxt.github.io/tracker/scenarios/styling/) for composition examples.

## Debug and diagnostics

Normal ESM imports compose external neutral Core entries. Enable the Core `development` resolver condition consistently to use debug instrumentation; Vanilla has no `/debug` ESM path. For standalone usage, select `rxt-tracker-vanilla.debug.js` instead of `rxt-tracker-vanilla.js`. Both expose `window.RXTTracker` with the same facade; debug may add `getStats().debug`.

Advanced Core trace retrieval is not Vanilla API. Vanilla does not expose the private integration required by `getTrackerDebugTrace()`, even with debug instrumentation enabled.

`diagnostics.output` has independent optional `warn(code, message, details?)` and `error(code, message, details?)` callbacks. Each replaces fallback console output for its severity. The sink stays caller-owned, its identity is preserved, and null clears it. Sink throws/rejected thenables are contained without changing the original operation outcome; Core does not await or dispose the sink.

Renderer warnings/errors participate in runtime diagnostics. Warnings update retained stats, invoke sink/console output, then publish `warning`. **`diagnostics.warnings` gates only fallback console.warn**; output.warn, warning stats/events, and errors remain independent. Retained stats sanitize details; immediate warning/sink metadata can contain borrowed live objects. Pure validation diagnostics, runtime diagnostics, and thrown exceptions are separate channels.

TrackerError subclasses such as TrackerConfigurationError and TrackerLifecycleError can propagate; Vanilla also creates configuration/lifecycle errors for its own mount/context guards. Codes such as `ERR_TRACKER_INVALID_CONTEXT`, `ERR_TRACKER_DESTROYED`, and `ERR_TRACKER_REALM_MISMATCH` remain on thrown instances. These classes are not re-exported from `@rightxt/tracker-vanilla`; there is no Vanilla error-class import or generic error event. Native errors/aggregates may also propagate. Application event-handler exceptions use the host-error boundary described under Events rather than Core integration-handler diagnostics. See [diagnostics](https://rightxt.github.io/tracker/scenarios/diagnostics/) for a package-based example.

## Demos and further documentation

These absolute repository links open current demo/source materials and public guides:

- [Vanilla playground](https://rightxt.github.io/tracker/playgrounds/vanilla/) — interactive package setup.
- [Vanilla events](https://rightxt.github.io/tracker/scenarios/events/vanilla/), [observation](https://rightxt.github.io/tracker/scenarios/observation/), and [diagnostics](https://rightxt.github.io/tracker/scenarios/diagnostics/).
- [Iframe navigation](https://rightxt.github.io/tracker/scenarios/iframe-vanilla/) and [Shadow DOM](https://rightxt.github.io/tracker/scenarios/shadow-dom-vanilla/).
- [Rule resolution](https://rightxt.github.io/tracker/scenarios/rule-resolution/) and [styling](https://rightxt.github.io/tracker/scenarios/styling/).
- [Environments](https://rightxt.github.io/tracker/docs/guides/environments/), [updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/), [rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/), and [styling reference](https://rightxt.github.io/tracker/docs/reference/styling/) — additional behavioral depth.
