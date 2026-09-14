# Writing modes and physical axes

Tracker orientation uses physical screen axes. `vertical` represents physical Y and `horizontal` represents physical X, regardless of the CSS block/inline axes created by `writing-mode`.

## Physical axes vs logical CSS flow

CSS `writing-mode` controls logical block and inline flow, while `direction` controls logical direction. Neither property chooses the Tracker axis. The scenario keeps its scrollers and targets at controlled physical `width` and `height` values so changing logical flow does not redefine the experiment's physical dimensions.

## Representative writing-mode profiles

Four synchronized Trackers compare:

- `horizontal-tb / ltr`, the common baseline;
- `horizontal-tb / rtl`, a direction change within horizontal writing;
- `vertical-rl / rtl` and `vertical-lr / ltr`, which exercise substantially different native physical scrolling behavior.

This is a representative teaching set, not an exhaustive writing-mode/direction compatibility matrix. Every panel has the same source structure, physical dimensions, three uniquely labelled targets, options, and rule.

## Vertical Tracker means physical Y

`orientation: 'vertical'` represents source geometry along screen Y. It uses an explicitly configured right rail; left would be the other compatible physical edge.

## Horizontal Tracker means physical X

`orientation: 'horizontal'` represents source geometry along screen X. It uses an explicitly configured bottom rail; top would be the other compatible physical edge. One global control reconfigures all four comparison Trackers through `patchOptions(..., { render: false })` followed by `render()`.

Writing mode affects content flow and native scrolling behavior. Tracker configuration independently chooses the represented physical axis and rail edge.

## Native scroll normalization

Native element offsets can have different signs and origins across writing modes, directions, physical axes, and browser engines. Tracker normalizes those coordinates into one physical X/Y model. Drag interaction is enabled on the four comparison rails so their physical endpoints can be explored without reasoning about raw `scrollLeft` or `scrollTop` values.

## Try the comparison

Start with **Vertical — physical Y**, inspect the three distinguishable markers in each panel, and drag the rails toward both physical Y edges. Switch the shared control to **Horizontal — physical X** and repeat along the bottom rails. All four Trackers remain synchronized while only their fixtures' CSS logical flow differs.

## Runtime flow changes and explicit `render()`

The fifth Tracker is a separate runtime-flow experiment. Its controls apply any of the same four representative profiles. After changing `writing-mode` and `direction`, the host explicitly calls `tracker.render()` and reports that geometry is synchronized.

## Why the fifth Tracker is isolated

This experiment deliberately disables interval, mutation, resize, and scroll update sources. The host application therefore owns invalidation and calls `render()` after its CSS change so Tracker recomputes geometry. This does not imply that every writing-mode change in an ordinarily configured Tracker universally requires manual rendering.

## Debug profile

This scenario uses Tracker's debug profile for diagnostics. Applications should use the default production export unless they need the debug build.

## Important files

- `package.json`
- `index.html`
- `src/main.js`
- `src/styles.css`
