import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PACKAGE_DIRECTORY_BY_NAME, collectExportTargets, getPublishablePackageName } from './lib/workspace-pack.mjs';

/** Workspace root used to inspect package manifests and built distribution artifacts. */
const ROOT_DIR = resolve(import.meta.dirname, '..');

/** Core export subpaths that participate in production/debug condition selection. */
const CONDITIONAL_CORE_EXPORTS = ['.', './projection', './renderer', './advanced'];

/** Debug-only properties that must be absent from production Core and present in the debug build. */
const DEBUG_ONLY_DIAGNOSTIC_MARKERS = ['getTrace', 'clearTrace', 'traceLimit'];

/** Publishable package names paired with their workspace directory names. */
const PACKAGE_ENTRIES = Object.entries(PACKAGE_DIRECTORY_BY_NAME);

/** Adapter directory names whose bundles re-export Core and ship the canonical stylesheet. */
const ADAPTER_DIRECTORY_NAMES = ['vanilla', 'element', 'react', 'vue', 'angular'];

/**
 * Reads and parses a workspace package manifest.
 *
 * @param {string} directoryName - Workspace package directory name.
 * @returns {Promise<Record<string, unknown>>} Parsed package manifest.
 */
async function readPackageJson(directoryName) {
  const packageJsonPath = resolve(ROOT_DIR, `packages/${directoryName}/package.json`);

  return JSON.parse(await readFile(packageJsonPath, 'utf8'));
}

/**
 * Verifies that a package contains no emitted test declarations.
 *
 * @param {string} packageName - Published package name.
 * @param {string} directoryName - Workspace package directory name.
 * @returns {Promise<void>}
 */
async function assertNoTestArtifacts(packageName, directoryName) {
  const entries = await readdir(resolve(ROOT_DIR, `packages/${directoryName}/dist`), { recursive: true });

  if (entries.some((entry) => entry.includes('__tests__') || entry.endsWith('.test.d.ts'))) {
    throw new Error(`${packageName} declarations must not contain test artifacts.`);
  }
}

/**
 * Verifies that a package contains no TypeScript declaration maps.
 *
 * Their `sources` point to unpublished `../src/**` files, so they cannot resolve for installed consumers.
 *
 * @param {string} packageName - Published package name.
 * @param {string} directoryName - Workspace package directory name.
 * @returns {Promise<void>}
 */
async function assertNoDeclarationMaps(packageName, directoryName) {
  const entries = await readdir(resolve(ROOT_DIR, `packages/${directoryName}/dist`), { recursive: true });

  if (entries.some((entry) => entry.endsWith('.d.ts.map'))) {
    throw new Error(`${packageName} declarations must not emit .d.ts.map files.`);
  }
}

/**
 * Verifies that Angular's package directory contains no compiler-only JavaScript modules.
 *
 * @returns {Promise<void>}
 */
async function assertNoAngularCompilerJavaScript() {
  const entries = await readdir(resolve(ROOT_DIR, 'packages/angular/dist'));
  const intermediateJavaScript = entries.filter((entry) => entry.endsWith('.js') || entry.endsWith('.js.map'));

  if (intermediateJavaScript.length > 0) {
    throw new Error(`@rightxt/tracker-angular contains compiler-only JavaScript: ${intermediateJavaScript.join(', ')}`);
  }
}

/**
 * Reads a built Core entry and its directly imported local chunks.
 *
 * Vite hashes chunk names, so checking the entry file alone is not enough for production/debug assertions.
 *
 * @param {string} entryRelativePath - Entry file path relative to packages/core.
 * @returns {Promise<string>} Concatenated source of the entry and its local chunks.
 */
