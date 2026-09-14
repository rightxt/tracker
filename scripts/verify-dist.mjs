/* eslint-disable no-console -- Distribution verification reports sequential contract boundaries. */

import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PACKAGE_DIRECTORY_BY_NAME } from './lib/workspace-pack.mjs';
import { runNodeScript, runTypeScriptFixture } from './test-process.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');

for (const [packageName, directoryName] of Object.entries(PACKAGE_DIRECTORY_BY_NAME)) {
  try {
    await access(resolve(REPOSITORY_ROOT, 'packages', directoryName, 'dist'));
  } catch {
    throw new Error(`${packageName} distribution is missing. Run "pnpm packages:build" first.`);
  }
}

const ARTIFACT_CHECKS = [
  'scripts/check-package-artifacts.mjs',
  'scripts/check-public-surface.mjs',
  'scripts/test-dist.mjs',
];
const CONSUMER_FIXTURES = [
  'tests/fixtures/tsconfig.core.json',
  'tests/fixtures/tsconfig.react.json',
  'tests/fixtures/tsconfig.vue.json',
  'tests/fixtures/tsconfig.angular.json',
];
const RETENTION_CHECKS = ['scripts/check-promise-retention.mjs', 'scripts/check-projection-renderer-retention.mjs'];

for (const script of ARTIFACT_CHECKS) {
  runNodeScript(script, { label: `distribution artifact contract: ${script}` });
}
for (const project of CONSUMER_FIXTURES) {
  runTypeScriptFixture(project);
}
for (const script of RETENTION_CHECKS) {
  runNodeScript(script, { label: `distribution runtime retention: ${script}`, nodeArguments: ['--expose-gc'] });
}
runNodeScript('tests/distribution/browser-artifact-smoke.mjs', {
  label: 'standalone browser distribution smoke: Chromium, Firefox, and WebKit',
});

console.log('\nAll existing package distribution contracts passed.');
