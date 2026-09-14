# CDN

CDN distribution is available for the standalone Vanilla and Element browser builds. Both are served directly from the published npm packages through jsDelivr and UNPKG; no separate CDN publish step exists. Core and the framework adapters (React, Vue, Angular) have no standalone bundle and no CDN contract — use your package manager and bundler for those.

Each link is pinned to the current Tracker version and points at an explicit production artifact. Avoid `latest` or package-root resolution: pin the version so a future release cannot silently change what loads.

## Vanilla

| CDN      | JavaScript                                                                                              | CSS                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| jsDelivr | `https://cdn.jsdelivr.net/npm/@rightxt/tracker-vanilla@{{TRACKER_VERSION}}/dist/rxt-tracker-vanilla.js` | `https://cdn.jsdelivr.net/npm/@rightxt/tracker-vanilla@{{TRACKER_VERSION}}/dist/rxt-tracker.css` |
| UNPKG    | `https://unpkg.com/@rightxt/tracker-vanilla@{{TRACKER_VERSION}}/dist/rxt-tracker-vanilla.js`            | `https://unpkg.com/@rightxt/tracker-vanilla@{{TRACKER_VERSION}}/dist/rxt-tracker.css`            |

## Element

| CDN      | JavaScript                                                                                              | CSS                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| jsDelivr | `https://cdn.jsdelivr.net/npm/@rightxt/tracker-element@{{TRACKER_VERSION}}/dist/rxt-tracker-element.js` | `https://cdn.jsdelivr.net/npm/@rightxt/tracker-element@{{TRACKER_VERSION}}/dist/rxt-tracker.css` |
| UNPKG    | `https://unpkg.com/@rightxt/tracker-element@{{TRACKER_VERSION}}/dist/rxt-tracker-element.js`            | `https://unpkg.com/@rightxt/tracker-element@{{TRACKER_VERSION}}/dist/rxt-tracker.css`            |

These are the production builds. See each package's README for the corresponding debug standalone artifact when loading it from your own hosted assets.
