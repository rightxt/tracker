import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { promisify } from 'node:util';

import {
  PUBLISHED_SOURCES_BRANCH,
  PRODUCTION_ARTIFACT_ROOT,
  PRODUCTION_SOURCES_ROOT,
  REPOSITORY_ROOT,
} from '../config.mjs';

/** Promise-based git process runner. */
const executeFile = promisify(execFile);

/** Explanation shown at the root of the generated source-snapshot branch. */
const PUBLISHED_SOURCES_README = `# Published demo sources

Generated standalone source snapshots for demos published on the Tracker website.

Do not edit this branch. Source files are maintained on \`main\` under \`site/demos/\`.
`;

/** GitHub Actions bot commit identity. */
const GITHUB_ACTIONS_BOT = Object.freeze({
  email: '41898282+github-actions[bot]@users.noreply.github.com',
  name: 'github-actions[bot]',
});

/**
 * Runs git and returns captured standard output.
 *
 * @param {string[]} arguments_ - Git arguments.
 * @param {{ cwd?: string }} [options] - Process options.
 * @returns {Promise<string>} Standard output.
 * @throws {Error} If git exits unsuccessfully.
 */
async function runGit(arguments_, { cwd = REPOSITORY_ROOT } = {}) {
  try {
    const { stdout } = await executeFile('git', arguments_, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail = typeof error?.stderr === 'string' && error.stderr.trim() !== '' ? `\n${error.stderr.trim()}` : '';
    throw new Error(`git ${arguments_.join(' ')} failed.${detail}`, { cause: error });
  }
}

/**
 * Checks whether the publication branch exists on origin.
 *
 * @returns {Promise<boolean>} Whether origin has the configured published-sources branch.
 */
async function remotePublishedSourcesBranchExists() {
  try {
    await executeFile(
      'git',
      ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${PUBLISHED_SOURCES_BRANCH}`],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
      },
    );
    return true;
  } catch (error) {
    if (error?.code === 2) {
      return false;
    }
    throw new Error(`Failed to inspect origin/${PUBLISHED_SOURCES_BRANCH}.`, { cause: error });
  }
}

/**
 * Clears the publication worktree except for its Git administrative file.
 *
 * @param {string} worktreeRoot - Linked worktree root.
 * @returns {Promise<void>} Resolves after the tree is empty.
 */
async function clearWorktree(worktreeRoot) {
  for (const entry of await readdir(worktreeRoot)) {
    if (entry !== '.git') {
      await rm(resolve(worktreeRoot, entry), { force: true, recursive: true });
    }
  }
}

/**
 * Copies standalone demo source snapshots into the publication worktree.
 *
 * @param {string} worktreeRoot - Linked worktree root.
 * @returns {Promise<void>} Resolves after the source snapshot tree is copied.
 */
async function copyPublishedSources(worktreeRoot) {
  const publishedSourcesRoot = PRODUCTION_SOURCES_ROOT;
  const destinationRoot = resolve(worktreeRoot, 'sources');
  await cp(publishedSourcesRoot, destinationRoot, {
    preserveTimestamps: true,
    recursive: true,
  });
  await writeFile(resolve(worktreeRoot, 'README.md'), PUBLISHED_SOURCES_README);
}

const buildInfo = JSON.parse(await readFile(resolve(PRODUCTION_ARTIFACT_ROOT, 'build-info.json'), 'utf8'));
const sourceRevision = (await runGit(['rev-parse', 'HEAD'])).trim();
if (
  buildInfo.siteMode !== 'production' ||
  buildInfo.trackerDependencySource !== 'npm' ||
  buildInfo.publishedSourcesBranch !== PUBLISHED_SOURCES_BRANCH ||
  buildInfo.sourceRevision !== sourceRevision
) {
  throw new Error('site-dist is not the verified production artifact for the current repository revision.');
}

await runGit(['check-ref-format', '--branch', PUBLISHED_SOURCES_BRANCH]);
const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'rxt-tracker-published-sources-'));
const worktreeRoot = resolve(temporaryRoot, 'worktree');
let worktreeAdded = false;

try {
  if (await remotePublishedSourcesBranchExists()) {
    await runGit([
      'fetch',
      '--no-tags',
      'origin',
      `refs/heads/${PUBLISHED_SOURCES_BRANCH}:refs/remotes/origin/${PUBLISHED_SOURCES_BRANCH}`,
    ]);
    await runGit(['worktree', 'add', '--detach', worktreeRoot, `refs/remotes/origin/${PUBLISHED_SOURCES_BRANCH}`]);
    worktreeAdded = true;
  } else {
    await runGit(['worktree', 'add', '--detach', worktreeRoot, 'HEAD']);
    worktreeAdded = true;
    await runGit(['switch', '--orphan', PUBLISHED_SOURCES_BRANCH], { cwd: worktreeRoot });
  }

  await clearWorktree(worktreeRoot);
  await copyPublishedSources(worktreeRoot);
  await runGit(['config', 'user.name', GITHUB_ACTIONS_BOT.name], { cwd: worktreeRoot });
  await runGit(['config', 'user.email', GITHUB_ACTIONS_BOT.email], { cwd: worktreeRoot });
  await runGit(['add', '--all'], { cwd: worktreeRoot });

  let hasChanges = true;
  try {
    await executeFile('git', ['diff', '--cached', '--quiet'], { cwd: worktreeRoot });
    hasChanges = false;
  } catch (error) {
    if (error?.code !== 1) {
      throw new Error('Failed to inspect staged published-source changes.', { cause: error });
    }
  }

  if (!hasChanges) {
    process.stdout.write(
      `Publication branch ${PUBLISHED_SOURCES_BRANCH} already contains the current demo source snapshots.\n`,
    );
  } else {
    await runGit(
      ['commit', '-m', `Publish demo sources for ${buildInfo.trackerVersion} (${sourceRevision.slice(0, 12)})`],
      {
        cwd: worktreeRoot,
      },
    );
    await runGit(['push', 'origin', `HEAD:refs/heads/${PUBLISHED_SOURCES_BRANCH}`], { cwd: worktreeRoot });
    process.stdout.write(`Published demo source snapshots to ${PUBLISHED_SOURCES_BRANCH}.\n`);
  }
} finally {
  if (worktreeAdded) {
    try {
      await runGit(['worktree', 'remove', '--force', worktreeRoot]);
    } catch {
      // The temporary directory is removed below; no persistent runner state remains.
    }
  }
  await rm(temporaryRoot, { force: true, recursive: true });
}
