import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Repository root containing CHANGELOG.md. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

/** Whether this module was invoked directly as a CLI rather than imported. */
const IS_DIRECT_EXECUTION =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

/**
 * Escapes a literal value for use in a regular expression.
 *
 * @param {string} value - Literal value.
 * @returns {string} Escaped regular-expression fragment.
 */
function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
 * Extracts release notes for one version from CHANGELOG.md.
 *
 * @param {string} version - Exact release version.
 * @returns {Promise<string>} Release notes without the version heading.
 * @throws {Error} If the release section is missing or empty.
 */
async function readReleaseNotes(version) {
  const changelog = await readFile(resolve(REPOSITORY_ROOT, 'CHANGELOG.md'), 'utf8');
  const headingPattern = new RegExp(`^## \\[${escapeRegularExpression(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`, 'mu');
  const heading = headingPattern.exec(changelog);
  if (heading === null) {
    throw new Error(`CHANGELOG.md has no release section for ${version}.`);
  }

  const contentStart = heading.index + heading[0].length;
  const followingHeading = /^## \[/gmu;
  followingHeading.lastIndex = contentStart;
  const nextHeading = followingHeading.exec(changelog);
  const contentEnd = nextHeading?.index ?? changelog.length;
  const releaseNotes = changelog.slice(contentStart, contentEnd).trim();
  if (releaseNotes === '') {
    throw new Error(`CHANGELOG.md release section ${version} is empty.`);
  }

  return releaseNotes;
}

if (IS_DIRECT_EXECUTION) {
  const version = readRequiredOption('version');
  const releaseNotes = await readReleaseNotes(version);
  process.stdout.write(`${releaseNotes}\n`);
}

export { readReleaseNotes };
