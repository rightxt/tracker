import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';

/** Workspace root resolved from this config file, independent of `process.cwd()`. */
const rootDir = fileURLToPath(new URL('.', import.meta.url));

/** Core source root used by the package alias table below. */
const coreSrcDir = resolve(rootDir, 'packages/core/src');

/** Angular package source directory, normalized for id-prefix comparisons. */
const angularSrcDir = resolve(rootDir, 'packages/angular/src').replace(/\\/g, '/');

/** Test entries owned by the default package project. */
const defaultPackageTestFiles = 'packages/{core,vanilla,element,react,vue}/src/**/*.{test,spec}.{js,jsx,ts,tsx}';

/** Package source aliases used by tests. */
const packageAliases = [
  {
    find: '@rightxt/tracker-core/projection',
    replacement: resolve(coreSrcDir, 'projection.ts'),
  },
  {
    find: '@rightxt/tracker-core/renderer',
    replacement: resolve(coreSrcDir, 'renderer.ts'),
  },
  {
    find: '@rightxt/tracker-core/advanced',
    replacement: resolve(coreSrcDir, 'advanced.ts'),
  },
  {
    find: '@rightxt/tracker-core',
    replacement: resolve(coreSrcDir, 'index.ts'),
  },
];

export default defineConfig({
  define: {
    __RXT_TRACKER_DEBUG__: 'false',
    __RXT_TRACKER_VERSION__: JSON.stringify('0.1.0-test'),
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  resolve: {
    alias: packageAliases,
  },
  test: {
    // Vitest's own default (`allowOnly: !process.env.CI`) only rejects a
    // stray it.only/describe.only because GitHub Actions happens to set
    // CI=true; a plain local `pnpm packages:test` run would otherwise honor
    // it and silently skip the rest of the suite while still exiting 0. Set
    // explicitly so the guarantee does not depend on the environment. Both
    // "default" and "angular" projects inherit this via `extends: true`, and
    // vitest.browser.config.mjs's browser project inherits it in turn by
    // spreading this file's `test` config.
    allowOnly: false,
    // Framework and cross-realm initialization routinely exceeds Vitest's
    // 300 ms default; one second still exposes material per-test outliers.
    slowTestThreshold: 1000,
    coverage: {
      all: true,
      // Scoped to publishable library source; site and benchmark tooling are
      // not package runtime. Diagnostic only (see packages:test:coverage) —
      // not a merge gate, so there are no thresholds here.
      include: ['packages/*/src/**'],
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        '**/__tests__/**',
        '**/*.test.*',
        '**/*.spec.*',
        // Pure re-export barrels with no conditional logic. Production code
        // within each package imports its sibling modules directly rather
        // than through these entry points, so they are never executed as
        // files by this suite; their shape is verified instead at the dist
        // boundary (packages:verify:dist / scripts/test-dist.mjs).
        'packages/core/src/index.ts',
        'packages/vanilla/src/index.ts',
        'packages/react/src/index.ts',
        'packages/vue/src/index.ts',
        'packages/element/src/index.ts',
        'packages/angular/src/public-api.ts',
        // Side-effecting Custom Element registration entry point. Calling it
        // more than once throws (customElements.define rejects
        // redefinition), so it cannot be imported from this suite. Verified
        // by scripts/test-dist.mjs, which imports the built register.mjs.
        'packages/element/src/register.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'default',
          environment: 'node',
          setupFiles: [resolve(rootDir, 'tests/setup/default-package-tests.ts')],
          include: [defaultPackageTestFiles],
          exclude: ['**/node_modules/**', '**/dist/**', 'tests/browser/**', 'packages/angular/**'],
        },
      },
      {
        // Isolated from the "default" project so Angular compilation settings stay scoped
        // to this project's own Vite instance and never leak into core/react/vue test runs.
        extends: true,
        oxc: true,
        plugins: [
          angular({
            jit: false,
            tsconfig: resolve(rootDir, 'packages/angular/tsconfig.spec.json'),
            transformFilter: (_code, id) => id.replace(/\\/g, '/').startsWith(angularSrcDir),
          }),
        ],
        define: {
          ngDevMode: 'false',
          ngJitMode: 'true',
        },
        test: {
          name: 'angular',
          environment: 'node',
          include: ['packages/angular/src/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          pool: 'forks',
        },
      },
    ],
  },
});
