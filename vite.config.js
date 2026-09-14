import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { transform as transformCss } from 'lightningcss';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const packagesDir = resolve(rootDir, 'packages');
const coreSrcDir = resolve(packagesDir, 'core/src');

/** Core package imports that remain external in implementation ESM builds. */
const CORE_PACKAGE_PATTERN = /^@rightxt\/tracker-core(?:\/.*)?$/u;

/** Angular package imports that remain external in Angular ESM builds. */
const ANGULAR_PACKAGE_PATTERN = /^@angular\//u;

/**
 * Core package ESM entry points.
 *
 * @type {Readonly<Record<string, string>>}
 */
const CORE_ENTRY_POINTS = Object.freeze({
  advanced: 'advanced.ts',
  index: 'index.ts',
  projection: 'projection.ts',
  renderer: 'renderer.ts',
});

/**
 * Reads a workspace package.json file.
 *
 * @param {'core' | 'vanilla' | 'element' | 'react' | 'vue' | 'angular'} packageName - Workspace package name.
 * @returns {object} Parsed package.json.
 */
function readPackageJson(packageName) {
  return JSON.parse(readFileSync(resolve(packagesDir, `${packageName}/package.json`), 'utf8'));
}

/**
 * Minifies CSS with Lightning CSS.
 *
 * @param {string} css - Source CSS.
 * @param {string} filename - CSS filename.
 * @returns {string} Minified CSS.
 */
function minifyCss(css, filename) {
  const result = transformCss({
    code: Buffer.from(css),
    filename,
    minify: true,
    sourceMap: false,
  });

  return result.code.toString();
}

/**
 * Copies and minifies the shared public CSS file into a package dist.
 *
 * JavaScript entry points intentionally do not import CSS, so Vite will not
 * emit this file automatically.
 *
 * @param {string} sourceFile - Source CSS file.
 * @param {string} distDir - Package dist directory.
 * @returns {import('vite').Plugin} Vite plugin.
 */
function cssOutputPlugin(sourceFile, distDir) {
  return {
    name: 'rxt-tracker-css-output',

    writeBundle() {
      mkdirSync(distDir, { recursive: true });

      const outputFile = resolve(distDir, 'rxt-tracker.css');
      const sourceCss = readFileSync(sourceFile, 'utf8');
      const minifiedCss = minifyCss(sourceCss, 'rxt-tracker.css');

      writeFileSync(outputFile, minifiedCss);
    },
  };
}

/**
 * Returns output file name for the current package, build mode and format.
 *
 * @param {'vanilla' | 'element' | 'react' | 'vue' | 'angular'} packageName - Workspace package name.
 * @param {boolean} isDebugBuild - Whether debug build is active.
 * @param {string} format - Vite library format.
 * @returns {string} Output file name.
 */
function getPackageLibraryFileName(packageName, isDebugBuild, format) {
  const base =
    packageName === 'element'
      ? 'rxt-tracker-element'
      : packageName === 'react'
        ? 'rxt-tracker-react'
        : packageName === 'vue'
          ? 'rxt-tracker-vue'
          : packageName === 'angular'
            ? 'rxt-tracker-angular'
            : 'rxt-tracker-vanilla';

  if (format === 'es') {
    return isDebugBuild ? `${base}.debug.mjs` : `${base}.mjs`;
  }

  return isDebugBuild ? `${base}.debug.js` : `${base}.js`;
}

/**
 * Returns library entry points for the current build target.
 *
 * @param {'core' | 'vanilla' | 'element' | 'react' | 'vue' | 'angular'} packageName - Workspace package name.
 * @param {string} srcDir - Package source directory.
 * @param {boolean} isBrowserBuild - Whether browser build is active.
 * @returns {string | Record<string, string>} Library entry config.
 */
function getLibraryEntry(packageName, srcDir, isBrowserBuild) {
  if (packageName === 'core') {
    return Object.fromEntries(
      Object.entries(CORE_ENTRY_POINTS).map(([entryName, filename]) => [entryName, resolve(srcDir, filename)]),
    );
  }

  if (packageName === 'angular') {
    return resolve(srcDir, '../dist/public-api.js');
  }

  return resolve(srcDir, isBrowserBuild ? 'browser.ts' : 'index.ts');
}

/**
 * Returns output file name for multi-entry core builds.
 *
 * @param {boolean} isDebugBuild - Whether debug build is active.
 * @param {string} entryName - Rollup entry name.
 * @returns {string} Output file name.
 */
function getCoreEntryFileName(isDebugBuild, entryName) {
  if (entryName === 'index') {
    return isDebugBuild ? 'debug.mjs' : 'index.mjs';
  }

  return isDebugBuild ? `${entryName}.debug.mjs` : `${entryName}.mjs`;
}

/**
 * Creates package aliases for core workspace entry points.
 *
 * @returns {{ find: string, replacement: string }[]} Vite alias entries.
 */
