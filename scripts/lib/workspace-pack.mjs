import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

/** Repository root and publishable package directory mapping. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
const PACKAGE_DIRECTORY_BY_NAME = Object.freeze({
  '@rightxt/tracker-angular': 'angular',
  '@rightxt/tracker-core': 'core',
  '@rightxt/tracker-element': 'element',
  '@rightxt/tracker-react': 'react',
  '@rightxt/tracker-vanilla': 'vanilla',
  '@rightxt/tracker-vue': 'vue',
});
const executeFile = promisify(execFile);

/** Returns every relative local target referenced by a package export tree. */
function collectExportTargets(value) {
  if (typeof value === 'string') {
    return value.startsWith('./') ? [value.slice(2)] : [];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return Object.values(value).flatMap(collectExportTargets);
}

/** Runs the repository-declared pnpm version without a command shell. */
async function runPnpm(arguments_, options) {
  const pnpmCli = process.env.npm_execpath;
  const corepackCli = resolve(dirname(process.execPath), 'node_modules/corepack/dist/corepack.js');
  const executable = pnpmCli === undefined && process.platform !== 'win32' ? 'corepack' : process.execPath;
  const args =
    pnpmCli === undefined
      ? [...(process.platform === 'win32' ? [corepackCli] : []), 'pnpm', ...arguments_]
      : [pnpmCli, ...arguments_];

  try {
    return await executeFile(executable, args, {
      ...options,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const detail = typeof error?.stderr === 'string' && error.stderr.trim() !== '' ? `\n${error.stderr.trim()}` : '';
    throw new Error(`pnpm ${arguments_.join(' ')} failed.${detail}`, { cause: error });
  }
}

/** Reads one publishable workspace manifest without requiring built artifacts. */
async function readWorkspacePackage(packageName) {
  const directoryName = PACKAGE_DIRECTORY_BY_NAME[packageName];
  if (directoryName === undefined) {
    throw new Error(`Unknown publishable workspace package ${packageName}.`);
  }
  const directory = resolve(REPOSITORY_ROOT, 'packages', directoryName);
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));

  return { directory, directoryName, manifest };
}

/** Requires every local export target before creating a publication artifact. */
async function assertBuiltExportTargets(workspacePackage) {
  const { directory, manifest } = workspacePackage;
  const missingTargets = [];

  for (const target of new Set(collectExportTargets(manifest.exports))) {
    try {
      await access(resolve(directory, target));
    } catch {
      missingTargets.push(target);
    }
  }
  if (missingTargets.length > 0) {
    throw new Error(
      `${manifest.name} is missing built export artifacts:\n- ${missingTargets.join('\n- ')}\nRun "pnpm packages:build" first.`,
    );
  }
}

/**
 * Creates real pnpm publication tarballs from workspace package directories.
 *
 * pnpm owns workspace-protocol rewriting. Callers receive the actual packed
 * manifest/file list and must not maintain a second publication transform.
 */
async function packWorkspacePackages(packageNames, destination) {
  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });

  const results = [];
  for (const packageName of [...new Set(packageNames)].sort()) {
    const workspacePackage = await readWorkspacePackage(packageName);
    await assertBuiltExportTargets(workspacePackage);
    const { stdout } = await runPnpm(
      ['--dir', workspacePackage.directory, 'pack', '--json', '--pack-destination', destination],
      { cwd: REPOSITORY_ROOT },
    );
    const parsed = JSON.parse(stdout);
    const packResult = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof packResult?.filename !== 'string' || !Array.isArray(packResult.files)) {
      throw new Error(`pnpm pack returned invalid metadata for ${packageName}.`);
    }
    const tarball = resolve(destination, basename(packResult.filename));
    await access(tarball);
    results.push({ ...workspacePackage, files: packResult.files.map(({ path }) => path), tarball });
  }

  return results;
}

/** Returns all supported public package names. */
function getPublishablePackageNames() {
  return Object.keys(PACKAGE_DIRECTORY_BY_NAME).sort();
}

/**
 * Resolves the published package name of a publishable workspace directory.
 *
 * Package names are not derivable from directory names by string concatenation,
 * so callers must resolve them through the mapping rather than build a specifier.
 *
 * @param {string} directoryName - Directory name under `packages/`.
 * @returns {string} Published package name.
 */
function getPublishablePackageName(directoryName) {
  const packageName = Object.keys(PACKAGE_DIRECTORY_BY_NAME).find(
    (name) => PACKAGE_DIRECTORY_BY_NAME[name] === directoryName,
  );
  if (packageName === undefined) {
    throw new Error(`Unknown publishable workspace package directory ${directoryName}.`);
  }

  return packageName;
}

export {
  PACKAGE_DIRECTORY_BY_NAME,
  collectExportTargets,
  getPublishablePackageName,
  getPublishablePackageNames,
  packWorkspacePackages,
  readWorkspacePackage,
};
