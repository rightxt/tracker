import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createLibraryConfig } from './vite.config.js';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const tscBin = resolve(rootDir, 'node_modules/typescript/bin/tsc');
const angularBuildScript = resolve(rootDir, 'scripts/build-angular.mjs');

/**
 * Emits TypeScript declarations for a package.
 *
 * Core declarations are emitted before implementation-package declarations.
 * Implementation packages consume core declarations but do not depend on one another.
 *
 * @param {string} project - Path to the tsconfig.build.json, relative to the workspace root.
 * @returns {void}
 */
function runTsc(project) {
  execFileSync(process.execPath, [tscBin, '--project', project], { cwd: rootDir, stdio: 'inherit' });
}

/**
 * Partially compiles the Angular package and emits declarations for Angular's linker.
 *
 * @param {string} project - Path to the Angular tsconfig, relative to the workspace root.
 * @returns {void}
 */
function runNgc(project) {
  execFileSync(process.execPath, [angularBuildScript, project], { cwd: rootDir, stdio: 'inherit' });
}

/** Removes intermediate Angular compiler JavaScript after the flat ESM bundle is written. */
function removeAngularCompilerJavaScript() {
  const angularDistDir = resolve(rootDir, 'packages/angular/dist');

  for (const entry of readdirSync(angularDistDir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.js.map'))) {
      rmSync(resolve(angularDistDir, entry.name), { force: true });
    }
  }
}

/** Emits the Element registration entry that reuses the primary ESM constructor. */
function writeElementRegistrationEntry() {
  writeFileSync(
    resolve(rootDir, 'packages/element/dist/register.mjs'),
    "import { defineTrackerElement } from './rxt-tracker-element.mjs';\ndefineTrackerElement();\n",
  );
}

/**
 * Build targets required for package distribution.
 *
 * @type {ReadonlyArray<{ debug: boolean, packageName: 'core' | 'vanilla' | 'element' | 'react' | 'vue', target: 'module' | 'browser' }>}
 */
const BUILD_TARGETS = Object.freeze([
  { debug: false, packageName: 'core', target: 'module' },
  { debug: true, packageName: 'core', target: 'module' },
  { debug: false, packageName: 'vanilla', target: 'module' },
  { debug: false, packageName: 'vanilla', target: 'browser' },
  { debug: true, packageName: 'vanilla', target: 'browser' },
  { debug: false, packageName: 'element', target: 'module' },
  { debug: false, packageName: 'element', target: 'browser' },
  { debug: true, packageName: 'element', target: 'browser' },
  { debug: false, packageName: 'react', target: 'module' },
  { debug: false, packageName: 'vue', target: 'module' },
]);

[
  'packages/core/dist',
  'packages/vanilla/dist',
  'packages/element/dist',
  'packages/react/dist',
  'packages/vue/dist',
  'packages/angular/dist',
].forEach((path) => {
  rmSync(path, {
    force: true,
    recursive: true,
  });
});

for (const buildTarget of BUILD_TARGETS) {
  await build({
    ...createLibraryConfig(buildTarget),
    configFile: false,
  });
}

runTsc('packages/core/tsconfig.build.json');
runTsc('packages/vanilla/tsconfig.build.json');
runTsc('packages/element/tsconfig.build.json');
writeElementRegistrationEntry();
runTsc('packages/react/tsconfig.build.json');
runTsc('packages/vue/tsconfig.build.json');
runNgc('packages/angular/tsconfig.build.json');

await build({
  ...createLibraryConfig({ debug: false, packageName: 'angular', target: 'module' }),
  configFile: false,
});
removeAngularCompilerJavaScript();
