/* eslint-disable no-console -- Build runner reports generated bridge artifacts. */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/**
 * Bundles the framework adapter-benchmark bridges (`react.ts`, `vue.ts`,
 * `angular.ts`) against the already-built library packages.
 *
 * This is intentionally a separate, self-contained build step from the root
 * package build and the demo system. The benchmark harness owns its own minimal
 * Vite build and consumes package distributions directly. It must run after
 * `pnpm packages:build` has produced each package's dist output, which the aliases below
 * resolve to.
 */

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const adaptersDir = resolve(rootDir, 'benchmarks/adapters');

const ENTRIES = Object.freeze({
  angular: resolve(adaptersDir, 'angular.ts'),
  react: resolve(adaptersDir, 'react.ts'),
  vue: resolve(adaptersDir, 'vue.ts'),
});

await build({
  configFile: false,
  define: {
    __RXT_TRACKER_DEBUG__: JSON.stringify(false),
    __VUE_OPTIONS_API__: JSON.stringify(true),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
    ngDevMode: JSON.stringify(false),
    ngJitMode: JSON.stringify(true),
  },
  resolve: {
    alias: {
      '@rightxt/tracker-core/projection': resolve(rootDir, 'packages/core/dist/projection.mjs'),
      '@rightxt/tracker-core/renderer': resolve(rootDir, 'packages/core/dist/renderer.mjs'),
      '@rightxt/tracker-core': resolve(rootDir, 'packages/core/dist/index.mjs'),
      '@rightxt/tracker-angular': resolve(rootDir, 'packages/angular/dist/rxt-tracker-angular.mjs'),
      '@rightxt/tracker-react': resolve(rootDir, 'packages/react/dist/rxt-tracker-react.mjs'),
      '@rightxt/tracker-vue': resolve(rootDir, 'packages/vue/dist/rxt-tracker-vue.mjs'),
      tslib: resolve(rootDir, 'node_modules/tslib/tslib.es6.mjs'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    emptyOutDir: true,
    minify: 'terser',
    outDir: resolve(adaptersDir, 'dist'),
    rollupOptions: {
      input: { ...ENTRIES },
      output: { entryFileNames: '[name].js' },
      treeshake: { annotations: false },
    },
    target: 'es2022',
  },
});

for (const name of Object.keys(ENTRIES)) {
  console.log(`Built benchmark adapter bridge: benchmarks/adapters/dist/${name}.js`);
}
