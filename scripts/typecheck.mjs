import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Repository root used as the working directory for every TypeScript project check. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
/** Installed TypeScript CLI invoked for each configured project. */
const TYPESCRIPT_CLI = resolve(REPOSITORY_ROOT, 'node_modules/typescript/bin/tsc');

/** TypeScript projects whose distinct environments make up repository-wide checking. */
const TYPECHECK_PROJECTS = ['tsconfig.json', 'site/tsconfig.json'];

for (const project of TYPECHECK_PROJECTS) {
  execFileSync(process.execPath, [TYPESCRIPT_CLI, '--noEmit', '--project', project], {
    cwd: REPOSITORY_ROOT,
    stdio: 'inherit',
  });
}
