/**
 * Allowed options shape used for unknown-key detection and pruning.
 */
const ALLOWED_OPTIONS_SHAPE: Readonly<Record<string, unknown>> = Object.freeze({
  a11y: {
    enabled: true,
    keyboard: true,
    label: true,
  },
  clustering: {
    enabled: true,
    threshold: true,
  },
  cssVariables: true,
  diagnostics: {
    metrics: true,
    output: true,
    warnings: true,
  },
  interaction: {
    activation: true,
    drag: true,
  },
  marker: {
    attributes: true,
    className: true,
    title: true,
  },
  markerLayer: {
    className: true,
  },
  orientation: true,
  placement: true,
  track: {
    className: true,
  },
  updates: {
    interval: {
      delay: true,
      enabled: true,
    },
    mutation: {
      debounce: true,
      enabled: true,
      options: {
        attributeFilter: true,
        attributeOldValue: true,
        attributes: true,
        characterData: true,
        characterDataOldValue: true,
        childList: true,
        subtree: true,
      },
      targets: true,
    },
    resize: {
      debounce: true,
      enabled: true,
      targets: true,
    },
    scroll: {
      enabled: true,
    },
  },
  viewport: {
    className: true,
    enabled: true,
  },
});

export { ALLOWED_OPTIONS_SHAPE };
