import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SITE_ROOT, '..');
const WORK_ROOT = resolve(SITE_ROOT, '.work');

const DEFAULT_PUBLISHED_SOURCES_BRANCH = 'published-sources';
const DEFAULT_SOURCE_REF = 'main';
const DEV_ARTIFACT_ROOT = resolve(WORK_ROOT, 'dev-site');
const DEV_BUILD_ROOT = resolve(WORK_ROOT, 'dev-build');
const DEV_CANDIDATE_ROOT = resolve(WORK_ROOT, 'dev-site-candidate');
const PUBLISHED_SOURCES_BRANCH = process.env.SITE_PUBLISHED_SOURCES_BRANCH ?? DEFAULT_PUBLISHED_SOURCES_BRANCH;
const PRODUCTION_ARTIFACT_ROOT = resolve(REPOSITORY_ROOT, 'site-dist');
const PRODUCTION_BUILD_ROOT = resolve(WORK_ROOT, 'production-build');
const PRODUCTION_CANDIDATE_ROOT = resolve(WORK_ROOT, 'production-site-candidate');
const REPOSITORY_URL = 'https://github.com/rightxt/tracker';
const SOURCE_REF = process.env.SITE_SOURCE_REF ?? DEFAULT_SOURCE_REF;

/** Default public base used by npm-facing documentation destinations. */
const DEFAULT_PUBLIC_URL = 'https://rightxt.github.io/tracker/';

/**
 * Normalizes an HTTPS deployment base without credentials, query, or fragment.
 *
 * @param {string} value Absolute public deployment base.
 * @returns {string} Normalized HTTPS URL ending in a slash.
 * @throws {Error} For malformed URLs or unsupported deployment base components.
 */
function normalizePublicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('SITE_PUBLIC_URL must be an absolute HTTPS base without credentials, query, or fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '')}/`;
  return url.href;
}

const PUBLIC_URL = normalizePublicUrl(process.env.SITE_PUBLIC_URL ?? DEFAULT_PUBLIC_URL);

export {
  DEFAULT_PUBLISHED_SOURCES_BRANCH,
  DEFAULT_PUBLIC_URL,
  DEFAULT_SOURCE_REF,
  DEV_ARTIFACT_ROOT,
  DEV_BUILD_ROOT,
  DEV_CANDIDATE_ROOT,
  PUBLISHED_SOURCES_BRANCH,
  PRODUCTION_ARTIFACT_ROOT,
  PRODUCTION_BUILD_ROOT,
  PRODUCTION_CANDIDATE_ROOT,
  PUBLIC_URL,
  REPOSITORY_ROOT,
  REPOSITORY_URL,
  SITE_ROOT,
  SOURCE_REF,
  WORK_ROOT,
  normalizePublicUrl,
};
