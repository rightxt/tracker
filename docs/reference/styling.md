# Styling

Tracker's styling contract combines a canonical stylesheet, public CSS custom properties, service classes, state attributes, and application-owned presentation. This reference covers the shared visual contract; use the [README for your package](../../README.md) for its configuration API.

## Load the stylesheet

Every package publishes `./style.css`. JavaScript does not inject the canonical CSS. Import the stylesheet matching the integration you use, then load application overrides:

```js
import '@rightxt/tracker-vanilla/style.css';
```

The corresponding paths are `@rightxt/tracker-core/style.css`, `@rightxt/tracker-element/style.css`, `@rightxt/tracker-react/style.css`, `@rightxt/tracker-vue/style.css`, and `@rightxt/tracker-angular/style.css`. Use the relevant one; importing all package copies is unnecessary.

CSS must reach the actual `.rxtt` tree. Child iframes need their own stylesheet. User ShadowRoots need styles in that shadow scope. CSS Modules need selectors exposed globally to reach the service classes; Vue scoped styles need an appropriate global/deep scope, and Angular view encapsulation must not prevent application selectors from reaching the rendered rail. For document Light DOM, use a document-level global stylesheet.

## Styling model

The canonical structure is a root `.rxtt`, with direct `.rxtt__viewport` and `.rxtt__markers` children; items are direct `.rxtt__marker` children of the marker layer. Direct-child selectors matter for renderer authors reusing the stylesheet. Adding these class names to unrelated nested lookalikes is not a substitute for the render contract.

Use root `options.cssVariables` for instance theme values, rule `marker.cssVariables` for item overrides, and application classes/attributes with ordinary CSS for richer states, pseudo-elements, animations, and decorations. Inline configured variables participate in the normal CSS cascade; an ordinary stylesheet declaration does not automatically override an inline value. Remove the configured inline entry when you want the stylesheet's value to take over.

Theme variables control presentation. Geometry remains renderer-owned: preserve the rail's relationship to its scroll context and the placement of markers/viewport when adding decoration.

## Root CSS custom properties

All 33 public Tracker variables below are accepted in the root map. “Rule” marks the 17 also accepted by `rule.marker.cssVariables`. Defaults describe canonical stylesheet fallback behavior, not necessarily explicit entries stored in an options map. Expected value categories come from the CSS properties consuming them; Tracker accepts string values rather than parsing them as CSS.

