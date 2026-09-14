import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

/** Workspace root used to resolve the symbol contract, declarations, runtime entrypoints, and package manifests. */
const ROOT_DIR = resolve(import.meta.dirname, '..');

/** Exact public-surface contract manifest. */
const CONTRACT_PATH = resolve(ROOT_DIR, 'tests/contracts/public-surface.json');

/** Package metadata fields that name public artifacts or entrypoints. */
const PUBLIC_METADATA_FIELDS = ['browser', 'jsdelivr', 'main', 'module', 'style', 'types', 'unpkg'];

/** Built declaration and runtime entrypoints covered by the exact symbol manifest. */
const ENTRYPOINTS = Object.freeze({
  angular: {
    '.': {
      declaration: 'packages/angular/dist/public-api.d.ts',
      runtime: 'packages/angular/dist/rxt-tracker-angular.mjs',
    },
  },
  core: {
    '.': {
      declaration: 'packages/core/dist/index.d.ts',
      runtime: 'packages/core/dist/index.mjs',
    },
    './advanced': {
      declaration: 'packages/core/dist/advanced.d.ts',
      runtime: 'packages/core/dist/advanced.mjs',
    },
    './advanced/debug': {
      declaration: 'packages/core/dist/advanced.d.ts',
      runtime: 'packages/core/dist/advanced.debug.mjs',
      sameAs: './advanced',
    },
    './debug': {
      declaration: 'packages/core/dist/index.d.ts',
      runtime: 'packages/core/dist/debug.mjs',
      sameAs: '.',
    },
    './projection': {
      declaration: 'packages/core/dist/projection.d.ts',
      runtime: 'packages/core/dist/projection.mjs',
    },
    './projection/debug': {
      declaration: 'packages/core/dist/projection.d.ts',
      runtime: 'packages/core/dist/projection.debug.mjs',
      sameAs: './projection',
    },
    './renderer': {
      declaration: 'packages/core/dist/renderer.d.ts',
      runtime: 'packages/core/dist/renderer.mjs',
    },
    './renderer/debug': {
      declaration: 'packages/core/dist/renderer.d.ts',
      runtime: 'packages/core/dist/renderer.debug.mjs',
      sameAs: './renderer',
    },
  },
  element: {
    '.': {
      declaration: 'packages/element/dist/index.d.ts',
      runtime: 'packages/element/dist/rxt-tracker-element.mjs',
    },
  },
  react: {
    '.': {
      declaration: 'packages/react/dist/index.d.ts',
      runtime: 'packages/react/dist/rxt-tracker-react.mjs',
    },
  },
  vanilla: {
    '.': {
      declaration: 'packages/vanilla/dist/index.d.ts',
      runtime: 'packages/vanilla/dist/rxt-tracker-vanilla.mjs',
    },
  },
  vue: {
    '.': {
      declaration: 'packages/vue/dist/index.d.ts',
      runtime: 'packages/vue/dist/rxt-tracker-vue.mjs',
    },
  },
});

/** Declaration files used as roots for TypeScript symbol inspection. */
const DECLARATION_PATHS = Object.values(ENTRYPOINTS)
  .flatMap((entrypoints) => Object.values(entrypoints))
  .map(({ declaration }) => resolve(ROOT_DIR, declaration));

/** TypeScript program used only to classify public declaration exports. */
const DECLARATION_PROGRAM = ts.createProgram({
  rootNames: [...new Set(DECLARATION_PATHS)],
  options: {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  },
});

/** TypeScript checker paired with the public declaration program. */
const TYPE_CHECKER = DECLARATION_PROGRAM.getTypeChecker();

/**
 * Returns the aliased declaration symbol when an export points at another declaration.
 *
 * @param {ts.Symbol} symbol - Exported module symbol.
 * @returns {ts.Symbol} Symbol used for value/type classification.
 */
function resolveExportSymbol(symbol) {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) {
    return symbol;
  }

  return TYPE_CHECKER.getAliasedSymbol(symbol);
}

/**
 * Collects exact type and value export names from one built declaration entrypoint.
 *
 * @param {string} declarationPath - Workspace-relative declaration path.
 * @returns {{ typeExports: string[], declaredValueExports: string[] }} Classified export names.
 */
