# Runtime events — React

The React root exists at page load, but no `<Tracker>` is mounted. Controls explicitly mount and unmount component lifetimes. Seven non-destroy events arrive through callback props. Before unmount, the scenario retains `ref.current` and awaits `whenRuntimeDestroyed()`; React exposes no destroy callback prop and no imperative subscription experiment.

The chronological timeline separates lifecycle, real events, and Promise completion. Scroll-only synchronization is aggregated separately; mixed scroll/non-scroll transactions remain detailed. The real observer warning is restored automatically.

Each failure action arms the next `onSyncEnd` callback and immediately calls `ref.current.refresh()`. The callback throws or creates a rejected Promise without marker navigation. The failure remains application-owned, the runtime stays usable, and Tracker diagnostic error stats do not change.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build. Props and retained-handle teardown remain visible in `src/main.jsx`.

## Build

```sh
npm install
npm run build
```