async function collectCoreEntrySource(entryRelativePath) {
  const entryDir = resolve(ROOT_DIR, 'packages/core', entryRelativePath, '..');
  const entrySource = await readFile(resolve(ROOT_DIR, 'packages/core', entryRelativePath), 'utf8');
  const chunkPaths = [...entrySource.matchAll(/from\s*"(\.\/[^"]+\.m?js)"/gu)].map((match) => match[1]);
  const chunkSources = await Promise.all(chunkPaths.map((chunkPath) => readFile(resolve(entryDir, chunkPath), 'utf8')));

  return [entrySource, ...chunkSources].join('\n');
}

for (const [packageName, directoryName] of PACKAGE_ENTRIES) {
  const packageDir = resolve(ROOT_DIR, `packages/${directoryName}`);
  const packageJson = await readPackageJson(directoryName);

  for (const relativePath of new Set(collectExportTargets(packageJson.exports))) {
    await access(resolve(packageDir, relativePath));
  }

  if (packageJson.exports?.['./style.css'] !== './dist/rxt-tracker.css') {
    throw new Error(`${packageName} must export its canonical ./style.css artifact.`);
  }

  if (
    !Array.isArray(packageJson.sideEffects) ||
    !packageJson.sideEffects.some((entry) => typeof entry === 'string' && entry.includes('.css'))
  ) {
    throw new Error(`${packageName} must retain CSS side-effect metadata.`);
  }

  await assertNoTestArtifacts(packageName, directoryName);
  await assertNoDeclarationMaps(packageName, directoryName);
}

await assertNoAngularCompilerJavaScript();

const corePackageJson = await readPackageJson('core');

for (const exportSubpath of CONDITIONAL_CORE_EXPORTS) {
  const exportConditions = corePackageJson.exports?.[exportSubpath];

  if (
    typeof exportConditions?.types !== 'string' ||
    typeof exportConditions?.development !== 'string' ||
    typeof exportConditions?.production !== 'string' ||
    typeof exportConditions?.default !== 'string'
  ) {
    throw new Error(`@rightxt/tracker-core export ${exportSubpath} must define all required conditions.`);
  }

  if (!exportConditions.development.endsWith('debug.mjs')) {
    throw new Error(`@rightxt/tracker-core export ${exportSubpath} must select debug core for development.`);
  }

  if (exportConditions.production !== exportConditions.default) {
    throw new Error(`@rightxt/tracker-core export ${exportSubpath} must default to production core.`);
  }
}

const coreProductionSource = await collectCoreEntrySource(corePackageJson.exports['./advanced'].production);
const coreDebugSource = await collectCoreEntrySource(corePackageJson.exports['./advanced'].development);

for (const marker of DEBUG_ONLY_DIAGNOSTIC_MARKERS) {
  if (coreProductionSource.includes(marker)) {
    throw new Error(
      `@rightxt/tracker-core production entry must tree-shake debug-only diagnostics: found "${marker}".`,
    );
  }

  if (!coreDebugSource.includes(marker)) {
    throw new Error(`@rightxt/tracker-core debug entry must retain debug-only diagnostics: missing "${marker}".`);
  }
}

const vanillaModuleSource = await readFile(resolve(ROOT_DIR, 'packages/vanilla/dist/rxt-tracker-vanilla.mjs'), 'utf8');
const elementModuleSource = await readFile(resolve(ROOT_DIR, 'packages/element/dist/rxt-tracker-element.mjs'), 'utf8');
const reactModuleSource = await readFile(resolve(ROOT_DIR, 'packages/react/dist/rxt-tracker-react.mjs'), 'utf8');
const vueModuleSource = await readFile(resolve(ROOT_DIR, 'packages/vue/dist/rxt-tracker-vue.mjs'), 'utf8');
const angularModuleSource = await readFile(resolve(ROOT_DIR, 'packages/angular/dist/rxt-tracker-angular.mjs'), 'utf8');
const canonicalCss = await readFile(resolve(ROOT_DIR, 'packages/core/dist/rxt-tracker.css'), 'utf8');

if (canonicalCss.includes('@property')) {
  throw new Error('Canonical Tracker CSS must not register public or application-owned custom properties.');
}

