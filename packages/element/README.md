# @rightxt/tracker-element

[![npm version](https://img.shields.io/npm/v/%40rightxt%2Ftracker-element)](https://www.npmjs.com/package/@rightxt/tracker-element) [![TypeScript declarations](https://img.shields.io/npm/types/%40rightxt%2Ftracker-element)](https://www.npmjs.com/package/@rightxt/tracker-element)

## Overview

A standards-based Custom Element adapter for RXT Tracker. Place `<rxt-tracker>` in your document, configure options and ordered selector rules with JavaScript, and let DOM connection manage its runtime. It uses Core Projection internally; consumers use the Element API documented here.

| Concept                       | Package meaning                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tracker / track               | The complete content-tracking integration / its visual rail.                                                        |
| Viewport / viewport indicator | The visible scroll region / its visual representation on the rail.                                                  |
| Marker / cluster              | A matched source-element representation / one rendered group of nearby markers.                                     |
| Rule                          | An ordered selector plus label, presentation, scroll, and focus behavior.                                           |
| Host                          | The caller-owned `<rxt-tracker>` element. It is not automatically the source scope.                                 |
| Owned render root             | The adapter's `.rxtt` HTMLElement, created directly in the host's Light DOM.                                        |
| Source root / scroll root     | The query scope / the authoritative page or element scrolling context. Neither selects an independent output realm. |

The adapter owns only its generated `.rxtt` subtree. Application children and host DOM state remain caller-owned. It creates no private ShadowRoot.

## Installation and registration

```sh
pnpm add @rightxt/tracker-element
```

| Entry / artifact                                        | Contract                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@rightxt/tracker-element`                              | Side-effect-free ESM root: named `TrackerElement`, `defineTrackerElement`, and default alias of `TrackerElement`. TypeScript also exports `TrackerElementOptions`. |
| `@rightxt/tracker-element/register`                     | Side-effect-only ESM registration entry; calls the helper and exports nothing.                                                                                     |
| `@rightxt/tracker-element/style.css`                    | Separate canonical stylesheet; JavaScript does not inject it.                                                                                                      |
| `@rightxt/tracker-element/rxt-tracker-element.js`       | Standalone production IIFE; auto-registers `rxt-tracker` and exposes `window.RXTTrackerElement`.                                                                   |
| `@rightxt/tracker-element/rxt-tracker-element.debug.js` | Standalone debug IIFE; same global/tag and class surface, with debug instrumentation.                                                                              |
| `@rightxt/tracker-element/package.json`                 | Package metadata resource.                                                                                                                                         |

The named/default class also exists in the type namespace. `TrackerElementOptions` describes the full option surface below; rules remain a separate method channel. Root ESM does not auto-register. Root plus `/register` uses the same ESM constructor; both keep neutral Core external. There is no Element `/debug` ESM entry.

### Registration choices

Import `/register` for convenience, or call the no-argument `defineTrackerElement()` from the root entry. The helper:

- Returns null when `customElements` is unavailable.
- Registers and returns TrackerElement when the default tag is free.
- Returns the existing class idempotently when that same constructor owns the tag.
- Throws a plain Error when a different constructor owns `rxt-tracker`.

Manual platform registration with the exported class is also possible as an alternative, for example `customElements.define('app-content-tracker', TrackerElement)` in a registry where that constructor is not already registered. The helper only targets the default name.

Choose one registration build per CustomElementRegistry. Independent ESM/standalone or production/debug standalone copies have different constructor identities and can collide for the same default tag. Standalone scripts auto-register; do not load both to switch debug behavior in an already-registered registry. Serve the selected standalone file with the separate `rxt-tracker.css` asset from the installed package's `dist` output. Hosted production assets are also available directly from a CDN; see the [CDN guide](https://rightxt.github.io/tracker/docs/guides/cdn/).

There is no custom pre-upgrade property replay shim. Define/upgrade the element before assigning sourceRoot/scrollRoot; assignments made on an unresolved unknown element are not a supported configuration workflow. Native registration/upgrade rules still apply.

## Quick start

Run after the document body and headings exist. This uses a bundler supporting CSS imports and configures the upgraded host before connecting it:

```js
import '@rightxt/tracker-element/register';
import '@rightxt/tracker-element/style.css';

const tracker = document.createElement('rxt-tracker');
tracker.replaceConfiguration({
  options: { placement: 'right', a11y: { enabled: true, keyboard: true } },
  rules: [{ selector: 'h2', label: (element) => element.textContent }],
});
document.body.append(tracker);

// On view removal: tracker.remove();
// Re-appending the host later creates a fresh runtime with the stored configuration.
```

There is no host `destroy()` call. Removing/disconnecting the host retires its current runtime; the host itself remains reusable. You can also declare `<rxt-tracker></rxt-tracker>` in markup and configure the upgraded element through the same JS methods.

## Configuration model

**There are zero observed/configuration attributes.** Options/rules are not JSON attributes, root-selector attributes, or declarative child rules. There is no options/rules property channel or attribute/property precedence model. Ordinary host id/class/hidden/aria/data attributes retain their DOM meaning; generated `.rxtt` service attributes are output, not host configuration.

Configure behavior with `replaceOptions()`, `patchOptions()`, `replaceRules()`, or `replaceConfiguration()`. Functions, DOM roots, rule objects, and diagnostics sinks remain normal JavaScript values. A disconnected host starts with default options and an empty rules list, and has no runtime or owned root.

### Root properties

These are mount context, not option leaves:

| Property     | Values                                                 | Meaning                                                                                    |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `sourceRoot` | Document, Element, open ShadowRoot, undefined, or null | Undefined selects the current mode's default source; null intentionally prevents mounting. |
| `scrollRoot` | Window, HTMLElement, undefined, or null                | Undefined selects page/window mode; null intentionally prevents mounting.                  |

A connected host may own a `.rxtt` and a live unmounted runtime while either property is null. Setting valid roots or undefined can mount it again. With a current runtime, root setters can preflight and throw synchronously; accepted changes transactionally remount the same integration, restoring prior value/mount on a rejected update according to that transaction.

Disconnected assignments are stored without runtime mount validation. A foreign or otherwise invalid identity therefore need not throw at assignment: validation can fail later on connection and use lifecycle diagnostic reporting. If initial connection failed and left no runtime, correcting roots on the still-connected host can establish a fresh runtime. The [connected lifecycle](#connected-lifecycle-and-configuration-settlement) explains the different failure boundaries.

## Configuration

All **36 option leaves** below are accepted through JavaScript methods; `TrackerElementOptions` is the full shared options surface with no Element-only leaves. Every field is optional. Root properties above are not options and have their own null/undefined semantics.

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

### Applying option changes

Normal changes are strict and atomic. Any validation diagnostic, including a warning, rejects the candidate without partial acceptance. Known own undefined values and unknown configuration fields reject. Omit a field to use replacement defaults or patch inheritance; null is supported only by its specific field contract. Root-property null/undefined behavior is separate.

`replaceOptions(options, params?)` resolves omitted fields from defaults and preserves rules. `patchOptions(options, params?)` deep-merges from stored committed options. `replaceConfiguration({ options, rules }, params?)` requires both own channels and replaces them atomically. Disconnected methods validate/store values for the next connection. Connected methods use coordinated configuration replacement and normally flush pending Projection work before returning; `{ render: false }` stores/commits without requesting/flushing that visual work. Accepted reentrant calls may defer, with call-time validation still applied. See [configuration settlement](#connected-lifecycle-and-configuration-settlement).

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

### Replacing the rule list

Rules start empty. Supply a complete array through `replaceRules(rules, params?)` or the rules channel of `replaceConfiguration()`. Pass `[]` to clear it. There is no rules property/attribute, JSON channel, child-rule syntax, `addRule()`, `removeRuleByIndex()`, or `removeRuleBySelector()` on Element.

Connected replacements use the same default flush or `{ render: false }` behavior as options; disconnected replacements store the list for the next runtime generation. Function-valued labels/targets retain their JavaScript identity. For incremental application edits, build the desired complete list and replace it.

## Connected lifecycle and configuration settlement

### Connection, root changes, and disconnection

| Host/runtime condition              | Behavior                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disconnected                        | No runtime or owned `.rxtt`; options/rules/root values are stored. getOptions/getRules remain available; getStats returns null.                            |
| Successful connection               | Creates owned Light DOM root and a fresh Projection integration; mounts and performs initial synchronization unless either root property is null.          |
| Connected with a null root property | Keeps a live unmounted integration and owned root. A valid/undefined root can mount that same integration later.                                           |
| Connected root change               | Preflight/transactionally unmount and remount the same current integration, rather than creating a fresh one.                                              |
| Disconnect                          | Destroys the current integration, removes owned root/render state, and preserves package-owned configuration, roots, and host DOM listeners.               |
| Reconnect after disconnect          | Creates a fresh Core integration and owned root, using stored values; generation-scoped stats/selection reset and marker-key continuity is not guaranteed. |

DOM connection/disconnection drives `connectedCallback()` and `disconnectedCallback()`; callers should not invoke them. There is no public mount/unmount, host destroy/dispose, or terminal host state. Disconnect is reversible at host level even though its runtime generation is terminally destroyed. A destroy CustomEvent describes that retired generation and does not prevent reconnection.

Connection/mount failure is contained by the browser lifecycle boundary: rollback/root cleanup is attempted and `element-lifecycle-error` is reported through diagnostics output or fallback console. Do not expect the DOM append caller to receive the original synchronous Core mount exception.

### Connected configuration timing

An accepted mutation validates/captures values, enters adapter/Core coordination, stores package-owned configuration, replaces the current Projection configuration, and flushes pending render work when mounted unless `params.render === false`. The normal uncontended connected call therefore returns after required pending Projection work has been flushed, which is different from merely scheduling an update. It is not a browser paint guarantee.

With `{ render: false }`, required work remains dirty for later manual synchronization. With no runtime, validated configuration is stored for the next generation. Public-event reentrant changes may queue until the active operation exits; an immediate void return is not proof that deferred work already completed. Invalid call-time values can still throw before acceptance.

### Adoption

Connected `adoptedCallback()` remounts the **same current Projection integration** against the moved root in the destination ownerDocument: unmount the old mount generation, then mount in the destination realm. Only omitted roots use destination defaults; explicit sourceRoot/scrollRoot properties persist and must be valid there. Adoption failure is lifecycle-reported and leaves that integration unmounted until corrected.

This connected-adoption path differs from actual disconnect/reconnect. Use browser lifecycle naturally; do not call callbacks as consumer APIs.

## Events

Listen on the host with native `addEventListener()` / `removeEventListener()`. All eight adapter-dispatched CustomEvents have **bubbles: false, composed: false, cancelable: false**; observe the host itself, not document/ancestor delegation. `event.detail` is the unchanged semantic payload.

| CustomEvent        | Trigger / detail                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marker:activate`  | After marker scroll/focus attempts: key, source element, ruleIndex, selector, nullable label and sourceEvent.                                                         |
| `cluster:activate` | After primary-marker navigation: key, count, member descriptors, nullable primaryMarker and sourceEvent. Members contain marker key/element/ruleIndex/selector/label. |
| `track:activate`   | After discrete track scrolling: nullable percentage position and sourceEvent. Drag movement is excluded.                                                              |
| `selection:change` | Committed logical transition: nullable previousKey and selectedKey, distinct from browser focus.                                                                      |
| `sync:start`       | Core synchronization starts: reason, scheduled flag, nullable timestamp. Initial mount notifications are staged.                                                      |
| `sync:end`         | Successful synchronization: markersCount, clustersCount, nullable duration and timestamp; no paint guarantee.                                                         |
| `warning`          | After warning stats/output: code, message, open nullable details.                                                                                                     |
| `destroy`          | One retired runtime generation after terminal cleanup attempts; frozen empty detail. Host remains reconnectable.                                                      |

```js
function onMarkerActivate(event) {
  console.log(event.detail.selector, event.detail.key);
}
tracker.addEventListener('marker:activate', onMarkerActivate);
// Later: tracker.removeEventListener('marker:activate', onMarkerActivate);
```

Delivery is synchronous. Activation behavior already happened before the outer event, so return values or outer `preventDefault()` cannot cancel it. Sync events describe Core synchronization rather than browser paint. There is no generic error, mount, or unmount event. Typed EventTarget overloads narrow detail by event name; the package does not expose a separate event-map type import.

DOM EventTarget owns duplicate identity/capture, once, AbortSignal, and removal behavior. There is no Vanilla-style registration-owner layer. Consumer listener exceptions follow the browser error channel and are not converted by Element into Core handler diagnostic stats; returned Promises are not awaited. Catch asynchronous listener work explicitly.

Tracker-owned payload containers are frozen, while source Elements and native Events are borrowed. Warning details is an open borrowed graph, not a frozen/sanitized retained copy. Host listeners survive disconnect/reconnect. A deferred destroy notification from a retired generation still describes only that generation, even if a replacement is already connected. See the [Element events example](https://rightxt.github.io/tracker/scenarios/events/element/).

## Imperative and read state

The ten adapter methods below are distinct from the two root properties and native EventTarget operations:

| Method                                              | Meaning / lifecycle / return                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `getOptions()`                                      | Complete immutable committed options, including before first connection; stored configuration survives disconnect.                    |
| `getRules()`                                        | Detached readonly ordered rule list, available disconnected; callbacks and rule suppressions are preserved.                           |
| `replaceOptions(options, params?)`                  | `void`; replace options from defaults while preserving rules; available disconnected/connected.                                       |
| `patchOptions(options, params?)`                    | `void`; deep patch from committed options; available disconnected/connected.                                                          |
| `replaceRules(rules, params?)`                      | `void`; complete ordered list replacement; available disconnected/connected.                                                          |
| `replaceConfiguration({ options, rules }, params?)` | `void`; both own channels required for atomic replacement; available disconnected/connected.                                          |
| `render()`                                          | `void`; immediate full synchronization, requiring an existing mounted runtime. Disconnected and connected-but-unmounted calls reject. |
| `requestRender()`                                   | `void`; scheduled/coalesced full synchronization with the same mounted requirement.                                                   |
| `getStats()`                                        | Detached current runtime stats while a runtime exists, including connected-but-unmounted state; null disconnected.                    |
| `resetStats()`                                      | `void`; resets the current runtime's counters/diagnostics/last render without a render request; no-op when disconnected.              |

The four mutation methods accept `params.render`, defaulting to true, with the connected flush/disconnected storage behavior described above. These methods do not accept constructor-style partial configuration in place of a complete replacement envelope.

The public root properties are sourceRoot and scrollRoot. `addEventListener()` and `removeEventListener()` are the class's two typed EventTarget overrides, retaining native semantics. The three browser-owned lifecycle callbacks are connectedCallback, disconnectedCallback, and adoptedCallback; they are not normal consumer control methods. No configuration attributes are observed, and there is no attributeChangedCallback configuration surface.

There is no snapshot read/subscription, host terminal destroy/dispose, current-root getter intended as adapter API, lifecycle state facade, or exposed Core Projection integration. Element does not expose `getSnapshot()`, `subscribeSnapshot()`, `getTrackerDebugTrace()`, `flushRender()`, or incremental rule methods.

Stats contain render/rule/marker/cluster/observer counters, warning/error totals and last entries, last-render timing, and optional debug data. Standalone stats clones are detached and not frozen. Counters update independently of diagnostics.metrics; the flag gates timing. Reset clears counters, including current counts, without clearing configuration or rendered records. Disconnect discards generation-scoped stats; reconnect starts fresh. The [runtime diagnostics reference](https://rightxt.github.io/tracker/docs/reference/core-runtime/#stats) explains the underlying stats shape; its snapshot/trace APIs are not Element APIs.

## Environments

### Page and element containers

The host ownerDocument and its owned Projection root select the active realm. Omitted scrollRoot uses page/window mode; active-document body/documentElement/scrollingElement aliases also select page scrolling. An omitted sourceRoot uses the body in window mode or the scroll element in element mode. Source queries match descendants for an Element root, not the source itself.

For a supported HTMLElement scroll container, set same-document roots before connecting to avoid intermediate remounts:

```js
// tracker is defined/upgraded and currently disconnected.
tracker.scrollRoot = document.querySelector('.scroller');
tracker.sourceRoot = tracker.scrollRoot;
document.querySelector('.tracker-overlay').append(tracker);
```

The scroll element must satisfy the supported geometry/CSS profile. The host's physical output location is application-controlled; source/scroll properties do not relocate it. One runtime represents one authoritative scroll range. See [environments](https://rightxt.github.io/tracker/docs/guides/environments/) for the full profile and containment rules.

### Shadow DOM

An explicit open ShadowRoot can be the source scope. Separately, the host itself can live inside a user-managed ShadowRoot. Output always remains a Light DOM `.rxtt` child of `<rxt-tracker>`; the adapter creates no own ShadowRoot and cannot use one as its actual render root. Install stylesheet/theme in the scope containing that output. Choosing a shadow source does not move the host or cross nested shadow boundaries automatically. See [Element Shadow DOM](https://rightxt.github.io/tracker/scenarios/shadow-dom-element/).

### Same-origin iframe and adoption

A parent-document `<rxt-tracker>` cannot target child-document source/scroll objects: the host/render root owns the realm. Safe child-document use requires registration and the actual host in the child document, matching child roots, and child-document CSS. There is no cross-origin bridge or mixed-document marker projection.

Navigation replaces document identities. Use appropriate fresh child objects/host lifecycle after load; old roots do not retarget automatically. Connected adoption uses the same current integration in the destination realm, with defaults only for omitted roots and revalidation of persistent explicit roots. A foreign disconnected assignment may fail only at connection, while a connected live-runtime setter can throw immediately.

## Styling

Import `@rightxt/tracker-element/style.css` before application theme CSS. JavaScript injects no stylesheet. CSS/theme must reach the actual `.rxtt` output scope, including a user ShadowRoot containing the host or an iframe document.

| Output hook       | Application configuration                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `.rxtt`           | `track.className`, root `cssVariables`.                                                                  |
| `.rxtt__viewport` | `viewport.className`, viewport theme variables.                                                          |
| `.rxtt__markers`  | `markerLayer.className`.                                                                                 |
| `.rxtt__marker`   | Global and owning/primary rule classes, attributes, title, and item variables, for markers and clusters. |

The public theme contains 33 root Tracker variables, including 17 rule-marker-compatible variables, plus valid application-owned custom properties. Global/rule classes combine; rule attributes override or suppress inherited attributes; a cluster uses its primary marker's presentation. Preserve service hooks and use configuration rather than editing generated metadata.

Data attributes describe orientation, placement, scroll mode, geometry, item kind/count/key/selection, and drag capability. `data-rxtt-drag="true"` indicates capability enabled, not a current drag session. Renderer-owned keys and reserved `data-rxtt-*` attributes are not application configuration channels.

Element uses Projection root normalization: accepted root strings remain unchanged in committed/read state, while rendered root output trims nonblank strings and omits blank/whitespace-only values. Rule/item style maps are a separate output scope and must not be assumed to pass through that same root normalization. Empty output can expose the remaining CSS cascade; it is not a forced reset of inherited styles.

The [styling reference](https://rightxt.github.io/tracker/docs/reference/styling/) gives complete variable/class/attribute details. [Theme Builder source](https://rightxt.github.io/tracker/tools/theme-builder/) opens the tool's repository entry for editing/previewing themes and exporting application overrides. Tool output supplements canonical CSS; the styling reference defines the contract.

## Debug and diagnostics

Root ESM and `/register` compose neutral external Core resolution. Enable Core's `development` condition consistently for debug instrumentation; there is no Element `/debug` ESM entry. For standalone use, choose `rxt-tracker-element.js` or `rxt-tracker-element.debug.js`. Both auto-register and expose `window.RXTTrackerElement`; do not load independent constructors for the same default tag in one registry.

While a debug-capable runtime exists, `getStats()` can include a debug branch. Advanced trace is not exposed: the host is not the private Core integration required by `getTrackerDebugTrace()`. Disconnected stats remain null even when the selected build supports debug.

`diagnostics.output` accepts independent optional warn/error callbacks receiving code, message, and optional details. Null clears the caller-owned sink. Runtime warnings update stats, use the configured warn method or console fallback, then dispatch the warning CustomEvent. **diagnostics.warnings controls only fallback console.warn**; output.warn, warning stats/events, and runtime errors remain active. A configured error method replaces runtime console.error fallback for that severity. Runtime sink failures are contained; the sink is not disposed by the adapter/runtime.

Retained runtime diagnostic metadata is sanitized; immediate sink/event details can contain borrowed live objects. Strict validation diagnostics, runtime warning/error output, and thrown exceptions are separate channels. Native TypeError/AggregateError and TrackerConfigurationError/TrackerLifecycleError with stable codes may propagate from imperative methods or connected setters. Core error classes are not re-exported by this package. No generic error CustomEvent exists.

Browser lifecycle reactions have a different boundary: connection/adoption/remount failures are contained and reported as `element-lifecycle-error` through configured output.error or fallback console.error, after attempted rollback/cleanup. Do not rely on append/adoption callers receiving the Core mount exception. Disconnected root assignments can defer validation to that lifecycle path; connected setters can instead preflight and throw to their caller. DOM listener exceptions remain browser EventTarget failures and do not become Core handler-error stats.

## Demos and further documentation

These absolute repository links open current source materials and public guides:

- [Element playground](https://rightxt.github.io/tracker/playgrounds/element/) — registration, JS configuration, and connected behavior.
- [Element Shadow DOM](https://rightxt.github.io/tracker/scenarios/shadow-dom-element/) and [Element events](https://rightxt.github.io/tracker/scenarios/events/element/).
- [Environments](https://rightxt.github.io/tracker/docs/guides/environments/) — containers, shadow scopes, and document identity.
- [Updates and refresh](https://rightxt.github.io/tracker/docs/guides/updates-and-refresh/) — four automatic sources and manual synchronization. CSS/CSSOM-only changes may require render/requestRender; disabling relevant sources leaves external changes to the caller. Resize targets affect ResizeObserver, not Window resize.
- [Rules and marker behavior](https://rightxt.github.io/tracker/docs/guides/rules-and-marker-behavior/) and [styling reference](https://rightxt.github.io/tracker/docs/reference/styling/).
