# Styling contract

This scenario compares four supported ways to produce the same Tracker design, then applies two deliberately unconventional themes to the same page headings. All six instances use documented public Vanilla styling hooks.

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## Build

```sh
npm install
npm run build
```

## What to compare

Scroll the four local regions independently. Their content, target order, geometry, clustering, keyboard behavior, and final visual theme are equivalent. Compare `src/main.js` and `src/styles.css` to see where each case supplies the theme.

The two page-level rails represent the same four comparison headings but intentionally look very different.

## Same design, different mechanisms

| Case                 | Primary mechanism                                     | Typical use                                                 |
| -------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| CSS cascade          | Ancestor public custom properties                     | Static themes and application design systems                |
| JavaScript variables | `options.cssVariables`, rule marker variables         | Runtime- or configuration-driven themes                     |
| Public class hooks   | Configured classes plus application CSS               | Complex selectors, pseudo-classes, and stylesheet ownership |
| Selector hooks       | Marker attributes plus public service-state selectors | Semantic and state-specific styling                         |

### CSS cascade

The comparison card defines documented `--rxtt-*` properties. Because the local render host is inside that card, the Tracker rail inherits them through the normal CSS cascade. Small rule classes supply warning and error variants because source-element ancestry is not copied into the rendered rail.

### JavaScript CSS variables

The same values are explicit in `options.cssVariables`; warning and error colors use `rule.marker.cssVariables`. This is appropriate when theme values originate in runtime configuration or JavaScript state.

### Public class hooks

`track.className`, `viewport.className`, `marker.className`, and rule marker classes provide stable application hooks. Ordinary CSS applies the same track, viewport, marker, cluster, warning, and error presentation.

### Selector and attribute hooks

Global and rule marker attributes identify the theme and semantic tone. Application CSS combines those attributes with documented `data-rxtt-kind` and `data-rxtt-selected` states. Track and viewport classes remain necessary because marker attributes apply only to marker and cluster items; this case is selector-oriented, not “attributes only.”

All four cases use the public selected-state attribute as a small shared secondary hook. Artificial mechanism purity would make the examples less representative of real application CSS.

## Attribute precedence and deletion

The selector case preserves the complete attribute contract:

1. global `data-attribute-scope="global"` is the default;
2. the error rule overrides it with `"error-rule"`;
3. the warning rule uses `null` to suppress it;
4. `patchOptions()` uses global `null` to delete `data-obsolete-style-hook` after mount.

Tracker-owned `data-rxtt-*` attributes are independent service state and cannot be replaced through marker attributes.

## Unconventional page-level themes

### Minimal ruler

The left rail uses public classes and custom properties for a thin monochrome track, fine markers, a restrained viewport, and a stronger selected item.

### Neon rail

The right rail uses public classes for gradients, pseudo-elements, transforms, and glow. Its outward effects opt out of default clipping with the documented `--rxtt-track-contain: none` and `--rxtt-track-overflow: visible` properties.

Both page-level instances use `document.body` as their source boundary, the same heading rule, and the window scroll coordinate space. They span the complete page while the narrow rule deliberately excludes targets inside the nested scrollers.

## Public styling contract

This scenario uses only:

- documented public `--rxtt-*` custom properties;
- configured track, viewport, marker, and rule marker classes;
- application-owned marker attributes;
- documented service classes and service-state attributes;
- ordinary application CSS loaded after `@rightxt/tracker-vanilla/style.css`.

The standard Light DOM service classes and service-state attributes are renderer output, but they are documented selector hooks. Application classes and attributes must be supplied through configuration rather than manually added to generated nodes.

## What not to style

`--rxtt-viewport-start`, `--rxtt-viewport-size`, `--rxtt-marker-start`, and `--rxtt-marker-size` are renderer-owned geometry output. The scenario intentionally reads none of them as theme inputs and never overrides them.

It also avoids `!important`, private DOM nesting, manual mutation of generated Tracker nodes, undocumented classes or attributes, and the renderer identity in `data-rxtt-key`.

## Important files

- `src/main.js` keeps the four public API configurations next to one another and owns all six Tracker lifecycles.
- `src/styles.css` contains the cascade, class, attribute, ruler, and neon themes.
- `index.html` contains the comparison cards and the one canonical fixture `<template>`.
- `package.json` remains a minimal standalone Vanilla consumer project.
- `vite.config.js` selects the development package condition required by Scenario policy.