| Variable                            | Purpose and expected value                        | Canonical fallback                                      | Rule |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------------------------- | ---- |
| `--rxtt-track-thickness`            | Rail cross-axis width/height; CSS length.         | `1rem`                                                  | No   |
| `--rxtt-track-offset`               | Offset from the selected physical edge; length.   | `0px`                                                   | No   |
| `--rxtt-track-start`                | Start inset on the represented axis; length.      | `0px`                                                   | No   |
| `--rxtt-track-end`                  | End inset on the represented axis; length.        | `0px`                                                   | No   |
| `--rxtt-track-bg`                   | Track background color.                           | `rgb(248 249 250 / 1)`                                  | No   |
| `--rxtt-track-border-color`         | Track border color.                               | `rgb(108 117 125 / 1)`                                  | No   |
| `--rxtt-track-border-style`         | Track border style.                               | `solid`                                                 | No   |
| `--rxtt-track-border-width`         | Physical-edge border width; length.               | `1px`                                                   | No   |
| `--rxtt-track-z-index`              | Root stacking level.                              | `1000`                                                  | No   |
| `--rxtt-track-overflow`             | Root `overflow` behavior.                         | `hidden`                                                | No   |
| `--rxtt-track-contain`              | Root CSS containment.                             | `layout paint`                                          | No   |
| `--rxtt-viewport-bg`                | Viewport-indicator background color.              | `rgb(108 117 125 / 0.3)`                                | No   |
| `--rxtt-marker-min-size`            | Minimum visual marker thickness; length.          | `2px`                                                   | Yes  |
| `--rxtt-marker-bg`                  | Marker background color.                          | `rgb(220 53 69 / 1)`                                    | Yes  |
| `--rxtt-marker-ring-color`          | Base inset-ring color used by interaction states. | `rgb(108 117 125 / 1)`                                  | Yes  |
| `--rxtt-marker-ring-width`          | Base interaction ring width; length.              | `1px`                                                   | Yes  |
| `--rxtt-marker-border-color`        | Marker border color.                              | `rgb(108 117 125 / 1)`                                  | Yes  |
| `--rxtt-marker-border-style`        | Marker border style.                              | `solid`                                                 | Yes  |
| `--rxtt-marker-border-width`        | Marker border width; length.                      | `0`                                                     | Yes  |
| `--rxtt-marker-border-radius`       | Marker corner radius.                             | `0`                                                     | Yes  |
| `--rxtt-marker-hover-ring-color`    | Hover inset-ring color.                           | `--rxtt-marker-ring-color`, then `rgb(108 117 125 / 1)` | Yes  |
| `--rxtt-marker-hover-ring-width`    | Hover ring width.                                 | `--rxtt-marker-ring-width`, then `1px`                  | Yes  |
| `--rxtt-marker-selected-ring-color` | Keyboard-selected item inset-ring color.          | `--rxtt-marker-ring-color`, then `rgb(108 117 125 / 1)` | Yes  |
| `--rxtt-marker-selected-ring-width` | Keyboard-selected item ring width.                | `--rxtt-marker-ring-width`, then `1px`                  | Yes  |
| `--rxtt-marker-opacity`             | Marker opacity.                                   | `1`                                                     | Yes  |
| `--rxtt-cluster-bg`                 | Cluster background color.                         | `--rxtt-marker-bg`, then `rgb(220 53 69 / 1)`           | Yes  |
| `--rxtt-cluster-font-size`          | Cluster count font size.                          | `10px`                                                  | Yes  |
| `--rxtt-cluster-text-color`         | Cluster generated-content color.                  | `#fff`                                                  | Yes  |
| `--rxtt-cluster-content`            | CSS `content` token for cluster `::after`.        | `attr(data-rxtt-count)`                                 | Yes  |
| `--rxtt-focus-outline-color`        | Root focus-visible outline color.                 | `Highlight`                                             | No   |
| `--rxtt-focus-outline-width`        | Root focus outline width.                         | `2px`                                                   | No   |
| `--rxtt-focus-outline-offset`       | Root outline offset.                              | `-2px`                                                  | No   |
| `--rxtt-focus-outline-style`        | Root outline style.                               | `solid`                                                 | No   |

The cluster content value is a CSS token, not an HTML string. For example, `attr(data-rxtt-count)` shows the count; a literal word must retain the quoting required by CSS `content`.

Valid application-owned custom properties outside the reserved `--rxtt-*` namespace are also allowed. Unknown names inside that namespace are rejected rather than treated as future or arbitrary theme tokens.

### Renderer-owned geometry

`--rxtt-viewport-start`, `--rxtt-viewport-size`, `--rxtt-marker-start`, and `--rxtt-marker-size` are renderer output for proportional viewport/item placement. They are not public configuration variables and are rejected in both option scopes. Do not use them as theme inputs or overwrite them to reposition source geometry.

Core's exported `CSS_VARIABLES` convenience object is not the complete public theme inventory: it contains geometry names and omits some configurable theme names. Use the table above for theme configuration rather than deriving a schema from that export.

## Rule-marker CSS custom properties

The 17 rows marked **Yes** are exactly the supported rule-marker Tracker subset: the 13 `--rxtt-marker-*` variables and four `--rxtt-cluster-*` variables. Track, viewport, and root-focus tokens belong at root scope. A cluster uses the primary marker's rule presentation, so cluster tokens can be set through that rule.

