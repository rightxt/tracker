# Extended form recipe

This recipe uses a deliberately long native HTML form to demonstrate validation-error navigation with RXT Tracker. The form includes standalone controls, logical choice groups, conditional sections, date constraints, and more than fifty controls.

## Build

```sh
npm install
npm run build
```

## What to try

1. Submit the empty form and use the Tracker markers to visit invalid fields.
2. Correct a field and watch its marker disappear.
3. Open a conditional section, submit again, and observe its required fields.
4. Close the section and confirm that its markers disappear.
5. Reset the form to return to the initial state with no validation markers.

## How Tracker is used

### Use the form as `sourceRoot`

Tracker is mounted with `applicationForm` as its explicit `sourceRoot`. Its rules query only the application form, so page headings, notes, and other content outside the form cannot become tracked elements.

### Wait for the first validation attempt

Native required controls can match `:invalid` as soon as the page loads. The selectors are therefore gated by `.form-was-validated`, which is added after the first validation attempt. Delaying the error UI is an application UX decision, not a Tracker requirement.

### Track invalid standalone controls

One rule selects invalid `input`, `select`, and `textarea` elements. Choice-group inputs are excluded because they are handled as logical groups.

### Track logical choice groups

A required radio group can make every radio match `:invalid`. A separate rule selects its `fieldset` once and focuses the appropriate invalid option when the marker is activated. This produces one useful marker for one logical question instead of one marker per radio button.

### Build useful marker labels

Marker labels combine the control's visible `label` or group `legend` with `validationMessage`. The validation message comes from the browser's native validation API, not from Tracker, so its wording and language can differ between browsers and user locales.

### Re-render when validation state changes

The application schedules one Tracker render per animation frame after validation attempts, edits, and conditional-section changes. Coalescing updates is useful because one submission can emit an `invalid` event for every invalid control. Native `invalid` events do not bubble, so the form listens for them in the capture phase.

Clustering is disabled because each marker represents a distinct validation problem. Merging nearby errors would make direct navigation to a particular field less useful.

### Destroy Tracker

The `pagehide` handler cancels any pending render and destroys Tracker so its DOM and event resources do not outlive the page.

## Native form behavior vs Tracker behavior

Tracker does not validate the form. Constraints such as `required`, `pattern`, `minlength`, `min`, `max`, and `type="email"` are ordinary HTML features interpreted by the browser:

```text
HTML constraint validation
-> browser determines :invalid controls
-> Tracker rules select those controls
-> Tracker renders navigation markers
```

The browser also controls submission blocking, focus behavior, and native validation messages. Tracker observes the resulting DOM state and provides navigation markers for it.

## Conditional sections

Each conditional checkbox controls a section containing a `fieldset`. When the option is off, the section is `hidden` and the fieldset is `disabled`. Disabled controls do not participate in normal constraint validation, so their required fields do not match the Tracker rules and cannot leave stale error markers:

```text
conditional option disabled
-> section hidden
-> fieldset disabled
-> nested controls do not participate in validation
-> no Tracker markers for them
```

## Project structure

- `src/main.js` contains the Tracker integration and form lifecycle. Start here.
- `index.html` contains the ordinary native form markup, constraints, and logical field groups.
- `src/styles.css` contains the form presentation and validation-state styles.
- `package.json` is a minimal standalone consumer-project setup.
