import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { collectExportTargets, getPublishablePackageNames } from './workspace-pack.mjs';

/** Repository root used for release metadata and LICENSE checks. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');

/** Root files that every public package tarball must contain. */
const REQUIRED_ROOT_FILES = Object.freeze(['LICENSE', 'README.md', 'package.json']);

/**
 * Reads regular files from one gzip-compressed npm tarball.
 *
 * @param {string} tarballPath - Absolute or repository-relative tarball path.
 * @returns {Promise<Map<string, Buffer>>} Tar entry path to file contents.
 * @throws {Error} If the archive is truncated or contains an invalid size field.
 */
async function readTarFiles(tarballPath) {
  const archive = gunzipSync(await readFile(tarballPath));
  const files = new Map();
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/u, '');
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/u, '').trim();
    const size = Number.parseInt(sizeText === '' ? '0' : sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`${basename(tarballPath)} contains an invalid tar entry size for ${path}.`);
    }

    const contentOffset = offset + 512;
    const nextOffset = contentOffset + Math.ceil(size / 512) * 512;
    if (nextOffset > archive.length) {
      throw new Error(`${basename(tarballPath)} is truncated at ${path}.`);
    }

    const typeFlag = header[156];
    if (typeFlag === 0 || typeFlag === 48) {
      files.set(path, archive.subarray(contentOffset, contentOffset + size));
    }
    offset = nextOffset;
  }

  return files;
}

/**
 * Compares regular files in two npm tarballs byte-for-byte.
 *
 * Tar headers such as timestamps are ignored.
 *
 * @param {string} expectedTarballPath - Verified local release tarball.
 * @param {string} actualTarballPath - Tarball downloaded from the npm registry.
 * @param {{ actualLabel?: string, expectedLabel?: string }} [options] - Labels used in diagnostics.
 * @returns {Promise<void>} Resolves when both package file trees are identical.
 * @throws {Error} If a file is missing, unexpected, or has different contents.
 */
async function assertTarballContentsEqual(
  expectedTarballPath,
  actualTarballPath,
  { actualLabel = basename(actualTarballPath), expectedLabel = basename(expectedTarballPath) } = {},
) {
  const [expectedFiles, actualFiles] = await Promise.all([
    readTarFiles(expectedTarballPath),
    readTarFiles(actualTarballPath),
  ]);
  const paths = [...new Set([...expectedFiles.keys(), ...actualFiles.keys()])].sort();
  const differences = [];

  for (const path of paths) {
    const expectedFile = expectedFiles.get(path);
    const actualFile = actualFiles.get(path);
    if (expectedFile === undefined) {
      differences.push(`${path} exists only in ${actualLabel}`);
    } else if (actualFile === undefined) {
      differences.push(`${path} exists only in ${expectedLabel}`);
    } else if (!expectedFile.equals(actualFile)) {
      differences.push(`${path} has different contents`);
    }
  }

  if (differences.length > 0) {
    throw new Error(`${actualLabel} does not match ${expectedLabel}:\n- ${differences.join('\n- ')}`);
  }
}

/**
 * Verifies the complete six-package tarball set and its publication contracts.
 *
 * @param {string[]} tarballPaths - Tarballs to verify.
 * @param {{ expectedVersion?: string }} [options] - Expected lockstep version override.
 * @returns {Promise<Array<{ name: string, tarball: string, version: string }>>} Verified package metadata.
 * @throws {Error} If any tarball or the package set violates a publication contract.
 */
async function verifyPublicationTarballs(tarballPaths, { expectedVersion } = {}) {
  const rootManifest = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  const rootLicense = await readFile(resolve(REPOSITORY_ROOT, 'LICENSE'));
  const version = expectedVersion ?? rootManifest.version;
  const expectedNames = new Set(getPublishablePackageNames());
  const seenNames = new Set();
  const verifiedPackages = [];

  for (const tarballPath of [...tarballPaths].sort()) {
    const files = await readTarFiles(tarballPath);
    const manifestBuffer = files.get('package/package.json');
    if (manifestBuffer === undefined) {
      throw new Error(`${basename(tarballPath)} is missing package/package.json.`);
    }

    const manifestText = manifestBuffer.toString('utf8');
    const manifest = JSON.parse(manifestText);
    if (!expectedNames.has(manifest.name)) {
      throw new Error(`${basename(tarballPath)} declares unsupported package ${String(manifest.name)}.`);
    }
    if (seenNames.has(manifest.name)) {
      throw new Error(`Publication artifacts contain duplicate package ${manifest.name}.`);
    }
    seenNames.add(manifest.name);

    if (
      manifest.version !== version ||
      manifest.private !== false ||
      manifest.publishConfig?.access !== 'public' ||
      manifest.publishConfig?.registry !== 'https://registry.npmjs.org/'
    ) {
      throw new Error(`${manifest.name} tarball has invalid publication metadata for version ${version}.`);
    }
    if (manifestText.includes('workspace:')) {
      throw new Error(`${manifest.name} tarball still contains a workspace protocol.`);
    }
    if (manifest.name !== '@rightxt/tracker-core' && manifest.dependencies?.['@rightxt/tracker-core'] !== version) {
      throw new Error(`${manifest.name} tarball does not pin Core to ${version}.`);
    }

    const packageFiles = new Set(
      [...files.keys()].filter((path) => path.startsWith('package/')).map((path) => path.slice('package/'.length)),
    );
    for (const requiredFile of REQUIRED_ROOT_FILES) {
      if (!packageFiles.has(requiredFile)) {
        throw new Error(`${manifest.name} tarball is missing ${requiredFile}.`);
      }
    }
    if (!files.get('package/LICENSE')?.equals(rootLicense)) {
      throw new Error(`${manifest.name} tarball LICENSE does not match the workspace-root LICENSE.`);
    }
    for (const target of new Set(collectExportTargets(manifest.exports))) {
      if (!packageFiles.has(target)) {
        throw new Error(`${manifest.name} export target ${target} is missing from its tarball.`);
      }
    }

    const unexpectedFiles = [...packageFiles].filter(
      (path) => !REQUIRED_ROOT_FILES.includes(path) && !path.startsWith('dist/'),
    );
    if (unexpectedFiles.length > 0) {
      throw new Error(
        `${manifest.name} tarball contains files outside the publication roots:\n- ${unexpectedFiles.join('\n- ')}`,
      );
    }

    verifiedPackages.push({ name: manifest.name, tarball: tarballPath, version: manifest.version });
  }

  const missingPackages = [...expectedNames].filter((packageName) => !seenNames.has(packageName));
  if (missingPackages.length > 0 || seenNames.size !== expectedNames.size) {
    throw new Error(`Publication artifact set is incomplete:\n- ${missingPackages.join('\n- ')}`);
  }

  return verifiedPackages.sort((left, right) => left.name.localeCompare(right.name));
}

export { assertTarballContentsEqual, readTarFiles, verifyPublicationTarballs };
