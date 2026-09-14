import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import process from 'node:process';
import { promisify } from 'node:util';

/** Promisified process execution used for optional Git provenance. */
const executeFile = promisify(execFile);

/** Returns a SHA-256 digest for one value. */
function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Reads and hashes a repository file without making reporting depend on it. */
async function hashRepositoryFile(path) {
  try {
    return hashValue(await readFile(path));
  } catch {
    return 'unknown';
  }
}

/** Collects Git identity, including a content identity for dirty worktrees. */
async function collectGitIdentity() {
  try {
    const [{ stdout: commitOutput }, { stdout: diffOutput }, { stdout: statusOutput }, { stdout: untrackedOutput }] =
      await Promise.all([
        executeFile('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), windowsHide: true }),
        executeFile('git', ['diff', '--binary', 'HEAD'], {
          cwd: process.cwd(),
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        }),
        executeFile('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        }),
        executeFile('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        }),
      ]);
    const dirty = statusOutput !== '';
    const identity = createHash('sha256').update(diffOutput);
    const untrackedPaths = untrackedOutput
      .split('\0')
      .filter(Boolean)
      .sort((first, second) => first.localeCompare(second));

    for (const path of untrackedPaths) {
      identity.update(path);

      try {
        identity.update(await readFile(path));
      } catch {
        identity.update('<unreadable>');
      }
    }

    return {
      gitCommit: commitOutput.trim() || 'unknown',
      workingTreeDirty: dirty,
      workingTreeHash: dirty ? identity.digest('hex') : 'clean',
    };
  } catch {
    return {
      gitCommit: 'unknown',
      workingTreeDirty: 'unknown',
      workingTreeHash: 'unknown',
    };
  }
}

/**
 * Creates consistent asynchronous provenance for one benchmark report.
 *
 * @param {{ browser?: Record<string, unknown>, buildMode?: string, buildTarget: string, provenance: string }} options - Profile provenance.
 * @returns {Promise<Record<string, unknown>>} Shared source, runtime, build, and optional browser fields.
 */
async function collectBenchmarkEnvironment({ browser = undefined, buildMode = 'production', buildTarget, provenance }) {
  const [sourceIdentity, lockfileHash] = await Promise.all([
    collectGitIdentity(),
    hashRepositoryFile('pnpm-lock.yaml'),
  ]);

  return {
    ...(browser === undefined ? {} : { browser }),
    build: {
      mode: buildMode,
      provenance,
      target: buildTarget,
    },
    runtime: {
      architecture: process.arch,
      cpuModel: cpus()[0]?.model ?? 'unknown',
      nodeVersion: process.version,
      platform: process.platform,
    },
    source: {
      ...sourceIdentity,
      lockfileHash,
    },
  };
}

export { collectBenchmarkEnvironment };
