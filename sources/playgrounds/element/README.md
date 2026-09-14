# Element playground

## Purpose

Run the shared deterministic workbench through the registered `@rightxt/tracker-element` Custom Element.

## Where to start

Read `src/main.js`. It imports `/register`, creates the actual `<rxt-tracker>` element, assigns the DOM-reference `sourceRoot` property, commits complete options and rules with `replaceConfiguration()`, and only then connects it to avoid a default-configuration runtime cycle. It calls `render()` and `requestRender()` and consumes native `CustomEvent.detail` payloads.

The materialized `src/playground/workbench.js` is framework-neutral demo infrastructure. Its bridge names are not Custom Element APIs.

This playground uses Tracker's `development` package condition for debug diagnostics. Applications should use the default production export unless they need the debug build. Vite's condition does not imply a non-production application bundle.

## Build

```sh
npm install
npm run build
```
