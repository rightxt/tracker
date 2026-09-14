import { isDeepStrictEqual } from 'node:util';

import { PACKAGE_DIRECTORY_BY_NAME } from './workspace-pack.mjs';

/** Package metadata fields managed by synchronization. */
const MANAGED_METADATA_FIELDS = Object.freeze([
  'author',
  'bugs',
  'files',
  'funding',
  'homepage',
  'keywords',
  'license',
  'name',
  'private',
  'publishConfig',
  'repository',
  'type',
  'version',
]);

/** Discovery keywords shared by every publishable Tracker package. */
const COMMON_KEYWORDS = Object.freeze([
  'dom',
  'markers',
  'minimap',
  'overview-ruler',
  'scroll',
  'scroll-marker',
  'scroll-navigation',
  'scrollbar',
  'tracker',
]);

/** Package-specific discovery keywords keyed by published package name. */
const PACKAGE_KEYWORDS_BY_NAME = Object.freeze({
  '@rightxt/tracker-angular': Object.freeze(['angular', 'angular-component']),
  '@rightxt/tracker-core': Object.freeze(['runtime']),
  '@rightxt/tracker-element': Object.freeze(['custom-element', 'light-dom', 'web-component']),
  '@rightxt/tracker-react': Object.freeze(['react', 'react-component']),
  '@rightxt/tracker-vanilla': Object.freeze(['browser']),
  '@rightxt/tracker-vue': Object.freeze(['vue', 'vue-component']),
});

/**
 * Files listed in every published package manifest.
 *
 * `LICENSE` is omitted here because pnpm adds the workspace-root license when packing; `verify-pack.mjs` checks it.
 */
const PUBLICATION_FILES = Object.freeze(['README.md', 'dist']);

/** Funding destinations published by every Tracker package. */
const PUBLICATION_FUNDING = Object.freeze(['https://ko-fi.com/igorxut', 'https://pay.cloudtips.ru/p/d4378494']);

/** Package-specific keys every publishable manifest must keep declaring itself. */
const REQUIRED_PACKAGE_FIELDS = Object.freeze(['description', 'exports']);

/**
 * Reports whether a value is a non-null, non-array object.
 *
 * @param {unknown} value - Value to classify.
 * @returns {boolean} True for plain objects eligible for per-key comparison.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively rebuilds a value with deterministic object key ordering.
 *
 * @param {unknown} value - Value to normalize.
 * @param {boolean} preserveOrder - When true, object keys keep their authored order instead of being
 *   sorted; the flag propagates into every nested value and is forced on for the `exports` subtree,
 *   whose condition order is semantically significant.
 * @returns {unknown} Normalized value of the same shape; arrays keep their element order.
 */
function sortManifestValue(value, preserveOrder) {
  if (Array.isArray(value)) {
    return value.map((element) => sortManifestValue(element, preserveOrder));
  }
  if (isPlainObject(value)) {
    const keys = preserveOrder ? Object.keys(value) : Object.keys(value).sort();
    const result = {};
    for (const key of keys) {
      result[key] = sortManifestValue(value[key], preserveOrder || key === 'exports');
    }
    return result;
  }
  return value;
}

/**
 * Appends dotted-path mismatches for one field, recursing into plain-object values.
 *
 * @param {string} path - Dotted path of the field being compared.
 * @param {unknown} currentValue - Value currently present in the manifest.
 * @param {unknown} expectedValue - Value the managed metadata policy expects.
 * @param {string[]} mismatches - Accumulator that receives formatted `path: <current> -> <expected>` lines.
 * @returns {void}
 */
function collectFieldMismatches(path, currentValue, expectedValue, mismatches) {
  if (isDeepStrictEqual(currentValue, expectedValue)) {
    return;
  }
  if (isPlainObject(currentValue) && isPlainObject(expectedValue)) {
    const keys = [...new Set([...Object.keys(currentValue), ...Object.keys(expectedValue)])].sort();
    for (const key of keys) {
      collectFieldMismatches(`${path}.${key}`, currentValue[key], expectedValue[key], mismatches);
    }
    return;
  }
  mismatches.push(`${path}: ${JSON.stringify(currentValue)} -> ${JSON.stringify(expectedValue)}`);
}

/**
 * Computes the centrally owned publication metadata for one publishable package.
 *
 * @param {Record<string, unknown>} rootManifest - Parsed workspace root manifest.
 * @param {string} packageName - Publishable workspace package name.
 * @returns {Record<string, unknown>} Managed metadata values for that package manifest.
 * @throws {Error} If the package is unknown, or a required root field is missing or mistyped.
 */
