# Long document recipe

This recipe shows how Vanilla Tracker can navigate a realistic long report without taking ownership of the document or its controls. The large static GAO report, tables, figures, footnotes, and local images are intentional: they exercise the same kinds of targets found in a real reading experience.

## Build

```sh
npm install
npm run build
```

No Vite configuration is required. The project imports only the public `@rightxt/tracker-vanilla` package and its stylesheet.

## What to try

- Enable and disable title, section, table, and figure navigation.
- Search for a phrase of at least five characters.
- Select report text and create, select, or remove an annotation.
- Resize the viewport and confirm that the rail remains usable beside the reading column.

## How Tracker is used

### Import Tracker and its stylesheet

`src/main.js` imports the Vanilla ESM entry and the required Tracker CSS export directly.

### Define document rules

Navigation rules match headings and captions. Separate permanent rules match the spans created by the recipe's search and annotation code. Clustering is disabled because headings, search results, and annotations are meaningful independent destinations and should not be merged.

### Mount Tracker with the report as `sourceRoot`

```js
tracker.mount({ sourceRoot: report });
```

Only the report subtree is tracked. The sticky controls above it intentionally remain outside Tracker's source root.

### Enable and disable rules

The Navigation buttons update an application-owned set of enabled rule IDs. `buildActiveRules()` derives the complete rule list, and `tracker.replaceRules(...)` replaces Tracker's active rules. This changes markers; it does not hide or modify report content.

### Re-render after application DOM changes

Search and annotation operations use ordinary DOM APIs to add or remove spans. Tracker neither searches text nor creates annotations. The integration sequence is explicit in `src/main.js`:

```text
application mutates DOM
→ elements begin or stop matching Tracker rules
→ tracker.render()
→ markers are updated
```

### Adapt Tracker to responsive layout

The recipe calls `patchOptions()` when media queries change so the rail fits the available gutter. `matchMedia` and `ResizeObserver` are application-specific layout code, not requirements for a minimal Tracker integration. The observer also keeps marker scrolling clear of the sticky controls.

### Destroy Tracker

The `pagehide` cleanup removes media-query listeners, disconnects the layout observer, and calls `tracker.destroy()`.

## What is application code

`src/search.js` finds literal text matches and wraps them in `.report-search-hit` spans. `src/annotations.js` reads the browser selection and creates or removes `.report-annotation` spans. Tracker only renders markers for those elements through normal selector rules.

## Project structure

- `index.html` — controls followed by the static report fixture.
- `src/main.js` — visible Tracker configuration, lifecycle, and application orchestration.
- `src/search.js` — Tracker-independent text search DOM operations.
- `src/annotations.js` — Tracker-independent selection and annotation DOM operations.
- `src/styles.css` — page, controls, report, and marker presentation.
- `assets/` — local report images.

## Document fixture

Most of `index.html` is deliberately static report content; it does not need to be read to understand the integration. The fixture is identified in the document as the GAO 2026 annual report and retains its own attribution text. It uses local assets and requires no runtime API or `fetch()` request.
