import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createServer } from 'node:http';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DEV_ARTIFACT_ROOT } from '../config.mjs';
import { computeDevInputFingerprint } from './fingerprint.mjs';
import { resolveOwnedPath } from './paths.mjs';

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.srt': 'application/x-subrip; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

/**
 * Parses one HTTP byte range against a known representation size.
 *
 * @param {string | string[] | undefined} header Incoming Range header.
 * @param {number} size File size in bytes.
 * @returns {{ end: number, start: number } | null | undefined} Parsed range, null when invalid, or undefined when absent.
 */
function parseByteRange(header, size) {
  if (header === undefined) {
    return undefined;
  }
  if (typeof header !== 'string' || header.includes(',')) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (match === null || (match[1] === '' && match[2] === '') || size === 0) {
    return null;
  }

  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return { end: size - 1, start: Math.max(0, size - suffixLength) };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] === '' ? size - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { end: Math.min(requestedEnd, size - 1), start };
}

/**
 * Streams one static file with MIME, length, HEAD, and single-range support.
 *
 * @param {import('node:http').IncomingMessage} request Request.
 * @param {import('node:http').ServerResponse} response Response.
 * @param {string} filePath Absolute file path.
 * @returns {Promise<void>} Resolves after response headers and streaming are initialized.
 */
async function sendFile(request, response, filePath) {
  const fileStats = await stat(filePath);
  const range = parseByteRange(request.headers.range, fileStats.size);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream');

  if (range === null) {
    response.statusCode = 416;
    response.setHeader('Content-Range', `bytes */${String(fileStats.size)}`);
    response.end();
    return;
  }

  if (range === undefined) {
    response.statusCode = 200;
    response.setHeader('Content-Length', String(fileStats.size));
  } else {
    response.statusCode = 206;
    response.setHeader('Content-Length', String(range.end - range.start + 1));
    response.setHeader('Content-Range', `bytes ${String(range.start)}-${String(range.end)}/${String(fileStats.size)}`);
  }
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = range === undefined ? createReadStream(filePath) : createReadStream(filePath, range);
  stream.once('error', () => response.destroy());
  stream.pipe(response);
}

/**
 * Validates the development site artifact before opening a port.
 *
 * @param {string} artifactRoot Absolute site artifact root.
 * @returns {Promise<void>} Resolves when the existing artifact is serveable.
 */
async function verifyServeableArtifact(artifactRoot) {
  try {
    const buildInfo = JSON.parse(await readFile(resolve(artifactRoot, 'build-info.json'), 'utf8'));
    if (buildInfo.siteMode !== 'dev' || buildInfo.trackerDependencySource !== 'local') {
      throw new Error('Generated build-info.json does not describe a local development site build.');
    }
    const currentFingerprint = await computeDevInputFingerprint();
    if (buildInfo.inputFingerprint !== currentFingerprint) {
      throw new Error('Generated development site inputs are stale.');
    }
    const index = await stat(resolve(artifactRoot, 'index.html'));
    if (!index.isFile()) {
      throw new Error('Generated development site has no root index.html.');
    }
  } catch (error) {
    throw new Error(
      `Cannot start the site server because ${artifactRoot} is missing, stale, or invalid. Run "pnpm site:build:dev" first.`,
      { cause: error },
    );
  }
}

/**
 * Starts a static server rooted at the existing development artifact.
 *
 * @param {{ artifactRoot?: string, basePath?: string, port?: number }} options Server options.
 * @returns {Promise<import('node:http').Server>} Listening server.
 */
async function serve({ artifactRoot = DEV_ARTIFACT_ROOT, basePath = '/', port = 0 } = {}) {
  await verifyServeableArtifact(artifactRoot);
  const normalizedBasePath = `/${basePath.split('/').filter(Boolean).join('/')}${basePath === '/' ? '' : '/'}`;
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      if (!requestUrl.pathname.startsWith(normalizedBasePath)) {
        throw new Error('Request path is outside the configured site base path.');
      }
      const decodedPath = decodeURIComponent(requestUrl.pathname.slice(normalizedBasePath.length)).replace(/^\/+/, '');
      let filePath = resolveOwnedPath(artifactRoot, decodedPath);
      const fileStats = await stat(filePath);
      if (fileStats.isDirectory()) {
        filePath = resolveOwnedPath(filePath, 'index.html');
      }
      await sendFile(request, response, filePath);
    } catch {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('Not found');
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const listeningPort = typeof address === 'object' && address !== null ? address.port : port;
  console.log(`RXT Tracker site: http://127.0.0.1:${String(listeningPort)}${normalizedBasePath}`);
  return server;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await serve();
}

export { parseByteRange, sendFile, serve, verifyServeableArtifact };
