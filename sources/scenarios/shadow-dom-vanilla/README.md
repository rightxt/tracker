# Vanilla in Shadow DOM

Vanilla lets the consumer choose both the source/query root and the render host, so both can live inside the same user-managed ShadowRoot. This scenario keeps those two DOM identities separate even though they share one shadow tree.

## `sourceRoot` can be a ShadowRoot

The scenario passes the actual open `ShadowRoot` to `tracker.mount()`. Tracker queries that root for matching `.shadow-target` elements. Shadow DOM boundaries remain explicit query boundaries: Tracker does not recursively pierce nested ShadowRoots.

## `renderHost` is independent

A dedicated `renderHost` element is also created inside the ShadowRoot and passed separately to `tracker.mount()`. The rail is rendered into that element; choosing the ShadowRoot as `sourceRoot` does not choose a rendering destination.

## Query boundary vs rendering boundary

The source/query scope answers where matching source elements are found. The rendering boundary answers where Tracker-owned DOM is inserted. Vanilla exposes both choices to the consumer:

```js
tracker.mount({
  sourceRoot: shadowRoot,
  renderHost,
});
```

## Styling inside the ShadowRoot

Document CSS does not style Tracker DOM across a shadow boundary. The demo therefore installs the exported Vanilla package stylesheet in the same ShadowRoot styling context as the rendered `.rxtt` rail. A plain ShadowRoot-local `<style>` keeps that requirement visible without making Constructable Stylesheets part of the lesson.

## Mutation observation

Under the current defaults, the supplied ShadowRoot is also the mutation-observation context. The add-target action appends one new matching source, which the runtime observes and represents with another marker.

## Compare with Element

Compare the [Element scenario](../shadow-dom-element/README.md): assigning its `sourceRoot` to a ShadowRoot changes the query/runtime source context, but its Element-owned renderer remains in `<rxt-tracker>` Light DOM.

## What to try

Run the demo, confirm the three initial markers, then select **Add target inside ShadowRoot**. Inspect `#shadow-host.shadowRoot` to see that the tracked content and `renderHost` are siblings and that the rail is a descendant of `renderHost`.

## Debug profile

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## Important files

- `package.json`
- `index.html`
- `src/main.js`
- `src/shadow.css`
- `src/styles.css`
