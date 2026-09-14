import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Repository root used to read the release version. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

/** Strict Semantic Versioning 2.0.0 pattern accepted for release workflow inputs. */
const RELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

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
 * Validates strict SemVer before the value is used in npm specs or Git refs.
 *
 * @param {string} version - Requested release version.
 * @throws {Error} If the version is not strict Semantic Versioning 2.0.0 text.
 */
function assertValidReleaseVersion(version) {
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(`Requested release version ${JSON.stringify(version)} is not a valid semantic version.`);
  }
}

const requestedVersion = readRequiredOption('version');
const syntaxOnly = process.argv.includes('--syntax-only');
assertValidReleaseVersion(requestedVersion);

if (syntaxOnly) {
  process.stdout.write(`Release version ${requestedVersion} has valid semantic-version syntax.\n`);
} else {
  const rootManifest = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'));

  if (requestedVersion !== rootManifest.version) {
    throw new Error(
      `Requested release version ${requestedVersion} does not match root package.json version ${rootManifest.version}.`,
    );
  }

  process.stdout.write(`Release version ${requestedVersion} matches the workspace root.\n`);
}
