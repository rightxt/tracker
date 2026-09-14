/** @typedef {'color' | 'range' | 'select' | 'text'} ControlType */

/**
 * @typedef {object} ThemeVariableDefinition
 * @property {string} name Public CSS custom-property name.
 * @property {string} defaultValue Canonical fallback value from the package stylesheet.
 * @property {string} cssProperty CSS property used to validate the value.
 * @property {string} description Human-readable explanation of the token.
 * @property {ControlType} control Preferred auxiliary editor type.
 * @property {readonly string[]} [options] Suggested values for select controls.
 * @property {number} [min] Minimum range value.
 * @property {number} [max] Maximum range value.
 * @property {number} [step] Range increment.
 */

/**
 * @typedef {object} ThemeVariableGroup
 * @property {string} id Stable group identifier.
 * @property {string} title Human-readable group title.
 * @property {string} description Group-level guidance.
 * @property {readonly ThemeVariableDefinition[]} variables Public variables in this group.
 */

/** Public theme metadata mirrored from the current Core CSS contract. */
const THEME_GROUPS = Object.freeze([
  {
    id: 'track',
    title: 'Track',
    description: 'Rail geometry, surface, border, and stacking behavior.',
    variables: [
      {
        name: '--rxtt-track-thickness',
        defaultValue: '1rem',
        cssProperty: 'width',
        description: 'Physical thickness of the rail on its cross axis.',
        control: 'text',
      },
      {
        name: '--rxtt-track-bg',
        defaultValue: 'rgb(248 249 250 / 1)',
        cssProperty: 'background-color',
        description: 'Track background color.',
        control: 'color',
      },
      {
        name: '--rxtt-track-border-color',
        defaultValue: 'rgb(108 117 125 / 1)',
        cssProperty: 'border-color',
        description: 'Track edge border color.',
        control: 'color',
      },
      {
        name: '--rxtt-track-border-width',
        defaultValue: '1px',
        cssProperty: 'border-width',
        description: 'Width of the border on the edge facing the document.',
        control: 'text',
      },
      {
        name: '--rxtt-track-border-style',
        defaultValue: 'solid',
        cssProperty: 'border-style',
        description: 'Style of the track edge border.',
        control: 'select',
        options: ['solid', 'dashed', 'dotted', 'double', 'none'],
      },
    ],
  },
  {
    id: 'viewport',
    title: 'Viewport',
    description: 'Appearance of the visible-page indicator inside the rail.',
    variables: [
      {
        name: '--rxtt-viewport-bg',
        defaultValue: 'rgb(108 117 125 / 0.3)',
        cssProperty: 'background-color',
        description: 'Viewport indicator background color.',
        control: 'color',
      },
    ],
  },
  {
    id: 'marker',
    title: 'Markers',
    description: 'Marker body, static border, and state-specific interaction rings.',
    variables: [
      {
        name: '--rxtt-marker-min-size',
        defaultValue: '2px',
        cssProperty: 'min-height',
        description: 'Minimum physical marker size when its proportional size becomes very small.',
        control: 'text',
      },
      {
        name: '--rxtt-marker-bg',
        defaultValue: 'rgb(220 53 69 / 1)',
        cssProperty: 'background-color',
        description: 'Default marker background color.',
        control: 'color',
      },
      {
        name: '--rxtt-marker-border-color',
        defaultValue: 'rgb(108 117 125 / 1)',
        cssProperty: 'border-color',
        description: 'Static marker border color. The border is hidden by the default zero width.',
        control: 'color',
      },
      {
        name: '--rxtt-marker-border-width',
        defaultValue: '0',
        cssProperty: 'border-width',
        description: 'Static marker border width. Clusters inherit the same marker border contract.',
        control: 'text',
      },
      {
        name: '--rxtt-marker-border-style',
        defaultValue: 'solid',
        cssProperty: 'border-style',
        description: 'Static marker border style.',
        control: 'select',
        options: ['solid', 'dashed', 'dotted', 'double', 'none'],
      },
      {
        name: '--rxtt-marker-ring-color',
        defaultValue: 'rgb(108 117 125 / 1)',
        cssProperty: 'color',
        description: 'Base interaction-ring color inherited by hover and keyboard-selected states.',
        control: 'color',
      },
      {
        name: '--rxtt-marker-ring-width',
        defaultValue: '1px',
        cssProperty: 'outline-width',
        description: 'Base interaction-ring width inherited by hover and keyboard-selected states.',
        control: 'text',
      },
      {
        name: '--rxtt-marker-hover-ring-color',
        defaultValue: 'var(--rxtt-marker-ring-color, rgb(108 117 125 / 1))',
        cssProperty: 'color',
        description: 'Hover ring color override. Falls back to the base marker ring color.',
        control: 'color',
      },
      {
        name: '--rxtt-marker-hover-ring-width',
        defaultValue: 'var(--rxtt-marker-ring-width, 1px)',
        cssProperty: 'outline-width',
        description: 'Hover ring width override. Falls back to the base marker ring width.',
        control: 'text',
      },
      {
        name: '--rxtt-marker-selected-ring-color',
        defaultValue: 'var(--rxtt-marker-ring-color, rgb(108 117 125 / 1))',
        cssProperty: 'color',
        description: 'Keyboard-selected ring color override. Selected styling wins over hover.',
        control: 'color',
      },
      {
        name: '--rxtt-marker-selected-ring-width',
        defaultValue: 'var(--rxtt-marker-ring-width, 1px)',
        cssProperty: 'outline-width',
        description: 'Keyboard-selected ring width override. Selected styling wins over hover.',
        control: 'text',
      },
      {
        name: '--rxtt-marker-border-radius',
        defaultValue: '0',
        cssProperty: 'border-radius',
        description: 'Corner radius applied to markers and clusters.',
        control: 'text',
      },
      {
        name: '--rxtt-marker-opacity',
        defaultValue: '1',
        cssProperty: 'opacity',
        description: 'Default marker opacity.',
        control: 'range',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    id: 'cluster',
    title: 'Clusters',
    description: 'Marker-cluster surface and count label.',
    variables: [
      {
        name: '--rxtt-cluster-bg',
        defaultValue: 'var(--rxtt-marker-bg, rgb(220 53 69 / 1))',
        cssProperty: 'background-color',
        description: 'Cluster background. By default it follows the marker background.',
        control: 'color',
      },
      {
        name: '--rxtt-cluster-font-size',
        defaultValue: '10px',
        cssProperty: 'font-size',
        description: 'Font size of the cluster count.',
        control: 'text',
      },
      {
        name: '--rxtt-cluster-text-color',
        defaultValue: '#fff',
        cssProperty: 'color',
        description: 'Text color of the cluster count.',
        control: 'color',
      },
      {
        name: '--rxtt-cluster-content',
        defaultValue: 'attr(data-rxtt-count)',
        cssProperty: 'content',
        description: 'CSS content value used by the cluster label pseudo-element.',
        control: 'text',
      },
    ],
  },
  {
    id: 'focus',
    title: 'Focus',
    description: 'Keyboard focus outline around the complete rail.',
    variables: [
      {
        name: '--rxtt-focus-outline-color',
        defaultValue: 'Highlight',
        cssProperty: 'outline-color',
        description: 'Color of the keyboard focus outline.',
        control: 'color',
      },
      {
        name: '--rxtt-focus-outline-width',
        defaultValue: '2px',
        cssProperty: 'outline-width',
        description: 'Width of the keyboard focus outline.',
        control: 'text',
      },
      {
        name: '--rxtt-focus-outline-style',
        defaultValue: 'solid',
        cssProperty: 'outline-style',
        description: 'Style of the keyboard focus outline.',
        control: 'select',
        options: ['solid', 'dashed', 'dotted', 'double', 'auto', 'none'],
      },
      {
        name: '--rxtt-focus-outline-offset',
        defaultValue: '-2px',
        cssProperty: 'outline-offset',
        description: 'Distance between the rail edge and its focus outline.',
        control: 'text',
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    description: 'Layout and isolation tokens that can affect page integration, not just appearance.',
    variables: [
      {
        name: '--rxtt-track-offset',
        defaultValue: '0px',
        cssProperty: 'right',
        description: 'Distance between the rail and its configured viewport edge.',
        control: 'text',
      },
      {
        name: '--rxtt-track-start',
        defaultValue: '0px',
        cssProperty: 'top',
        description: 'Inset from the start edge of the rail axis.',
        control: 'text',
      },
      {
        name: '--rxtt-track-end',
        defaultValue: '0px',
        cssProperty: 'bottom',
        description: 'Inset from the end edge of the rail axis.',
        control: 'text',
      },
      {
        name: '--rxtt-track-z-index',
        defaultValue: '1000',
        cssProperty: 'z-index',
        description: 'Stacking level of the rail.',
        control: 'text',
      },
      {
        name: '--rxtt-track-overflow',
        defaultValue: 'hidden',
        cssProperty: 'overflow',
        description: 'Overflow behavior for rail content and application styling effects.',
        control: 'select',
        options: ['hidden', 'visible', 'clip', 'auto'],
      },
      {
        name: '--rxtt-track-contain',
        defaultValue: 'layout paint',
        cssProperty: 'contain',
        description: 'CSS containment applied to the rail. Use care when enabling outward effects.',
        control: 'select',
        options: ['layout paint', 'none', 'layout', 'paint', 'strict'],
      },
    ],
  },
]);
/** Public CSS custom-property names represented by the complete metadata registry. */
const THEME_VARIABLE_NAMES = Object.freeze(
  THEME_GROUPS.flatMap((group) => group.variables.map((variable) => variable.name)),
);

export { THEME_GROUPS, THEME_VARIABLE_NAMES };
