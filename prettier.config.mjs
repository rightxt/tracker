/**
 * @type {import('prettier').Config}
 */
const config = {
  arrowParens: 'always',
  bracketSameLine: false,
  bracketSpacing: true,
  endOfLine: 'lf',
  objectWrap: 'preserve',
  printWidth: 120,
  proseWrap: 'preserve',
  quoteProps: 'as-needed',
  semi: true,
  singleAttributePerLine: false,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,

  overrides: [
    {
      files: '*.md',
      options: {
        printWidth: 100000,
        proseWrap: 'never',
      },
    },
    {
      files: ['*.css', '*.html', '*.svg'],
      options: {
        printWidth: 100000,
      },
    },
  ],
};

export default config;
