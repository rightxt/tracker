import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { assertTarballContentsEqual, verifyPublicationTarballs } from './lib/publication-artifacts.mjs';

/** Repository root used to resolve release artifact directories. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

/** Core package name used by release stages. */
const CORE_PACKAGE_NAME = '@rightxt/tracker-core';

/** Minimum npm CLI version supported by npm Trusted Publishing. */
const MINIMUM_TRUSTED_PUBLISHING_NPM = Object.freeze([11, 5, 1]);

/** npm public registry URL used by release automation. */
const NPM_REGISTRY = 'https://registry.npmjs.org/';

/** Supported release-stage modes. */
const SUPPORTED_MODES = new Set(['core-preflight', 'core', 'packages', 'verify']);

/** Promise-based child process runner. */
const executeFile = promisify(execFile);

/** Whether the npm version check has already passed in this process. */
let trustedPublishingNpmVerified = false;

/**
 * Resolves an npm CLI invocation that does not rely on executing .cmd files directly on Windows.
 *
 * @param {string[]} args - npm CLI arguments.
 * @returns {{ args: string[], executable: string }} Platform-specific executable and arguments.
 */
function resolveNpmInvocation(args) {
  if (process.platform === 'win32') {
    return {
      args: [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args],
      executable: process.execPath,
    };
  }

  return { args, executable: 'npm' };
}

/**
 * Executes the npm CLI without requiring a command shell.
 *
 * @param {string[]} args - npm CLI arguments.
 * @param {{ encoding: 'utf8', maxBuffer?: number }} options - Child-process output options.
 * @returns {Promise<{ stderr: string, stdout: string }>} Captured npm output.
 */
function executeNpm(args, options) {
  const invocation = resolveNpmInvocation(args);
  return executeFile(invocation.executable, invocation.args, {
    ...options,
    windowsHide: true,
  });
}

/**
 * Reads one required --name=value CLI option.
 *
 * @param {string} name - Option name without leading dashes.
 * @returns {string} Option value.
 * @throws {Error} If the option is missing or empty.
 */
function readRequiredOption(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined || value === '') {
    throw new Error(`Missing required ${prefix}<value> option.`);
  }
  return value;
}

/**
 * Parses a dotted semantic version prefix into comparable numeric components.
 *
 * @param {string} value - Version text from a CLI.
 * @returns {number[]} Numeric major/minor/patch components.
 * @throws {Error} If the version does not begin with three numeric components.
 */
function parseVersionTriplet(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value.trim());
  if (match === null) {
    throw new Error(`Cannot parse semantic version from ${JSON.stringify(value)}.`);
  }
  return match.slice(1).map(Number);
}

/**
 * Compares two major/minor/patch version triplets.
 *
 * @param {number[]} left - Left triplet.
 * @param {number[]} right - Right triplet.
 * @returns {number} Negative, zero, or positive comparison result.
 */
