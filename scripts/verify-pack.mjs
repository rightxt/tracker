import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

import { verifyPublicationTarballs } from './lib/publication-artifacts.mjs';
import { getPublishablePackageNames, packWorkspacePackages } from './lib/workspace-pack.mjs';

/** Temporary directory that owns disposable publication tarballs. */
const PACK_ROOT = await mkdtemp(resolve(tmpdir(), 'rxt-tracker-pack-'));

try {
  const packedPackages = await packWorkspacePackages(getPublishablePackageNames(), PACK_ROOT);
  const verifiedPackages = await verifyPublicationTarballs(packedPackages.map(({ tarball }) => tarball));

  for (const verifiedPackage of verifiedPackages) {
    process.stdout.write(`Verified publication tarball ${verifiedPackage.name}@${verifiedPackage.version}.\n`);
  }
} finally {
  await rm(PACK_ROOT, { force: true, recursive: true });
}
