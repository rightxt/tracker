import process from 'node:process';

import { readReleaseNotes } from './extract-release-notes.mjs';

/** GitHub REST API root. */
const GITHUB_API_ROOT = 'https://api.github.com';

/** GitHub REST API version used by release automation. */
const GITHUB_API_VERSION = '2022-11-28';

/** Supported command modes. */
const SUPPORTED_MODES = new Set(['anchor', 'check', 'publish']);

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
 * Reads one optional --name=value CLI option.
 *
 * @param {string} name - Option name without leading dashes.
 * @returns {string | undefined} Option value when supplied.
 */
function readOptionalOption(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

/**
 * Reads one required environment variable.
 *
 * @param {string} name - Environment variable name.
 * @returns {string} Environment variable value.
 * @throws {Error} If the variable is missing or empty.
 */
function readRequiredEnvironmentVariable(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required ${name} environment variable.`);
  }
  return value;
}

/**
 * Normalizes release notes before comparison.
 *
 * @param {string} value - Markdown text.
 * @returns {string} Normalized text.
 */
function normalizeReleaseNotes(value) {
  return value.replace(/\r\n?/gu, '\n').trim();
}

/**
 * Calls the GitHub REST API and parses one JSON response.
 *
 * @param {string} path - API path beginning after /repos or another root resource.
 * @param {{ allowNotFound?: boolean, body?: object, method?: string }} [options] - Request options.
 * @returns {Promise<object | null>} Parsed response, or null for an allowed 404.
 * @throws {Error} If GitHub returns an unexpected response.
 */
async function requestGitHubJson(path, { allowNotFound = false, body, method = 'GET' } = {}) {
  const token = readRequiredEnvironmentVariable('GITHUB_TOKEN');
  const response = await fetch(`${GITHUB_API_ROOT}/${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (allowNotFound && response.status === 404) {
    return null;
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub API ${method} ${path} failed with HTTP ${response.status}: ${responseText || response.statusText}`,
    );
  }
  if (responseText === '') {
    return {};
  }

  return JSON.parse(responseText);
}

/**
 * Resolves a Git tag object, including nested annotated tags, to its commit SHA.
 *
 * @param {string} repository - owner/repository identifier.
 * @param {{ sha: string, type: string }} object - Git object descriptor from the GitHub API.
 * @param {number} [depth] - Current annotated-tag nesting depth.
 * @returns {Promise<string>} Commit SHA.
 * @throws {Error} If the object is unsupported or tag nesting is unreasonable.
 */
async function resolveGitObjectCommitSha(repository, object, depth = 0) {
  if (object.type === 'commit') {
    return object.sha;
  }
  if (object.type !== 'tag') {
    throw new Error(`Release tag points to unsupported Git object type ${JSON.stringify(object.type)}.`);
  }
  if (depth >= 8) {
    throw new Error('Release tag contains too many nested annotated tags.');
  }

  const annotatedTag = await requestGitHubJson(`repos/${repository}/git/tags/${object.sha}`);
  return resolveGitObjectCommitSha(repository, annotatedTag.object, depth + 1);
}

/**
 * Resolves a release tag to its commit SHA through the GitHub Git database API.
 *
 * @param {string} repository - owner/repository identifier.
 * @param {string} tagName - Release tag name.
 * @returns {Promise<string | null>} Commit SHA, or null when the tag does not exist.
 */
async function getTagCommitSha(repository, tagName) {
  const reference = await requestGitHubJson(`repos/${repository}/git/ref/tags/${encodeURIComponent(tagName)}`, {
    allowNotFound: true,
  });
  return reference === null ? null : resolveGitObjectCommitSha(repository, reference.object);
}

/**
 * Creates the release tag at the selected commit.
 *
 * @param {string} repository - owner/repository identifier.
 * @param {string} tagName - Release tag name.
 * @param {string} commitSha - Commit SHA to anchor.
 * @returns {Promise<void>} Resolves after GitHub creates the tag reference.
 */
async function createReleaseTag(repository, tagName, commitSha) {
  await requestGitHubJson(`repos/${repository}/git/refs`, {
    method: 'POST',
    body: {
      ref: `refs/tags/${tagName}`,
      sha: commitSha,
    },
  });
}

/**
 * Reads an existing GitHub Release by tag.
 *
 * @param {string} repository - owner/repository identifier.
 * @param {string} tagName - Release tag name.
 * @returns {Promise<object | null>} Release response, or null when no release exists.
 */
async function getReleaseByTag(repository, tagName) {
  return requestGitHubJson(`repos/${repository}/releases/tags/${encodeURIComponent(tagName)}`, {
    allowNotFound: true,
  });
}

/**
 * Checks an existing GitHub Release against the expected tag and release notes.
 *
 * @param {object} release - GitHub Release API response.
 * @param {{ expectedNotes: string, tagName: string }} expected - Expected release state.
 * @throws {Error} If the existing release conflicts with the expected release.
 */
function assertReleaseMatches(release, { expectedNotes, tagName }) {
  const mismatches = [];
  if (release.tag_name !== tagName) {
    mismatches.push(`tag is ${JSON.stringify(release.tag_name)} instead of ${JSON.stringify(tagName)}`);
  }
  if (release.name !== tagName) {
    mismatches.push(`name is ${JSON.stringify(release.name)} instead of ${JSON.stringify(tagName)}`);
  }
  if (release.draft !== false) {
    mismatches.push('release is still a draft');
  }
  if (release.prerelease !== false) {
    mismatches.push('release is marked as a prerelease');
  }
  if (normalizeReleaseNotes(String(release.body ?? '')) !== normalizeReleaseNotes(expectedNotes)) {
    mismatches.push('release notes differ from the matching CHANGELOG.md section');
  }

  if (mismatches.length > 0) {
    throw new Error(`Existing GitHub Release ${tagName} conflicts with this release:\n- ${mismatches.join('\n- ')}`);
  }
}

const version = readRequiredOption('version');
const mode = readRequiredOption('mode');
if (!SUPPORTED_MODES.has(mode)) {
  throw new Error(`Unsupported --mode=${mode}; expected anchor, check, or publish.`);
}

const repository = readRequiredEnvironmentVariable('GITHUB_REPOSITORY');
const expectedCommitSha = readOptionalOption('commit') ?? readRequiredEnvironmentVariable('GITHUB_SHA');
if (!/^[0-9a-f]{40}$/iu.test(expectedCommitSha)) {
  throw new Error(`Expected release commit must be a full 40-character Git SHA, received ${expectedCommitSha}.`);
}

const tagName = `v${version}`;
const expectedNotes = await readReleaseNotes(version);
let existingTagCommitSha = await getTagCommitSha(repository, tagName);

if (existingTagCommitSha !== null && existingTagCommitSha !== expectedCommitSha) {
  throw new Error(
    `Existing tag ${tagName} points to ${existingTagCommitSha}, but this release uses ${expectedCommitSha}.`,
  );
}

const existingRelease = await getReleaseByTag(repository, tagName);
if (existingRelease !== null) {
  if (existingTagCommitSha === null) {
    throw new Error(`GitHub Release ${tagName} exists, but its tag cannot be resolved.`);
  }
  assertReleaseMatches(existingRelease, { expectedNotes, tagName });
}

if (mode === 'anchor') {
  if (existingTagCommitSha === null) {
    await createReleaseTag(repository, tagName, expectedCommitSha);
    existingTagCommitSha = await getTagCommitSha(repository, tagName);
    if (existingTagCommitSha !== expectedCommitSha) {
      throw new Error(
        `Created tag ${tagName} resolves to ${String(existingTagCommitSha)}, expected ${expectedCommitSha}.`,
      );
    }
    process.stdout.write(`Created release anchor tag ${tagName} at ${expectedCommitSha}.\n`);
  } else {
    process.stdout.write(`Release anchor tag ${tagName} already points to ${expectedCommitSha}; reusing it.\n`);
  }
} else if (mode === 'check') {
  if (existingRelease !== null) {
    process.stdout.write(`GitHub Release ${tagName} already exists and matches this release.\n`);
  } else if (existingTagCommitSha === null) {
    process.stdout.write(`GitHub Release ${tagName} has no conflicting tag or release state.\n`);
  } else {
    process.stdout.write(`Tag ${tagName} already points to the expected commit and may be reused.\n`);
  }
} else if (existingRelease !== null) {
  process.stdout.write(`GitHub Release ${tagName} already exists and matches this release; reusing it.\n`);
} else if (existingTagCommitSha === null) {
  throw new Error(`Cannot publish GitHub Release ${tagName}: release tag does not exist.`);
} else {
  const createdRelease = await requestGitHubJson(`repos/${repository}/releases`, {
    method: 'POST',
    body: {
      body: expectedNotes,
      draft: false,
      generate_release_notes: false,
      name: tagName,
      prerelease: false,
      tag_name: tagName,
    },
  });
  const createdTagCommitSha = await getTagCommitSha(repository, tagName);
  if (createdTagCommitSha !== expectedCommitSha) {
    throw new Error(
      `Published tag ${tagName} resolves to ${String(createdTagCommitSha)}, expected ${expectedCommitSha}.`,
    );
  }
  assertReleaseMatches(createdRelease, { expectedNotes, tagName });
  process.stdout.write(`Published GitHub Release ${tagName}.\n`);
}