function compareVersionTriplets(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

/** Requires an npm CLI new enough to perform Trusted Publishing. */
async function assertTrustedPublishingNpm() {
  if (trustedPublishingNpmVerified) {
    return;
  }

  const { stdout } = await executeNpm(['--version'], { encoding: 'utf8' });
  const current = parseVersionTriplet(stdout);
  if (compareVersionTriplets(current, MINIMUM_TRUSTED_PUBLISHING_NPM) < 0) {
    throw new Error(`npm ${stdout.trim()} is too old for Trusted Publishing; npm >= 11.5.1 is required.`);
  }
  trustedPublishingNpmVerified = true;
  process.stdout.write(`Using npm ${stdout.trim()} for Trusted Publishing.\n`);
}

/**
 * Checks whether an exact package version exists in npm.
 *
 * A 404 means the version is missing. Other registry errors are fatal.
 *
 * @param {string} packageName - Public package name.
 * @param {string} version - Exact release version.
 * @returns {Promise<boolean>} Whether the registry already contains the version.
 * @throws {Error} For registry failures other than a missing version.
 */
async function packageVersionExists(packageName, version) {
  try {
    const { stdout } = await executeNpm(
      ['view', `${packageName}@${version}`, 'version', '--json', `--registry=${NPM_REGISTRY}`],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout) === version;
  } catch (error) {
    const detail = `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`;
    if (/E404|404 Not Found/iu.test(detail)) {
      return false;
    }
    throw new Error(`Failed to query npm for ${packageName}@${version}.`, { cause: error });
  }
}

/**
 * Checks that an npm package matches the prepared tarball byte-for-byte.
 *
 * @param {{ name: string, tarball: string }} verifiedPackage - Prepared release artifact metadata.
 * @param {string} version - Exact release version.
 * @returns {Promise<void>} Resolves when the registry package matches the prepared artifact.
 */
async function assertPublishedPackageMatches(verifiedPackage, version) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tracker-release-'));
  try {
    const { stdout } = await executeNpm(
      [
        'pack',
        `${verifiedPackage.name}@${version}`,
        '--json',
        '--pack-destination',
        temporaryDirectory,
        `--registry=${NPM_REGISTRY}`,
      ],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    );
    const packResults = JSON.parse(stdout);
    const filename = Array.isArray(packResults) && packResults.length === 1 ? packResults[0]?.filename : undefined;
    if (typeof filename !== 'string' || filename === '') {
      throw new Error(`npm pack returned an unexpected result for ${verifiedPackage.name}@${version}.`);
    }

    await assertTarballContentsEqual(verifiedPackage.tarball, resolve(temporaryDirectory, filename), {
      actualLabel: `${verifiedPackage.name}@${version} from npm`,
      expectedLabel: 'the verified release artifact',
    });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

/**
 * Returns whether a package version is missing or matches the prepared tarball.
 *
 * @param {{ name: string, tarball: string }} verifiedPackage - Prepared release artifact metadata.
 * @param {string} version - Exact release version.
 * @returns {Promise<'existing' | 'missing'>} Current publication state.
 * @throws {Error} If an existing version differs from the prepared artifact or the registry query fails.
 */
async function inspectPackagePublicationState(verifiedPackage, version) {
  if (!(await packageVersionExists(verifiedPackage.name, version))) {
    return 'missing';
  }

  await assertPublishedPackageMatches(verifiedPackage, version);
  return 'existing';
}

/**
 * Requires a package to exist in npm and match the prepared tarball.
 *
 * @param {{ name: string, tarball: string }} verifiedPackage - Prepared release artifact metadata.
 * @param {string} version - Exact release version.
 * @returns {Promise<void>} Resolves when the package is available and verified.
 * @throws {Error} If the version is not visible yet or does not match the prepared artifact.
 */
async function requirePublishedPackage(verifiedPackage, version) {
  if ((await inspectPackagePublicationState(verifiedPackage, version)) === 'missing') {
    throw new Error(
      `${verifiedPackage.name}@${version} is not available from npm yet. ` +
        'Retry this stage after the version becomes readable; this stage will not republish it.',
    );
  }

  process.stdout.write(`${verifiedPackage.name}@${version} is available from npm and matches the verified artifact.\n`);
}

/**
 * Publishes one already-verified tarball through npm Trusted Publishing.
 *
 * @param {string} tarballPath - Tarball path.
 * @returns {Promise<void>} Resolves after npm accepts the package.
 */
async function publishTarball(tarballPath) {
  const { stdout, stderr } = await executeNpm(
    ['publish', tarballPath, '--access=public', '--provenance', `--registry=${NPM_REGISTRY}`],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  if (stdout.trim() !== '') {
    process.stdout.write(`${stdout.trim()}\n`);
  }
  if (stderr.trim() !== '') {
    process.stderr.write(`${stderr.trim()}\n`);
  }
}

/**
 * Publishes once and performs one registry check if npm reports an error.
 *
 * The error is reconciled only when npm already exposes the matching package.
 *
 * @param {{ name: string, tarball: string }} verifiedPackage - Prepared release artifact metadata.
 * @param {string} version - Exact release version.
 * @returns {Promise<void>} Resolves when npm accepts the publish or already exposes the matching package.
 */
async function publishOrConfirmTarball(verifiedPackage, version) {
  process.stdout.write(`Publishing ${verifiedPackage.name}@${version}.\n`);
  try {
    await publishTarball(verifiedPackage.tarball);
  } catch (error) {
    if (!(await packageVersionExists(verifiedPackage.name, version))) {
      throw new Error(
        `npm publish failed for ${verifiedPackage.name}@${version}, and the version is not yet readable from npm. ` +
          'Keep the release artifacts unchanged and retry this stage later.',
        { cause: error },
      );
    }

    await assertPublishedPackageMatches(verifiedPackage, version);
    process.stdout.write(
      `npm publish reported an error, but ${verifiedPackage.name}@${version} is present and matches ` +
        'the verified artifact; continuing.\n',
    );
  }
}

/**
 * Publishes a missing package or skips an existing matching version.
 *
 * @param {{ name: string, tarball: string }} verifiedPackage - Prepared release artifact metadata.
 * @param {string} version - Exact release version.
 * @returns {Promise<'published' | 'skipped'>} Publication result.
 */
async function publishMissingOrSkipMatching(verifiedPackage, version) {
  if ((await inspectPackagePublicationState(verifiedPackage, version)) === 'existing') {
    process.stdout.write(
      `${verifiedPackage.name}@${version} is already published and matches the verified artifact; skipping it.\n`,
    );
    return 'skipped';
  }

  await assertTrustedPublishingNpm();
  await publishOrConfirmTarball(verifiedPackage, version);
  return 'published';
}

/**
 * Checks all implementation packages before publishing any missing ones.
 *
 * @param {{ name: string, tarball: string }[]} verifiedPackages - Prepared implementation artifacts.
 * @param {string} version - Exact release version.
 * @returns {Promise<{ name: string, tarball: string }[]>} Missing packages to publish after preflight.
 */
async function preflightImplementationPackages(verifiedPackages, version) {
  const missingPackages = [];

  for (const verifiedPackage of verifiedPackages) {
    const state = await inspectPackagePublicationState(verifiedPackage, version);
    if (state === 'missing') {
      missingPackages.push(verifiedPackage);
      process.stdout.write(`${verifiedPackage.name}@${version} is missing and will be published after preflight.\n`);
    } else {
      process.stdout.write(`${verifiedPackage.name}@${version} already exists and matches the verified artifact.\n`);
    }
  }

  return missingPackages;
}

const requestedVersion = readRequiredOption('version');
const mode = readRequiredOption('mode');
if (!SUPPORTED_MODES.has(mode)) {
  throw new Error(`Unsupported --mode=${mode}; expected core-preflight, core, packages, or verify.`);
}

const artifactRoot = resolve(REPOSITORY_ROOT, readRequiredOption('directory'));
const tarballPaths = (await readdir(artifactRoot))
  .filter((name) => name.endsWith('.tgz'))
  .map((name) => resolve(artifactRoot, name));
const verifiedPackages = await verifyPublicationTarballs(tarballPaths, { expectedVersion: requestedVersion });
const corePackage = verifiedPackages.find(({ name }) => name === CORE_PACKAGE_NAME);
if (corePackage === undefined) {
  throw new Error(`Release artifact set is missing ${CORE_PACKAGE_NAME}.`);
}
const implementationPackages = verifiedPackages.filter(({ name }) => name !== CORE_PACKAGE_NAME);

if (mode === 'core-preflight') {
  const coreState = await inspectPackagePublicationState(corePackage, requestedVersion);
  if (coreState === 'missing') {
    process.stdout.write(`${CORE_PACKAGE_NAME}@${requestedVersion} is missing; the release tag can now be created.\n`);
  } else {
    process.stdout.write(
      `${CORE_PACKAGE_NAME}@${requestedVersion} already exists and matches the verified artifact; ` +
        'the release tag can now be created.\n',
    );
  }
} else if (mode === 'core') {
  await publishMissingOrSkipMatching(corePackage, requestedVersion);
  process.stdout.write(
    `Core publication stage for ${requestedVersion} is complete. ` +
      'Allow npm propagation before starting the packages stage.\n',
  );
} else if (mode === 'packages') {
  await requirePublishedPackage(corePackage, requestedVersion);

  const missingPackages = await preflightImplementationPackages(implementationPackages, requestedVersion);
  if (missingPackages.length > 0) {
    await assertTrustedPublishingNpm();
    for (const verifiedPackage of missingPackages) {
      await publishOrConfirmTarball(verifiedPackage, requestedVersion);
    }
  }

  process.stdout.write(
    `Implementation package publication stage for ${requestedVersion} is complete. ` +
      'Allow npm propagation before starting the finalize stage.\n',
  );
} else {
  for (const verifiedPackage of verifiedPackages) {
    await requirePublishedPackage(verifiedPackage, requestedVersion);
  }

  process.stdout.write(`All Tracker packages for ${requestedVersion} are available from npm and verified.\n`);
}
