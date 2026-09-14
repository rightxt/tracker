# Vanilla playground

## Purpose

Run the shared deterministic workbench through the imperative `@rightxt/tracker-vanilla` API.

## Where to start

Read `src/main.js`. It constructs one `Tracker`, commits the complete initial options and rules with `replaceConfiguration()`, then mounts it with `sourceRoot`. It uses `render()` and `requestRender()`, subscribes with `on()`, reads and resets stats, and destroys the instance on page teardown.

The materialized `src/playground/workbench.js` is framework-neutral demo infrastructure. It owns and preflights complete candidates; its bridge operation names are not package APIs.

This playground uses Tracker's `development` package condition for debug diagnostics. Applications should use the default production export unless they need the debug build. Vite's condition does not imply a non-production application bundle.

## Build

```sh
npm install
npm run build
```