`marker.cssVariables` is a complete per-rule map of string values, including empty or whitespace-only strings in normalized configuration. It has no `null` tombstone: replace the rule with an omitted entry to remove that rule value. Item-level values override inherited root/ancestor values. Do not infer that every adapter's item-style application is identical to Projection root chrome normalization.

Pure Core `validateRule()`/`validateRules()` helpers diagnose and remove invalid-name entries from recovered normalized rules while preserving valid entries. Normal strict Tracker mutations reject the entire candidate when diagnostics are present, rather than partially committing sanitized entries. See [Validation recovery and strict updates](../guides/rules-and-marker-behavior.md#validation-recovery-and-strict-updates).

## Service classes

| Service class     | Role                               | Application class source                                              |
| ----------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `.rxtt`           | Root track/rail.                   | `track.className`                                                     |
| `.rxtt__viewport` | Visible-viewport indicator.        | `viewport.className`                                                  |
| `.rxtt__markers`  | Marker layer.                      | `markerLayer.className`                                               |
| `.rxtt__marker`   | Individual marker or cluster item. | Global `marker.className` plus owning/primary rule `marker.className` |

Preserve service classes when adding application classes. Use application-specific class names outside Tracker's reserved service namespace. Native selectors such as `:hover`, `:focus-visible`, and `::after` remain ordinary CSS tools; incidental internal selectors are not additional stable Tracker APIs.

## Data attributes

These attributes describe standard rendered output. They are renderer-owned metadata rather than a configuration attribute channel.

| Attribute               | Location and meaning                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `data-rxtt-orientation` | Root: current `vertical` or `horizontal` physical axis.                                                           |
| `data-rxtt-placement`   | Root: current physical edge (`left`, `right`, `top`, or `bottom`).                                                |
| `data-rxtt-scroll-mode` | Root: `window` or `element` when mounted.                                                                         |
| `data-rxtt-geometry`    | Root: `available`, `suspended`, or `unavailable`; canonical CSS hides suspended/unavailable visual output.        |
| `data-rxtt-drag`        | Root: present as `"true"` when drag capability is enabled. It does not indicate a currently active drag session.  |
| `data-rxtt-kind`        | Item: `marker` or `cluster`.                                                                                      |
| `data-rxtt-count`       | Cluster item: member count used by default generated content.                                                     |
| `data-rxtt-key`         | Item: renderer identity key for reconciliation/interaction, not a stable business identifier for theme decisions. |
| `data-rxtt-selected`    | Item: `"true"` on the current keyboard-selected item. It is distinct from browser focus.                          |

Changing these attributes yourself is not a supported way to configure orientation, scrolling, or interaction. Use options/rules and let the renderer publish state. A selector such as `[data-rxtt-drag="true"]` styles enabled drag capability even when no pointer is dragging.

## Application classes and attributes

Use the class options in the service-class table and `marker.attributes` globally or per rule. Attribute names are ASCII-lowercased, with case collisions rejected. Supported extension names are `role`, supported `data-*`, and supported `aria-*`. `role` needs a nonempty trimmed string. Other accepted non-null values are strings, booleans, and finite numbers, serialized into the output.

Reserved fields include `class`, `style`, `id`, `tabindex`, `title`, event-handler and framework-special names, and every `data-rxtt-*` name. Use the explicit class/title options and CSS maps instead of attempting to replace those fields through application attributes.

Rule attribute values override globals, and a rule `null` persistently suppresses a matching global attribute. By comparison, `null` in a supported global attribute patch deletes the global configuration entry. Global and rule classes concatenate; an explicit rule title flag overrides the global flag. For a cluster, this resolution uses its primary marker. See [Marker presentation](../guides/rules-and-marker-behavior.md#marker-presentation).

Set an application class option to `''` to clear it, or omit it in a complete replacement to use the empty default. Which replacement/patch methods are exposed depends on the package; framework adapters require new whole options/rules references.

## Root values: configuration vs rendered output

Root `options.cssVariables` string values are retained unchanged in committed/read-state configuration, including blank or whitespace-only strings. Tracker does not parse them as CSS. A retained string is not a guarantee that the same bytes appear as a root declaration in the DOM.

| Layer                                    | Value handling                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Committed root options/read state        | Retains the accepted string, including leading/trailing whitespace or a blank value. |
| Projection root output                   | Trims nonblank strings and omits empty/whitespace-only values.                       |
| Vanilla standard DOM root output         | Equivalent trim/drop normalization.                                                  |
| Element, React, Vue, Angular root output | Uses Projection root chrome and inherits its normalization.                          |

For example, a configured `'  red  '` remains that string in committed options while standard root output uses `'red'`. A configured `'   '` can remain in configuration while producing no root custom-property declaration. An omitted rendered declaration allows the remaining CSS cascade to determine the value; it is not a forced reset of inherited styles.

Where a patch API is exposed, `options.cssVariables[name] = null` in the patch deletes the configured root entry. An own `undefined` entry is invalid. Complete options replacement replaces the map rather than retaining omitted keys. Framework adapters do not expose a patch-options handle: supply a new whole options value with the intended map. Do not apply root normalization assumptions to every rule/item styling path.

## Shadow DOM

The canonical stylesheet and application theme must be installed in the scope containing the actual `.rxtt`. Loading them only in the outer document cannot style output inside a ShadowRoot. Likewise, putting a source in a shadow tree does not by itself move Tracker output into it.

For Vanilla output inside a user ShadowRoot, pass an HTMLElement host within that root and install the stylesheet there. Element renders Light DOM under `<rxt-tracker>`; if that host is inside a user ShadowRoot, styles belong in that surrounding shadow scope. If Element remains in document Light DOM and only the source is a ShadowRoot, document styles still style the rail. See [Shadow DOM environments](../guides/environments.md#shadow-dom) for source and containment rules.

## Theme Builder

The [Theme Builder](../../site/tools/theme-builder/index.html) uses the public styling contract to preview theme choices and export application overrides. Its current site route is `tools/theme-builder`; this repository link opens the tool's source entry rather than assuming a deployment origin.

1. Choose a base appearance and adjust the public visual tokens.
2. Export/copy the application overrides and scope them to the intended Tracker instances.
3. Load the matching package stylesheet, then the theme in the output's document or shadow scope.
4. Check focus, selection, clusters, orientation, and contrast with your application's content.

Theme output supplements canonical stylesheet usage. The tool is an aid to creating overrides; this Markdown reference defines the styling contract.

## Styling examples

A class-scoped theme can preserve the standard DOM geometry while changing colors and the rail width. Set `track.className` to `reading-tracker` through the package's options:

```css
.reading-tracker.rxtt {
  --rxtt-track-thickness: 0.75rem;
  --rxtt-track-bg: #f1f5f9;
  --rxtt-marker-bg: #1d4ed8;
  --rxtt-marker-selected-ring-color: #0f172a;
}
```

For an item-specific override, supply a rule such as:

```js
const warningRule = {
  selector: '.warning',
  label: 'Warning',
  marker: {
    className: 'warning-marker',
    attributes: { 'data-severity': 'warning' },
    cssVariables: { '--rxtt-marker-bg': '#b45309' },
  },
};
```

Use root overflow/containment tokens carefully for decoration extending outside the rail, and keep focus/selected states perceptible. Do not use renderer geometry variables to compensate for a mismatched container overlay.

The [styling scenario](../../site/demos/scenarios/styling/README.md) compares supported mechanisms and broader theme recipes. [Vanilla Shadow DOM](../../site/demos/scenarios/shadow-dom-vanilla/README.md) and [Element Shadow DOM](../../site/demos/scenarios/shadow-dom-element/README.md) demonstrate the different source/output style scopes. These links open repository scenario materials; the Theme Builder link above opens its existing tool entry.
