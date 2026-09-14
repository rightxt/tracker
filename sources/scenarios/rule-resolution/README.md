# Rule resolution

This scenario traces how ordered public rules turn matching DOM elements into owned marker behavior.

## Resolution pipeline

The mounted source is queried with selectors in rule order. The owning rule resolves a label during synchronization and creates one marker. During marker activation, Core resolves and performs scrolling, resolves and performs focus, and then publishes `marker:activate` for application-owned reactions.

## First matching rule owns an element

Rule order is priority order. If an element matches multiple selectors, the first matching rule owns that element.

The priority card matches `.rule-card[data-priority="high"]` and `.rule-card`, but Rule 0 owns it and creates exactly one marker. Rules are not merged, and a source does not create one marker per matching rule. Ownership determines the public `selector`, `ruleIndex`, label, scroll behavior, and focus behavior.

## Label resolution

`label(element)` is evaluated while Tracker rebuilds marker records during synchronization. It may run again during later synchronizations, so it should stay synchronous, side-effect free, and inexpensive.

Use **Rename a normal item** to change a heading through `textContent`. Default mutation observation synchronizes the existing rules and recomputes the fallback marker label without an explicit `render()`.

## Activation target resolution

Function-valued `scroll.target` and `focus.target` options are resolved during marker activation. They can therefore read the current DOM and current external application state. Each card supplies a nested header as its scroll destination and two nested buttons as possible focus destinations.

Changing the focus-mode radio updates application state only. The next activation reads that state without replacing rules, patching options, or rebuilding markers first.

## Resolver timing

`label(element)` runs during synchronization. The scroll and focus target resolvers run later, when a marker is activated. Current Core ordering is:

```text
resolve and perform scroll
→ resolve and perform focus
→ publish marker:activate
```

## Resolver purity

Resolver functions are synchronous computations, not lifecycle callbacks. They may read a matched element, query its descendants, read external application state, and return a value synchronously. They should not mutate Tracker configuration, trigger rendering, change application DOM as a side effect, or start asynchronous work.

## Application reaction after marker:activate

The single public event listener adds the application-owned `.is-active` state and updates the visible payload report outside `sourceRoot`. That report shows the source title, owning selector, rule index, resolved label, and confirms that focus completed before the callback ran.

## What to try

Activate the priority and normal markers and compare their payloads. Rename the normal item and observe its marker label. Switch between primary and secondary focus modes, then activate the same marker again. The nested card header should be centered and the selected nested action should receive focus.

## Debug profile

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

The scenario does not add a diagnostics dashboard; the debug profile is inherited from the repository's scenario category.

## Install

`npm install`

## Build

`npm run build`

## Important files

- `package.json`
- `index.html`
- `src/main.js`
- `src/styles.css`

The Tracker uses the public Vanilla package, mounts directly on the static six-card fixture, keeps clustering disabled, and relies on the normal update configuration.
