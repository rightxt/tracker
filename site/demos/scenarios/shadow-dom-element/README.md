# Element tracking Shadow DOM

Assigning a ShadowRoot to `sourceRoot` changes where the Element runtime queries and observes source content; it does not move the `<rxt-tracker>` renderer into that ShadowRoot.

## Configure `sourceRoot` from JavaScript

DOM object references cannot be meaningfully serialized as normal HTML attributes. The scenario creates `<rxt-tracker>` while detached, applies its options and common rule, assigns `tracker.sourceRoot = sourceShadowRoot`, and only then appends it to the document. Its first connected runtime therefore starts with the intended source.

## `sourceRoot` changes query context

The controls assign either the user-managed open ShadowRoot or a Light DOM element to the same connected tracker's `sourceRoot` property. Both roots contain `.source-target` elements and use the same rule; their different exact counts make the active query context visible.

Shadow DOM boundaries remain explicit. Tracker queries the supplied root and does not recursively pierce nested ShadowRoots.

## The renderer remains in `<rxt-tracker>` Light DOM

The integration does not attach its own ShadowRoot: `tracker.shadowRoot === null`. Its `.rxtt` rail is a direct Light DOM child of the persistent `<rxt-tracker>` element, not a child of the user component's source ShadowRoot. Source replacement does not replace that custom element or transfer renderer ownership.

## Styling context

Because the rail remains in document Light DOM, the exported Element package stylesheet is loaded in the document styling context. The user component's application styles remain inside its ShadowRoot.

If `<rxt-tracker>` itself were placed inside a user-managed ShadowRoot, its package stylesheet would instead need to be available in that ShadowRoot's styling context.

## Connected `sourceRoot` replacement

Changing the selected source performs the integration's controlled remount against the new source/query scope. Renderer ownership and rule configuration stay unchanged. The mutation action is available only while the ShadowRoot is active and demonstrates observation of a newly matching source there.

## Compare with Vanilla

Compare the [Vanilla scenario](../shadow-dom-vanilla/README.md): Vanilla lets its consumer independently choose a `renderHost`, so both the source and rendered rail can live inside the same ShadowRoot.

## What to try

Confirm the three initial ShadowRoot markers, add a fourth target, then switch to the two-target Light DOM source and back. Inspect `<rxt-tracker>` throughout: it remains the same element with exactly one direct `.rxtt` child, while the source ShadowRoot contains no rail.

## Debug profile

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## Important files

- `package.json`
- `index.html`
- `src/main.js`
- `src/shadow.css`
- `src/styles.css`
