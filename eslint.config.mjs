import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import reactPlugin from 'eslint-plugin-react';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const jsFiles = ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];
const tsFiles = ['**/*.ts', '**/*.tsx'];

const nodeFiles = [
  '*.config.js',
  '*.config.mjs',
  '*.config.cjs',
  'eslint.config.mjs',
  'prettier.config.mjs',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'build.js',
  'scripts/**/*.{js,mjs,cjs}',
];

export default defineConfig([
  {
    name: 'project/ignores',
    ignores: [
      '.venv/**',
      '.vitest-attachments/**',
      '**/coverage/**',
      '**/dist/**',
      'node_modules/**',
      'tests/browser/__screenshots__/**',

      // Site infrastructure outputs
      'site-dist/**',
      'site/.cache/**',
      'site/.work/**',
      'site/**/.angular/**',
      'site/**/.vite/**',
      'site/**/out-tsc/',

      // Benchmark outputs
      'benchmarks/reports/**',
    ],
  },

  {
    name: 'project/linter-options',
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  {
    name: 'project/javascript',
    files: jsFiles,

    extends: [js.configs.recommended, importPlugin.flatConfigs.recommended],

    languageOptions: {
      ecmaVersion: 'latest',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },

    plugins: {
      jsdoc: jsdocPlugin,
    },

    settings: {
      'import/resolver': {
        typescript: true,
      },
    },

    rules: {
      // Core correctness
      'array-callback-return': 'error',
      'consistent-return': 'error',
      curly: ['error', 'all'],
      'default-param-last': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-alert': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-constructor-return': 'error',
      'no-else-return': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-param-reassign': ['error', { props: false }],
      'no-promise-executor-return': 'error',
      'no-return-assign': ['error', 'always'],
      'no-shadow': 'warn',
      'no-template-curly-in-string': 'error',
      'no-unneeded-ternary': 'error',
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      'no-use-before-define': [
        'error',
        {
          classes: true,
          functions: false,
          variables: true,
        },
      ],
      'no-useless-return': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-const': 'error',
      'prefer-rest-params': 'error',
      radix: 'error',

      // Imports
      'import/exports-last': 'error',
      'import/first': 'error',
      'import/no-absolute-path': 'error',
      'import/no-duplicates': 'error',
      'import/no-mutable-exports': 'error',
      'import/no-self-import': 'error',
      'import/no-unresolved': 'error',
      'import/no-useless-path-segments': ['error', { noUselessIndex: true }],

      // JSDoc correctness, not formatting
      'jsdoc/check-access': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-property-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-types': 'error',
      'jsdoc/empty-tags': 'error',
      'jsdoc/implements-on-classes': 'error',
      'jsdoc/no-bad-blocks': 'error',
      'jsdoc/no-defaults': 'error',
      'jsdoc/no-missing-syntax': 'off',
      'jsdoc/no-multi-asterisks': 'off',
      'jsdoc/no-types': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/valid-types': 'error',
    },
  },

  {
    name: 'project/jsx-bindings',
    files: ['**/*.jsx'],
    plugins: {
      react: reactPlugin,
    },
    rules: {
      'react/jsx-uses-vars': 'error',
    },
  },

  {
    name: 'project/typescript',
    files: tsFiles,

    extends: [js.configs.recommended, importPlugin.flatConfigs.recommended],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
      },
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin,
      jsdoc: jsdocPlugin,
    },

    settings: {
      'import/resolver': {
        typescript: true,
      },
    },

    rules: {
      // Core correctness
      'array-callback-return': 'error',
      'consistent-return': 'error',
      curly: ['error', 'all'],
      'default-param-last': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // TypeScript handles undefined-variable checking; no-undef causes false positives on DOM types.
      'no-undef': 'off',
      'no-alert': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-constructor-return': 'error',
      'no-else-return': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-param-reassign': ['error', { props: false }],
      'no-promise-executor-return': 'error',
      'no-return-assign': ['error', 'always'],
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'warn',
      'no-template-curly-in-string': 'error',
      'no-unneeded-ternary': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      'no-use-before-define': [
        'error',
        {
          classes: true,
          functions: false,
          variables: true,
        },
      ],
      'no-useless-return': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-const': 'error',
      'prefer-rest-params': 'error',
      radix: 'error',

      // Imports
      'import/exports-last': 'error',
      'import/first': 'error',
      'import/no-absolute-path': 'error',
      'import/no-duplicates': 'error',
      'import/no-mutable-exports': 'error',
      'import/no-self-import': 'error',
      'import/no-unresolved': 'error',
      'import/no-useless-path-segments': ['error', { noUselessIndex: true }],

      // JSDoc correctness
      'jsdoc/check-access': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-property-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-types': 'error',
      'jsdoc/empty-tags': 'error',
      'jsdoc/implements-on-classes': 'error',
      'jsdoc/no-bad-blocks': 'error',
      'jsdoc/no-defaults': 'error',
      'jsdoc/no-missing-syntax': 'off',
      'jsdoc/no-multi-asterisks': 'off',
      'jsdoc/no-types': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/valid-types': 'error',
    },
  },

  {
    name: 'project/commonjs',
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },

  {
    name: 'project/node-files',
    files: nodeFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    name: 'project/generated-artifact-checks',
    files: ['scripts/test-dist.mjs', 'tests/fixtures/**/*.{ts,tsx}'],
    rules: {
      'import/no-unresolved': 'off',
    },
  },

  {
    name: 'project/generated-package-consumers',
    files: [
      'benchmarks/retention-memory.mjs',
      'scripts/check-projection-renderer-retention.mjs',
      'scripts/check-promise-retention.mjs',
    ],
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^\\.\\./packages/core/dist/'] }],
    },
  },

  {
    name: 'project/demo-consumers',
    files: ['site/demos/{playgrounds,recipes,scenarios}/**/*.{js,jsx,mjs,ts,tsx,vue}'],
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^@rightxt/tracker-'] }],
    },
  },

  {
    name: 'project/interactive-demo-jsdoc',
    files: [
      'site/shared/events/**/*.{js,jsx,ts,tsx}',
      'site/demos/scenarios/events/**/*.{js,jsx,ts,tsx}',
      'site/demos/scenarios/diagnostics/**/*.{js,jsx,ts,tsx}',
      'site/demos/scenarios/observation/**/*.{js,jsx,ts,tsx}',
    ],
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          contexts: [
            'ClassDeclaration',
            'FunctionDeclaration',
            'MethodDefinition',
            'Program > VariableDeclaration[kind="const"]',
            'PropertyDefinition',
          ],
          publicOnly: false,
        },
      ],
    },
  },

  {
    name: 'project/site-cli-output',
    files: ['site/scripts/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    name: 'project/framework-wrappers',
    files: ['packages/{react,vue,angular}/src/**/*.{js,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@rightxt/tracker-core/advanced', '@rightxt/tracker-core/advanced/*'],
              message: 'Advanced core APIs are not the ordinary framework wrapper path.',
            },
            {
              group: ['@rightxt/tracker-core/renderer', '@rightxt/tracker-core/renderer/*'],
              message: 'Declarative framework wrappers should use the Projection SPI.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'project/vanilla-tracker-facade',
    files: ['packages/vanilla/src/tracker/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@rightxt/tracker-core/advanced', '@rightxt/tracker-core/advanced/*'],
              message: 'Advanced core APIs are not the vanilla Tracker facade path.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'project/vanilla-dom-renderer',
    files: ['packages/vanilla/src/render/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@rightxt/tracker-core/debug',
              message: 'The vanilla DOM renderer should use the normal shared Core contract.',
            },
          ],
          patterns: [
            {
              group: ['@rightxt/tracker-core/advanced', '@rightxt/tracker-core/advanced/*'],
              message: 'Advanced core APIs are not the vanilla DOM renderer path.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'project/element',
    files: ['packages/element/src/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@rightxt/tracker-core/advanced', '@rightxt/tracker-core/advanced/*'],
              message: 'Advanced core APIs are not the element path.',
            },
            {
              group: ['@rightxt/tracker-core/renderer', '@rightxt/tracker-core/renderer/*'],
              message: 'The Element adapter should use the Projection SPI.',
            },
          ],
        },
      ],
    },
  },
]);
