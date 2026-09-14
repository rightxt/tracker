import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';

import { SITE_ROOT } from '../config.mjs';

const REWRITABLE_EXTENSIONS = new Set(['.css', '.js', '.jsx', '.ts', '.tsx', '.vue']);

/**
 * Returns application-level shared resources required by one standalone demo consumer.
 *
 * @param {{ demoKind: string, route: string }} demo Catalog entry.
 * @returns {{ source: string, target: string }[]} Shared source-to-project mappings.
 */
function getSharedResources(demo) {
  const resources = [];
  if (demo.route !== 'recipes/document') {
    resources.push({ source: 'shared/application/base.css', target: 'src/shared/base.css' });
  }
  if (demo.demoKind === 'playground') {
    resources.push(
      { source: 'shared/playground/workbench.js', target: 'src/playground/workbench.js' },
      { source: 'shared/playground/styles.css', target: 'src/playground/styles.css' },
    );
  }
  if (demo.route.startsWith('scenarios/events/')) {
    resources.push(
      { source: 'shared/events/scenario.js', target: 'src/shared/scenario.js' },
      { source: 'shared/events/styles.css', target: 'src/shared/events.css' },
    );
  }
  return resources;
}

/**
 * Recursively lists rewritable source files below one project.
 *
 * @param {string} root Directory to inspect.
 * @returns {Promise<string[]>} Absolute file paths.
 */
async function listRewritableFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRewritableFiles(path)));
    } else if (entry.isFile() && REWRITABLE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Converts a relative filesystem path into an ESM/CSS import specifier.
 *
 * @param {string} path Relative filesystem path.
 * @returns {string} Slash-normalized relative import specifier.
 */
function toImportSpecifier(path) {
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

/**
 * Copies shared application files into a temporary standalone project.
 *
 * Repository-relative imports are rewritten to the copied paths; checked-in sources are not modified.
 *
 * @param {string} projectRoot Temporary project root.
 * @param {{ demoKind: string, route: string, source: string }} demo Catalog entry.
 * @returns {Promise<void>} Resolves after resources and imports are materialized.
 */
async function materializeSharedResources(projectRoot, demo) {
  const canonicalRoot = resolve(SITE_ROOT, demo.source);
  const projectFiles = await listRewritableFiles(projectRoot);
  const resources = getSharedResources(demo);

  for (const resource of resources) {
    const target = resolve(projectRoot, resource.target);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(SITE_ROOT, resource.source), target);
  }

  const replacementCounts = new Map(resources.map((resource) => [resource.source, 0]));
  for (const projectFile of projectFiles) {
    const canonicalFile = resolve(canonicalRoot, relative(projectRoot, projectFile));
    let contents = await readFile(projectFile, 'utf8');
    for (const resource of resources) {
      const canonicalSpecifier = toImportSpecifier(
        relative(dirname(canonicalFile), resolve(SITE_ROOT, resource.source)),
      );
      const localSpecifier = toImportSpecifier(relative(dirname(projectFile), resolve(projectRoot, resource.target)));
      if (contents.includes(canonicalSpecifier)) {
        contents = contents.replaceAll(canonicalSpecifier, localSpecifier);
        replacementCounts.set(resource.source, (replacementCounts.get(resource.source) ?? 0) + 1);
      }
    }
    await writeFile(projectFile, contents);
  }

  const unusedResources = resources.filter((resource) => replacementCounts.get(resource.source) === 0);
  if (unusedResources.length > 0) {
    throw new Error(
      `${demo.route} does not import required shared resources:\n${unusedResources.map((resource) => `- ${resource.source}`).join('\n')}`,
    );
  }
}

export { getSharedResources, materializeSharedResources, toImportSpecifier };
