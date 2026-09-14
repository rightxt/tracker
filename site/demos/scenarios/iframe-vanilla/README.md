# Iframe document context

This scenario demonstrates one parent-created Vanilla Tracker operating entirely inside successive loaded same-origin iframe document contexts.

## Parent-owned Tracker, child-owned runtime context

The parent application constructs one Tracker and owns its public event subscription. Each mounted runtime instead queries, measures, observes, renders, and scrolls in the current child document. No Tracker is constructed by the child bundle.

## The three mount identities

### `sourceRoot`

Scopes source-element queries and default mutation observation. Here it is the child document's connected `#tracked-content` element.

### `scrollRoot`

Defines the represented scrolling context used for geometry and built-in navigation. Here it is the current child `Window` exposed by the iframe browsing context.

### `renderHost`

Receives Tracker-rendered DOM. Here it is the child `document.body`, structurally distinct from `sourceRoot`.

All three identities belong to one consistent active realm.

## Same-realm requirement

A mounted runtime cannot mix parent and child DOM identities. Core rejects inconsistent mount identities with `ERR_TRACKER_REALM_MISMATCH`.

## Styling belongs to the child document

CSS does not cross iframe document boundaries. Because Tracker renders its rail into the child document, `src/child.js` imports `@rightxt/tracker-vanilla/style.css` in the child bundle. Parent-page CSS cannot style that rail.

## Marker activation and child scrolling

The rule uses deterministic built-in scrolling against the child Window. Activating a lower child marker changes the iframe scroll position without scrolling the parent page. The retained parent-side `marker:activate` subscription reports the public label and selector and checks that the payload element belongs to the current child document; it does not reproduce navigation itself.

## Navigation lifecycle

Iframe navigation replaces the active child `Document` and its global realm state. The iframe's `contentWindow` is exposed through the browser's browsing-context `WindowProxy`, so applications should reason about the current loaded document context rather than use Window object inequality as a generation identifier.

A reusable Vanilla Tracker is unmounted from the old context before navigation and mounted again only after the replacement document loads:

```text
same parent Tracker object
→ unmount old child context
→ navigate iframe
→ load replacement child document
→ mount same Tracker into new child context
```

`unmount()` is reusable; `destroy()` remains terminal and is used only during final parent-page cleanup. Demo-owned generation numbers make document replacement visible but are not part of the Tracker API.

## Same-origin requirement

Parent-side access to the child `Document` and `Window` requires a loaded same-origin iframe. Cross-origin frames cannot use this direct DOM mounting pattern and are outside this scenario's scope.

## Integration scope

This parent-to-child mounting pattern is a Vanilla Tracker capability. React, Vue, Angular, and Custom Element integrations should run their host and targets inside the iframe document rather than acting as parent-side DOM adapters.

## What to try

Activate the lower child markers and compare parent and child scrolling. Add a dynamic target and observe the child rail gain one marker asynchronously. Navigate the iframe and inspect the persistent lifecycle log, then repeat activation and mutation in the replacement child document.

## Debug profile

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

The scenario does not expose a diagnostics dashboard; its debug profile comes from the repository's scenario category.

## Install

`npm install`

## Build

`npm run build`

## Important files

- `package.json`
- `index.html`
- `child.html`
- `src/parent.js`
- `src/child.js`
- `src/styles.css`
- `src/child.css`