for (const [directoryName, moduleSource] of [
  ['vanilla', vanillaModuleSource],
  ['element', elementModuleSource],
  ['react', reactModuleSource],
  ['vue', vueModuleSource],
  ['angular', angularModuleSource],
]) {
  if (!moduleSource.includes('@rightxt/tracker-core/')) {
    throw new Error(`${getPublishablePackageName(directoryName)} ESM must keep core external.`);
  }
}

for (const directoryName of ADAPTER_DIRECTORY_NAMES) {
  const packageCss = await readFile(resolve(ROOT_DIR, `packages/${directoryName}/dist/rxt-tracker.css`), 'utf8');

  if (packageCss !== canonicalCss) {
    throw new Error(
      `${getPublishablePackageName(directoryName)} CSS must be byte-equivalent to the canonical Core artifact.`,
    );
  }
}

for (const elementJavaScriptPath of [
  'packages/element/dist/rxt-tracker-element.mjs',
  'packages/element/dist/rxt-tracker-element.js',
  'packages/element/dist/rxt-tracker-element.debug.js',
]) {
  const source = await readFile(resolve(ROOT_DIR, elementJavaScriptPath), 'utf8');

  if (source.includes('@layer rxtt.theme') || source.includes('.rxtt > .rxtt__markers')) {
    throw new Error(`${elementJavaScriptPath} must not contain the canonical stylesheet text.`);
  }
}

const elementPackageJson = await readPackageJson('element');
const requiredElementSideEffects = [
  './dist/register.mjs',
  './dist/rxt-tracker-element.js',
  './dist/rxt-tracker-element.debug.js',
  './dist/rxt-tracker.css',
];

if (
  !Array.isArray(elementPackageJson.sideEffects) ||
  requiredElementSideEffects.some((entry) => !elementPackageJson.sideEffects.includes(entry))
) {
  throw new Error('@rightxt/tracker-element must retain CSS, registration, and standalone-script side effects.');
}

const reactPackageJson = await readPackageJson('react');

if (reactPackageJson.peerDependencies?.react === undefined) {
  throw new Error('React must remain a peer dependency of @rightxt/tracker-react.');
}

if (reactPackageJson.peerDependencies?.['@types/react'] === undefined) {
  throw new Error('@types/react must remain an optional peer dependency of @rightxt/tracker-react.');
}

if (reactPackageJson.peerDependenciesMeta?.['@types/react']?.optional !== true) {
  throw new Error('@rightxt/tracker-react must declare @types/react as an optional peer dependency.');
}

if (!reactModuleSource.includes('from "react"')) {
  throw new Error('The React package bundle must keep React external.');
}

const vuePackageJson = await readPackageJson('vue');

if (vuePackageJson.peerDependencies?.vue === undefined) {
  throw new Error('Vue must remain a peer dependency of @rightxt/tracker-vue.');
}

if (!vueModuleSource.includes('from "vue"')) {
  throw new Error('The Vue package bundle must keep Vue external.');
}

const angularPackageJson = await readPackageJson('angular');

if (angularPackageJson.peerDependencies?.['@angular/core'] === undefined) {
  throw new Error('Angular core must remain a peer dependency of @rightxt/tracker-angular.');
}

if (angularPackageJson.peerDependencies?.['@angular/common'] === undefined) {
  throw new Error('Angular common must remain a peer dependency of @rightxt/tracker-angular.');
}

if (!angularModuleSource.includes('from "@angular/core"')) {
  throw new Error('The Angular package bundle must keep Angular core external.');
}

if (!angularModuleSource.includes('from "@angular/common"')) {
  throw new Error('The Angular package bundle must keep Angular common external.');
}

if (!angularModuleSource.includes('ɵɵngDeclareComponent')) {
  throw new Error('The Angular package bundle must retain partial-compilation metadata.');
}

process.stdout.write('Package artifact contracts passed.\n');
