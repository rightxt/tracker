import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { verifyPublicationTarballs } from './lib/publication-artifacts.mjs';
import { getPublishablePackageNames, packWorkspacePackages } from './lib/workspace-pack.mjs';

/** Repository root used to read release metadata. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

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

const requestedVersion = readRequiredOption('version');
const outputRoot = resolve(REPOSITORY_ROOT, readRequiredOption('output'));
const rootManifest = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'));
if (requestedVersion !== rootManifest.version) {
  throw new Error(`Cannot prepare ${requestedVersion}; workspace version is ${rootManifest.version}.`);
}

const packedPackages = await packWorkspacePackages(getPublishablePackageNames(), outputRoot);
const verifiedPackages = await verifyPublicationTarballs(
  packedPackages.map(({ tarball }) => tarball),
  { expectedVersion: requestedVersion },
);

for (const verifiedPackage of verifiedPackages) {
  process.stdout.write(`Prepared ${verifiedPackage.name}@${verifiedPackage.version}: ${verifiedPackage.tarball}\n`);
}