function createCoreAliases() {
  const aliases = Object.keys(CORE_ENTRY_POINTS)
    .filter((entryName) => entryName !== 'index')
    .flatMap((subpath) => [
      {
        find: `@rightxt/tracker-core/${subpath}/debug`,
        replacement: resolve(coreSrcDir, CORE_ENTRY_POINTS[subpath]),
      },
      {
        find: `@rightxt/tracker-core/${subpath}`,
        replacement: resolve(coreSrcDir, CORE_ENTRY_POINTS[subpath]),
      },
    ]);

  aliases.push(
    {
      find: '@rightxt/tracker-core/debug',
      replacement: resolve(coreSrcDir, CORE_ENTRY_POINTS.index),
    },
    {
      find: '@rightxt/tracker-core',
      replacement: resolve(coreSrcDir, CORE_ENTRY_POINTS.index),
    },
  );

  return aliases;
}

/**
 * Returns dependencies that must remain external for a library target.
 *
 * @param {'core' | 'vanilla' | 'element' | 'react' | 'vue' | 'angular'} packageName - Workspace package name.
 * @param {boolean} isBrowserBuild - Whether browser/IIFE output is active.
 * @returns {Array<string | RegExp>} Rollup external dependency matchers.
 */
function getExternalDependencies(packageName, isBrowserBuild) {
  if (packageName === 'core' || isBrowserBuild) {
    return [];
  }

  const externalDependencies = [CORE_PACKAGE_PATTERN];

  if (packageName === 'react') {
    externalDependencies.push('react', 'react/jsx-runtime');
  }

  if (packageName === 'vue') {
    externalDependencies.push('vue');
  }

  if (packageName === 'angular') {
    externalDependencies.push(ANGULAR_PACKAGE_PATTERN);
  }

  return externalDependencies;
}

/**
 * Creates Vite configuration for one library build target.
 *
 * @param {object} params - Library build params.
 * @param {boolean} params.debug - Whether debug build is active.
 * @param {'core' | 'vanilla' | 'element' | 'react' | 'vue' | 'angular'} params.packageName - Workspace package name.
 * @param {'browser' | 'module'} params.target - Library build target.
 * @returns {import('vite').UserConfig} Vite configuration.
 */
function createLibraryConfig({ debug, packageName, target }) {
  const isBrowserBuild = target === 'browser';
  const shouldBundleCore = packageName === 'core' || isBrowserBuild;
  const packageDir = resolve(packagesDir, packageName);
  const srcDir = resolve(packageDir, 'src');
  const distDir = resolve(packageDir, 'dist');
  const packageJson = readPackageJson(packageName);
  const packageVersion = JSON.stringify(packageJson.version || '0.0.0');
  const plugins = [cssOutputPlugin(resolve(coreSrcDir, 'styles/rxt-tracker.css'), distDir)];
  const entry = getLibraryEntry(packageName, srcDir, isBrowserBuild);

  return {
    define: {
      __RXT_TRACKER_DEBUG__: JSON.stringify(debug),
      __RXT_TRACKER_VERSION__: packageVersion,
    },

    plugins,

    resolve: {
      alias: shouldBundleCore ? createCoreAliases() : [],
    },

    build: {
      cssMinify: 'lightningcss',
      emptyOutDir: false,
      lib: {
        entry,
        fileName: (format, entryName) =>
          packageName === 'core'
            ? getCoreEntryFileName(debug, entryName)
            : getPackageLibraryFileName(packageName, debug, format),
        formats: isBrowserBuild ? ['iife'] : ['es'],
        name:
          packageName === 'vanilla' ? 'RXTTracker' : packageName === 'element' ? 'RXTTrackerElement' : 'RXTTrackerCore',
      },
      minify: isBrowserBuild && !debug ? 'terser' : false,
      outDir: distDir,
      reportCompressedSize: true,
      rollupOptions: {
        external: getExternalDependencies(packageName, isBrowserBuild),
        output: {
          exports: isBrowserBuild ? 'default' : 'named',
        },
      },
      sourcemap: debug ? true : 'hidden',
      target: 'es2022',
      terserOptions: {
        compress: {
          passes: 3,
          pure_getters: true,
        },
        format: {
          comments: false,
        },
        mangle: true,
      },
    },
  };
}

/**
 * Creates Vite configuration for direct CLI usage.
 *
 * @param {object} params - Vite config params.
 * @param {string} params.mode - Active Vite mode.
 * @returns {import('vite').UserConfig} Vite configuration.
 */
function createConfig({ mode }) {
  return createLibraryConfig({
    debug: mode.startsWith('debug'),
    packageName: mode.includes('core')
      ? 'core'
      : mode.includes('element')
        ? 'element'
        : mode.includes('react')
          ? 'react'
          : mode.includes('vue')
            ? 'vue'
            : mode.includes('angular')
              ? 'angular'
              : 'vanilla',
    target: mode.endsWith('-browser') ? 'browser' : 'module',
  });
}

export { createLibraryConfig };

export default defineConfig(createConfig);