function collectDeclarationExports(declarationPath) {
  const absolutePath = resolve(ROOT_DIR, declarationPath);
  const sourceFile = DECLARATION_PROGRAM.getSourceFile(absolutePath);

  if (!sourceFile) {
    throw new Error(`Missing declaration entrypoint: ${declarationPath}`);
  }

  const moduleSymbol = TYPE_CHECKER.getSymbolAtLocation(sourceFile);

  if (!moduleSymbol) {
    throw new Error(`Unable to inspect declaration entrypoint: ${declarationPath}`);
  }

  const declaredValueExports = [];
  const typeExports = [];

  for (const exportedSymbol of TYPE_CHECKER.getExportsOfModule(moduleSymbol)) {
    const resolvedSymbol = resolveExportSymbol(exportedSymbol);
    const exportName = exportedSymbol.getName();

    if ((resolvedSymbol.flags & ts.SymbolFlags.Value) !== 0) {
      declaredValueExports.push(exportName);
    }

    if ((resolvedSymbol.flags & ts.SymbolFlags.Type) !== 0) {
      typeExports.push(exportName);
    }
  }

  return {
    declaredValueExports: declaredValueExports.sort(),
    typeExports: typeExports.sort(),
  };
}

/**
 * Collects runtime export names from one built ESM entrypoint.
 *
 * @param {string} runtimePath - Workspace-relative runtime module path.
 * @returns {Promise<string[]>} Sorted runtime export names.
 */
async function collectRuntimeExports(runtimePath) {
  const moduleUrl = pathToFileURL(resolve(ROOT_DIR, runtimePath)).href;
  const runtimeModule = await import(moduleUrl);

  return Object.keys(runtimeModule).sort();
}

/**
 * Reads public artifact metadata covered by the contract manifest.
 *
 * @param {Record<string, unknown>} packageJson - Parsed package manifest.
 * @returns {Record<string, unknown>} Public artifact metadata.
 */
function collectPublicMetadata(packageJson) {
  return Object.fromEntries(
    PUBLIC_METADATA_FIELDS.filter((field) => packageJson[field] !== undefined).map((field) => [
      field,
      packageJson[field],
    ]),
  );
}

/**
 * Collects the exact current public surface for all workspace packages.
 *
 * @returns {Promise<Record<string, unknown>>} Public package surface keyed by package directory name.
 */
async function collectPackageSurfaces() {
  await import('@angular/compiler');

  const surfaces = {};

  for (const [packageName, entrypoints] of Object.entries(ENTRYPOINTS)) {
    const packageJson = JSON.parse(await readFile(resolve(ROOT_DIR, `packages/${packageName}/package.json`), 'utf8'));
    const entrypointSurfaces = {};

    for (const [subpath, paths] of Object.entries(entrypoints)) {
      const declarationExports = collectDeclarationExports(paths.declaration);
      const valueExports = await collectRuntimeExports(paths.runtime);

      assert.deepEqual(
        valueExports,
        declarationExports.declaredValueExports,
        `${packageJson.name} ${subpath} runtime/declaration value exports differ`,
      );

      const surface = {
        typeExports: declarationExports.typeExports,
        valueExports,
      };

      if (paths.sameAs !== undefined) {
        assert.deepEqual(
          surface,
          entrypointSurfaces[paths.sameAs],
          `${packageJson.name} ${subpath} must mirror ${paths.sameAs}`,
        );
        entrypointSurfaces[subpath] = { sameAs: paths.sameAs };
      } else {
        entrypointSurfaces[subpath] = surface;
      }
    }

    surfaces[packageName] = {
      entrypoints: entrypointSurfaces,
      exports: packageJson.exports,
      metadata: collectPublicMetadata(packageJson),
      name: packageJson.name,
    };
  }

  return surfaces;
}

const currentPackages = await collectPackageSurfaces();
const currentContract = { schemaVersion: 1, packages: currentPackages };

if (process.argv.includes('--print')) {
  process.stdout.write(`${JSON.stringify(currentContract, null, 2)}\n`);
} else if (process.argv.includes('--update')) {
  await writeFile(CONTRACT_PATH, `${JSON.stringify(currentContract, null, 2)}\n`, 'utf8');
  process.stdout.write('Public surface contract updated.\n');
} else {
  const expectedContract = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'));

  assert.deepEqual(currentContract, expectedContract, 'Public package surface differs from the contract manifest');
  process.stdout.write('Public surface contract passed.\n');
}
