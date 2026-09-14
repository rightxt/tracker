import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  applyManagedMetadata,
  assertPackageSpecificFields,
  computeManagedMetadata,
  diffManagedMetadata,
  stableStringify,
} from './lib/package-metadata.mjs';
import { getPublishablePackageNames, readWorkspacePackage } from './lib/workspace-pack.mjs';

/** Repository root used for publication metadata. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

/** Workspace root manifest used by the metadata policy. */
const rootManifest = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'));

/** True when the process runs read-only verification instead of writing manifests. */
const isCheckMode = process.argv.includes('--check');

/**
 * Reads one package manifest and compares it with the metadata policy.
 *
 * @param {string} packageName - Publishable workspace package name.
 * @returns {Promise<{ name: string, path: string, currentText: string, nextText: string, mismatches: string[] }>}
 *   The raw current file text, the expected serialized text, and any managed-field mismatches.
 * @throws {Error} If the manifest is not valid JSON, omits a package-specific field, or the root omits a managed field.
 */
async function inspectPackage(packageName) {
  let workspacePackage;
  try {
    workspacePackage = await readWorkspacePackage(packageName);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${packageName}: package.json is not valid JSON`);
    }
    throw error;
  }

  const { directory, manifest } = workspacePackage;
  const manifestPath = resolve(directory, 'package.json');
  const currentText = await readFile(manifestPath, 'utf8');

  assertPackageSpecificFields(manifest, packageName);
  const managed = computeManagedMetadata(rootManifest, packageName);

  return {
    currentText,
    mismatches: diffManagedMetadata(manifest, managed),
    name: packageName,
    nextText: stableStringify(applyManagedMetadata(manifest, managed)),
    path: manifestPath,
  };
}

const inspections = [];
for (const packageName of getPublishablePackageNames()) {
  inspections.push(await inspectPackage(packageName));
}

if (isCheckMode) {
  const drifted = inspections.filter((inspection) => inspection.mismatches.length > 0);
  if (drifted.length === 0) {
    process.stdout.write('Package metadata is in sync.\n');
  } else {
    const details = drifted
      .map((inspection) => `  ${inspection.name}\n${inspection.mismatches.map((line) => `    - ${line}`).join('\n')}`)
      .join('\n');
    process.stderr.write(
      `Package metadata drift detected in ${drifted.length} package(s). Run \`pnpm packages:metadata:sync\`.\n\n${details}\n`,
    );
    process.exitCode = 1;
  }
} else {
  let updatedCount = 0;
  for (const inspection of inspections) {
    if (inspection.currentText === inspection.nextText) {
      process.stdout.write(`${inspection.name}: unchanged\n`);
    } else {
      await writeFile(inspection.path, inspection.nextText, 'utf8');
      updatedCount += 1;
      process.stdout.write(`${inspection.name}: updated\n`);
    }
  }
  process.stdout.write(`${updatedCount} updated, ${inspections.length - updatedCount} unchanged.\n`);
}
