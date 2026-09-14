# Runtime events — Vue

The Vue application exists at page load, but its Tracker subtree is absent. Controls explicitly mount and unmount subtree lifetimes. Seven non-destroy events arrive through Vue listeners. Before unmount, the exposed handle is retained and `whenRuntimeDestroyed()` is awaited; Vue exposes no destroy emit and no imperative subscription experiment.

The chronological timeline separates lifecycle, real events, and Promise completion. Scroll-only synchronization is aggregated separately; mixed transactions remain detailed. The real observer warning is restored automatically.

The source uses render-function listener props such as `onSyncEnd`; their template equivalents are `@sync-end`. Each failure action immediately calls the exposed `refresh()` method and makes that real listener throw or reject. Vue owns listener error handling, the runtime remains usable, and Tracker error stats do not change.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build. VNode listener bindings and teardown remain visible in `src/main.js`.

## Build

```sh
npm install
npm run build
```