function computeManagedMetadata(rootManifest, packageName) {
  const directoryName = PACKAGE_DIRECTORY_BY_NAME[packageName];
  if (directoryName === undefined) {
    throw new Error(`Unknown publishable workspace package ${packageName}.`);
  }

  const packageKeywords = PACKAGE_KEYWORDS_BY_NAME[packageName];
  if (packageKeywords === undefined) {
    throw new Error(`Publication keywords are not configured for ${packageName}.`);
  }

  const { author, bugs, homepage, license, repository, type, version } = rootManifest;
  if (typeof author !== 'string') {
    throw new Error('The workspace root must declare "author" as a string.');
  }
  if (!isPlainObject(bugs)) {
    throw new Error('The workspace root must declare "bugs" as an object.');
  }
  if (typeof homepage !== 'string' || homepage.trim() === '') {
    throw new Error('The workspace root must declare "homepage" as a nonempty string.');
  }
  if (typeof license !== 'string') {
    throw new Error('The workspace root must declare "license" as a string.');
  }
  if (typeof version !== 'string') {
    throw new Error('The workspace root must declare "version" as a string.');
  }
  if (type !== 'module') {
    throw new Error('The workspace root must declare "type" as "module".');
  }
  if (!isPlainObject(repository) || typeof repository.type !== 'string' || typeof repository.url !== 'string') {
    throw new Error('The workspace root must declare "repository.type" and "repository.url" as strings.');
  }

  return {
    author,
    bugs: structuredClone(bugs),
    files: [...PUBLICATION_FILES],
    funding: [...PUBLICATION_FUNDING],
    homepage,
    keywords: [...new Set([...COMMON_KEYWORDS, ...packageKeywords])].sort(),
    license,
    name: packageName,
    private: false,
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    repository: {
      directory: `packages/${directoryName}`,
      type: repository.type,
      url: repository.url,
    },
    type,
    version,
  };
}

/**
 * Produces a manifest copy with every managed field replaced by its policy value.
 *
 * @param {Record<string, unknown>} manifest - Parsed package manifest used as the base of the copy.
 * @param {Record<string, unknown>} managed - Managed metadata from {@link computeManagedMetadata}.
 * @returns {Record<string, unknown>} New manifest object; the input is never mutated.
 */
function applyManagedMetadata(manifest, managed) {
  const next = { ...manifest };
  for (const field of MANAGED_METADATA_FIELDS) {
    next[field] = managed[field];
  }
  return next;
}

/**
 * Collects human-readable mismatches between a manifest and its expected managed metadata.
 *
 * @param {Record<string, unknown>} manifest - Parsed package manifest.
 * @param {Record<string, unknown>} managed - Managed metadata from {@link computeManagedMetadata}.
 * @returns {string[]} One `path: <currentJSON> -> <expectedJSON>` entry per differing field; empty when in sync.
 */
function diffManagedMetadata(manifest, managed) {
  const mismatches = [];
  for (const field of MANAGED_METADATA_FIELDS) {
    collectFieldMismatches(field, manifest[field], managed[field], mismatches);
  }
  return mismatches;
}

/**
 * Serializes a manifest value with deterministic key ordering and a trailing newline.
 *
 * Object keys are sorted lexicographically except inside `exports`, whose authored condition order is
 * preserved verbatim. Array element order is always preserved. The output is byte-identical to what
 * Prettier's `json-stringify` parser produces for a `package.json` file.
 *
 * @param {unknown} value - Manifest value to serialize.
 * @returns {string} Pretty-printed JSON text ending with a single newline.
 */
function stableStringify(value) {
  return `${JSON.stringify(sortManifestValue(value, false), null, 2)}\n`;
}

/**
 * Requires every package-owned field that metadata sync does not write.
 *
 * @param {Record<string, unknown>} manifest - Parsed package manifest.
 * @param {string} packageName - Publishable workspace package name, used in the error message.
 * @returns {void}
 * @throws {Error} If any {@link REQUIRED_PACKAGE_FIELDS} key is absent.
 */
function assertPackageSpecificFields(manifest, packageName) {
  const missingFields = REQUIRED_PACKAGE_FIELDS.filter((field) => manifest[field] === undefined);
  if (missingFields.length > 0) {
    throw new Error(`${packageName} package.json is missing package-specific fields: ${missingFields.join(', ')}.`);
  }
}

export {
  COMMON_KEYWORDS,
  MANAGED_METADATA_FIELDS,
  PACKAGE_KEYWORDS_BY_NAME,
  PUBLICATION_FILES,
  PUBLICATION_FUNDING,
  REQUIRED_PACKAGE_FIELDS,
  applyManagedMetadata,
  assertPackageSpecificFields,
  computeManagedMetadata,
  diffManagedMetadata,
  stableStringify,
};
