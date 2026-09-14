# Runtime events — Vanilla

The fixture starts without a `Tracker`. Use **Create Tracker**, **Mount**, **Unmount**, and **Destroy** to observe the real object lifecycle. `tracker.on()` delivers all eight public events. Temporary `unmount()` preserves the same object and subscriptions; `destroy` is terminal and `whenDestroyed()` resolves after cleanup.

The chronological timeline distinguishes Tracker instances, reusable mount cycles, application lifecycle calls, real events, and `whenDestroyed()` completion. Scroll-only synchronization is aggregated separately; mixed scroll/non-scroll transactions remain detailed. The observer warning is real and one-shot, with automatic restoration.

Each consumer-failure button arms the next `tracker.on('sync:end', handler)` delivery and immediately calls `tracker.render()`. The handler throws or returns a rejected Promise without marker navigation; the host error channel receives it, Tracker remains usable, and `stats.errors.total` does not change. The binding experiment demonstrates callback identity, reference-counted owners, unsubscribe, and `off()`.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build. The public calls remain visible in `src/main.js`.

## Build

```sh
npm install
npm run build
```
