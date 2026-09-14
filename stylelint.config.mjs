/**
 * @type {import('stylelint').Config}
 */
const config = {
  extends: ['stylelint-config-standard'],

  rules: {
    'alpha-value-notation': 'number',
    'color-function-notation': 'modern',
    'declaration-block-no-redundant-longhand-properties': true,
    'font-family-name-quotes': 'always-where-recommended',
    'function-url-quotes': 'always',
    'hue-degree-notation': 'angle',
    'import-notation': 'url',
    'length-zero-no-unit': true,
    'media-feature-range-notation': 'context',
    'no-descending-specificity': [true, { ignore: ['selectors-within-list'] }],
    'selector-class-pattern': [
      '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$',
      {
        message:
          'Expected class selector to be BEM-like: block, block__element, block--modifier, or block__element--modifier.',
      },
    ],
    'selector-max-id': 0,
    'selector-no-qualifying-type': [true, { ignore: ['attribute', 'class'] }],
    'shorthand-property-no-redundant-values': true,
  },
};

export default config;
