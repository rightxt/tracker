# Runtime events — Element

The fixture starts without a custom element. Use **Create element**, **Connect**, **Disconnect**, and **Discard** to distinguish one HTMLElement lifetime from its Core runtime generations. Disconnect destroys the current generation but preserves the detached element and its DOM listeners; reconnect creates the next generation. Discard is available only while detached.

Native listeners receive real CustomEvents through `event.detail`. The chronological timeline records element-object and per-element runtime-generation boundaries. Disconnect publishes the real `destroy` event; Element has no separate completion primitive, so the demo does not invent one. Scroll-only synchronization is aggregated separately, while mixed transactions remain detailed.

Each consumer-failure button arms the next `sync:end` DOM listener and immediately calls `tracker.render()`. The listener throws or returns a rejected Promise without navigation; the application error channel receives it and Tracker diagnostics remain unchanged. The warning is one-shot and automatically restored. The binding experiment exercises native listener identity, removal, and `AbortSignal` across reconnects.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build. The public calls remain visible in `src/main.js`.

## Build

```sh
npm install
npm run build
```
