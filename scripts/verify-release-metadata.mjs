import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { computeManagedMetadata, diffManagedMetadata } from './lib/package-metadata.mjs';
import { getPublishablePackageNames, readWorkspacePackage } from './lib/workspace-pack.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const rootManifest = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'));

/** Escapes a literal value for use in a regular expression. */
function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Returns whether a YYYY-MM-DD value represents a real calendar date. */
function isIsoCalendarDate(value) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(value);
  if (match?.groups === undefined) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

if (rootManifest.private !== true || typeof rootManifest.version !== 'string') {
  throw new Error('The workspace root must be private and declare the release version.');
}

for (const packageName of getPublishablePackageNames()) {
  const { manifest } = await readWorkspacePackage(packageName);
  const mismatches = diffManagedMetadata(manifest, computeManagedMetadata(rootManifest, packageName));
  if (mismatches.length > 0) {
    throw new Error(
      `${packageName} publication metadata is out of sync:\n- ${mismatches.join('\n- ')}\n` +
        'Run "pnpm packages:metadata:sync".',
    );
  }
  if (packageName !== '@rightxt/tracker-core' && manifest.dependencies?.['@rightxt/tracker-core'] !== 'workspace:*') {
    throw new Error(`${packageName} must use the exact-version workspace policy for Core.`);
  }
}

await access(resolve(REPOSITORY_ROOT, 'LICENSE'));
const changelog = await readFile(resolve(REPOSITORY_ROOT, 'CHANGELOG.md'), 'utf8');
const unreleasedHeading = /^## \[Unreleased\]\s*$/mu.exec(changelog);
if (!/^# Changelog\s*$/mu.test(changelog) || unreleasedHeading === null) {
  throw new Error('CHANGELOG.md must contain a top-level Changelog title and an Unreleased section.');
}

const versionPattern = new RegExp(
  `^## \\[${escapeRegularExpression(rootManifest.version)}\\] - (?<date>\\d{4}-\\d{2}-\\d{2})\\s*$`,
  'gmu',
);
const versionHeadings = [...changelog.matchAll(versionPattern)];
if (versionHeadings.length !== 1) {
  throw new Error(`CHANGELOG.md must contain exactly one release section for version ${rootManifest.version}.`);
}

const versionHeading = versionHeadings[0];
if (versionHeading.index <= unreleasedHeading.index) {
  throw new Error(`CHANGELOG.md version ${rootManifest.version} must follow the Unreleased section.`);
}
if (!isIsoCalendarDate(versionHeading.groups.date)) {
  throw new Error(`CHANGELOG.md version ${rootManifest.version} must declare a real YYYY-MM-DD release date.`);
}

const unreleasedContent = changelog.slice(unreleasedHeading.index + unreleasedHeading[0].length, versionHeading.index);
if (unreleasedContent.trim() !== '') {
  throw new Error('CHANGELOG.md Unreleased section must be empty when release metadata is verified.');
}

process.stdout.write(`Release metadata is coherent for version ${rootManifest.version}.\n`);
