# Runtime events — Angular

The Angular application exists at page load, but template control flow has not created Tracker. Controls create and remove explicit component lifetimes. Seven non-destroy events arrive through Angular outputs. Before removal, the queried component is retained and `whenRuntimeDestroyed()` is awaited; Angular exposes no destroy output and no imperative subscription experiment.

The chronological timeline separates lifecycle, real events, and Promise completion. Scroll-only synchronization is aggregated separately; mixed transactions remain detailed. The real observer warning is restored automatically.

Each failure action immediately calls the queried component's `refresh()` method and makes the real `(syncEnd)` output subscriber throw or reject. Angular's output/application error semantics remain visible, the runtime stays usable, and Tracker error stats do not change. Visible source labels use the actual camel-cased output names.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build. Template bindings, signals, and retained-component teardown remain visible in `src/main.ts`.

## Build

```sh
npm install
npm run build
```
