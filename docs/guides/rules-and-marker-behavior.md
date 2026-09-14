# Rules and marker behavior

A rule connects a selector to marker presentation and activation behavior. This guide explains how rules compose when elements overlap, markers cluster, and users navigate the rail. The field-level configuration and mutation API remains in the [README for your package](../../README.md).

## How rules select elements

Tracker queries the configured `sourceRoot`. Selectors are trimmed, must be nonempty, and must be unique after trimming. Uniqueness concerns the selector string, not whether two different selectors happen to match the same elements.

An Element source queries descendants rather than matching itself. Selectors do not automatically enter shadow trees or iframe documents. Choose a suitable source before designing rules; see [Source roots](environments.md#source-roots).

## Rule order and ownership

Rules form an ordered list. If several rules match the same source Element, the first matching rule owns it, giving that Element at most one logical marker. That rule controls its label, presentation, scroll target, and focus behavior. Reordering rules can therefore change behavior even when every selector still matches the same DOM.

Put a specific rule before a broader fallback when the specific case needs different behavior:

```js
const rules = [
  {
    selector: 'h2.important',
    label: (element) => element.textContent,
    marker: { className: 'important-heading' },
  },
  {
    selector: 'h2',
    label: (element) => element.textContent,
  },
];
```

Supply this list through your package's rules API. An important heading is owned by the first rule, not rendered once for each match.

## Labels

`label` can be a static string, a synchronous function receiving the matched Element, or `null`. A callback's string result becomes the label; `null` or another non-string runtime result means no label. A thrown callback is diagnosed and produces no label. Promises are not awaited.

A nonempty resolved label can supply the native title when title output is enabled. A label does not itself enable focus or keyboard interaction. Keep resolvers as computations; do not use them to mutate the same Tracker during its active lifecycle/render transition.

## Marker presentation

Global marker defaults combine with the owning rule as follows:

| Presentation  | Composition                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classes       | Global `marker.className` and rule `marker.className` concatenate. Service classes remain renderer-owned.                                                                    |
| Attributes    | Rule values override matching globals; rule `null` suppresses that global attribute for the item.                                                                            |
| Title         | An explicit rule `marker.title` overrides the global flag. Otherwise it inherits the global policy, which defaults to enabled. A title is emitted only for a nonempty label. |
| CSS variables | Rule `marker.cssVariables` supplies item-level values that override inherited root or ancestor values through the CSS cascade.                                               |

The same composition applies to a cluster using its primary marker's rule. Rule presentation does not replace service attributes such as `data-rxtt-kind` and `data-rxtt-key`.

## CSS variables and attributes

Use supported application `role`, `data-*`, and `aria-*` attributes. Names are ASCII-lowercased; names that collide after normalization reject the candidate. `role` must be a nonempty trimmed string. Other accepted non-null values are strings, booleans, and finite numbers. Tracker service metadata and browser/framework-owned fields such as `class`, `style`, `id`, `tabindex`, `title`, and event-handler names cannot be supplied through this map.

A rule attribute `null` is persistent suppression intent, not an empty string. It can remove a matching global marker attribute for that rule. This differs from a global attribute patch, where `null` deletes the configured global entry.

Rule CSS maps accept the 17 marker/cluster Tracker variables and valid application-owned custom properties. Track, viewport, root-focus, unknown reserved Tracker names, and renderer-owned geometry variables are not valid rule configuration. Values must be strings; `null` is not a deletion command in this complete rule map. To remove a variable, replace the rule with a map that omits it. The [styling reference](../reference/styling.md#rule-marker-css-custom-properties) lists the exact variables and separates root-output normalization from item handling.

### Validation recovery and strict updates

Core's pure `validateRule()` and `validateRules()` helpers diagnose invalid rule-marker CSS-variable names and drop those invalid-name entries from their recovered normalized candidate; valid entries remain. These helpers do not commit Tracker state.

Normal Tracker mutations are strict: a candidate containing validation diagnostics is rejected rather than partially committing the recovered rule. Use recovered validation output deliberately in tooling; do not expect a normal update to silently accept invalid entries or keep only the valid subset.

## Activation

For an accepted marker activation, Tracker attempts the configured scroll phase first, then the configured focus phase. Scrolling defaults to enabled and focusing to disabled. Disabling a rule's scroll behavior does not inherently disable its focus phase, and enabling focus does not change rule ownership.

### Resolving navigation targets

`scroll.target` and `focus.target` accept `'self'`, a nonempty selector, or a synchronous resolver returning an Element or `null`. `'self'` uses the matched source Element. Selector search tries source descendants, then its containing ShadowRoot when present, then its owner document.

Resolved targets must belong to the active document. In element mode they must also lie within the supported scroll subtree; targets outside it are skipped with diagnostics rather than scrolling an unrelated container. A final focus target must be an `HTMLElement`. The [environment containment model](environments.md#shadow-dom) also applies when targets are in shadow trees.

An invalid selector encountered during target resolution, a throwing resolver, or an invalid target is diagnosed and yields no usable target for that phase. Target callbacks are synchronous; asynchronous lookup is not supported. Scroll/focus failures do not suppress notification of an otherwise accepted semantic activation.

### Notifications and interaction switches

Activation events notify after Core has attempted the semantic behavior. Listener return values, exceptions, or a late `preventDefault()` cannot undo Core's earlier scroll/focus attempt. Configure the rule or interaction options when behavior needs to change. Use your package's event channel rather than assuming identical subscription syntax across adapters.

`interaction.activation: false` suppresses marker, cluster, discrete track, and selected-item keyboard activation and their activation notifications. Drag is controlled separately by `interaction.drag`: drag movement can scroll continuously and does not emit `track:activate`. A discrete track activation scrolls toward a computed track position before its notification.

## Selection and accessibility

Tracker selection is logical rail state; browser focus is a platform state. Keyboard navigation can select a marker or cluster while focus stays on the rail. Activating that selection can then scroll and, if the rule enables it, move focus to a source target. Do not interpret the selected styling hook as proof that the corresponding source element has browser focus.

Enable `a11y.enabled` with a meaningful `a11y.label` when exposing the rail to assistive technology, and enable `a11y.keyboard` for keyboard behavior. Keyboard support requires accessibility to be enabled; the combination `enabled: false, keyboard: true` is rejected. Preserve visible rail focus and selected-item indicators when applying a theme. Selection can also be reconciled as the render set changes, so it should not be treated solely as a record of click events.

## Clustering

When clustering is enabled, nearby measured marker positions are grouped using `clustering.threshold`, a distance in track percentage points rather than CSS pixels. Content geometry and threshold changes can merge or split groups. Visual marker minimum thickness is a separate styling concern.

The cluster's primary marker is first in spatial track order, using rule order to break equal-position ties. Its rule supplies cluster application classes, attributes, title policy, and item CSS variables. Different rules in one cluster do not merge all their presentation maps together. The cluster count describes all members, while activation uses the primary marker's scroll/focus behavior.

## Changing rules

Use the actual adapter surface: Core Direct Renderer and Vanilla have incremental rule methods as well as full replacement; Element exposes its JS rule mutation methods. Core Projection replaces the complete configuration envelope. React, Vue, and Angular take a complete new rules array through declarative props/inputs.

Do not mutate a framework rules array in place and expect reconciliation. Rule order remains semantic priority after replacement. Normal configuration validation is atomic, including rejection of duplicate normalized selectors. Source DOM changes are a separate concern from changing the rule list; see [Updates and manual refresh](updates-and-refresh.md).

## Examples

These repository scenario materials show the behavior in context:

- [Rule resolution](../../site/demos/scenarios/rule-resolution/README.md): rule priority, computed labels, and navigation resolvers.
- [Clustering](../../site/demos/scenarios/clustering/README.md): proximity groups, threshold changes, and primary-marker presentation.
- [Accessibility](../../site/demos/scenarios/accessibility/README.md): keyboard selection, activation, and browser focus.

For the exact CSS variables, supported service hooks, and theme workflow, see [Styling Tracker](../reference/styling.md).
