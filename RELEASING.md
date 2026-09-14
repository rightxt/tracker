# Releasing

## Versioning policy

- All `@rightxt/tracker-*` packages use the same version and are released together, even when only some packages change.
- Implementation packages depend on `@rightxt/tracker-core` through `workspace:*`. pnpm rewrites this to the exact release version when packing.
- As of `1.0.0`, standard SemVer applies: breaking changes require a major version bump and must be listed in the changelog.
- A merge does not imply an npm release. Documentation, site, test, benchmark, and tooling changes can be shipped independently when package artifacts do not change.
- npm publication has three manual stages. Workflows do not sleep or poll for registry propagation between stages.

## Package metadata ownership

Publication metadata is defined in `scripts/lib/package-metadata.mjs`. `pnpm packages:metadata:sync` writes managed fields to package manifests, and `pnpm packages:metadata:check` verifies them in CI.

- **Centrally owned:** `author`, `bugs`, `funding`, `homepage`, `keywords`, `license`, `name`, `type`, `version`, `private` (`false`), `publishConfig` (`{ "access": "public", "registry": "https://registry.npmjs.org/" }`), `files` (`["README.md", "dist"]`), and `repository`. Do not edit these fields directly in package manifests. Values such as `author`, `bugs`, `homepage`, `license`, `type`, `version`, and `repository.type`/`repository.url` come from the root `package.json`. Package names, repository directories, publication settings, funding, files, and keywords are defined or derived by the metadata policy. `keywords` is the sorted union of shared and package-specific keywords.
- **Package-owned:** `description`, `exports`, `main`/`module`/`browser`/`types`/`unpkg`/`jsdelivr`, `sideEffects`, `dependencies`, `peerDependencies`, and `peerDependenciesMeta`. Metadata sync does not modify these fields.
- Package directories do not contain `LICENSE`. pnpm copies the root `LICENSE` into each tarball, and `pnpm packages:verify:pack` compares it byte-for-byte with the root file.
- **Version bump:** update `version` in the root `package.json`, run `pnpm packages:metadata:sync`, and commit the root manifest with the six updated package manifests.

## Release preparation

1. **Set the version.** Update `version` in the root `package.json`, then run `pnpm packages:metadata:sync`.
2. **Update the changelog.** Move the `Unreleased` entries in `CHANGELOG.md` under `## [<version>] - <date>` and leave an empty `## [Unreleased]` section above it. GitHub Release notes are generated from this release section.
3. **Commit the release candidate to `main`.** Version manifests, changelog, source, tests, and documentation must describe the same release.
4. **Run the `Release` workflow manually from `main`.** Enter the version and select a stage. Pushes never publish npm packages.

## Manual release stages

`Release` has three stages: `core`, `packages`, and `finalize`. Run each stage manually from `main`. `core` creates `v<version>`; later stages build from that tag instead of the current `main`.

### Stage 1: `core`

Run `Release` with:

```text
version: <version>
stage: core
```

The workflow:

1. requires the dispatch to come from `main`;
2. verifies the version, package metadata, changelog, tag, and GitHub Release state;
3. runs the complete reusable CI workflow;
4. builds all six packages, creates the npm `.tgz` artifacts, and verifies their publication contracts;
5. waits for approval of the `npm-release` environment;
6. checks the existing npm state for `@rightxt/tracker-core@<version>` and fails if an existing package differs;
7. creates `v<version>` at the release commit, or verifies the existing tag points to that commit;
8. publishes Core if missing, or verifies and skips an existing matching package.

The tag is created before `npm publish`. If Core publication then fails, keep the tag and rerun the stage from the same release commit. A different source commit is rejected.

The stage then stops. It does not wait for npm propagation or publish the other packages.

Wait until Core is readable from npm before starting `packages`.

### Stage 2: `packages`

Run `Release` again with:

```text
version: <version>
stage: packages
```

The workflow is dispatched from `main` but builds from the existing `v<version>` tag. It:

1. rechecks release metadata and GitHub state against the tagged commit;
2. rebuilds and verifies all six package artifacts from that commit;
3. waits for approval of the `npm-release` environment;
4. verifies `@rightxt/tracker-core@<version>` from npm against the prepared Core artifact;
5. checks all five implementation-package versions and fails before publishing if any existing package differs;
6. publishes only the implementation packages that are missing, provided the full preflight succeeds.

If Core is not readable yet, the stage fails without attempting to republish it. Run the same stage again later.

The stage stops after all implementation-package publications are completed or confirmed. It does not wait for propagation or create the GitHub Release.

### Stage 3: `finalize`

After all six packages have had time to propagate, run:

```text
version: <version>
stage: finalize
```

The workflow builds from `v<version>` and then:

1. requires all six package versions to be readable from npm;
2. downloads each package with `npm pack` and compares its regular files byte-for-byte with the prepared release artifact;
3. fails if any package is missing or differs;
4. creates the GitHub Release from the matching `CHANGELOG.md` section, or reuses an existing matching Release.

`finalize` never runs `npm publish`.

## npm publication and recovery semantics

npm versions cannot be overwritten. Publication follows these rules:

- **Target package is missing and the current stage owns it:** publish it.
- **Target package exists and matches the prepared `.tgz`:** skip it and continue.
- **Target package exists but differs from the prepared `.tgz`:** fail. The implementation-package stage checks every existing adapter before publishing any missing adapter.
- **A prerequisite package is not readable from npm yet:** fail and rerun the same stage later. Do not publish it from another stage.
- **`npm publish` fails, but npm immediately exposes the matching package:** consider the publish successful and continue.
- **`npm publish` fails and the package is still unavailable:** fail without retry. Keep the release artifacts unchanged and rerun the same stage later. If the original publish succeeded, the rerun will detect and skip the matching package.

Do not change the version because a stage failed partway through. Do not publish a different artifact set under the same version.

The `v<version>` tag fixes the release source before the first npm publication. Later stages use that commit even if `main` advances. Any conflicting tag, commit, package artifact, or GitHub Release state stops the release.

## Site-only deployment

`Deploy site` is a separate manual workflow run from `main`. Pushes and release stages do not deploy the production site.

Site-only changes, such as documentation or demo updates, can therefore be deployed without a new npm version.

Production builds do not fall back to local packages. The version declared on `main` must already exist in npm, or the deployment fails.

The workflow copies only `site-dist/sources/**` to `published-sources`. If Git reports no changes, no commit or push is made. GitHub Pages is deployed from the full `site-dist/` artifact, not from that branch.

After an npm release, deploy the site only when the new version is readable from npm. A failed preflight can be rerun and never publishes npm packages.

## Local verification

CI defines the verification matrix used for merges and the initial `core` stage. To run the same checks locally from a clean state:

```sh
pnpm clean
pnpm install --frozen-lockfile
pnpm format:check
pnpm eslint
pnpm stylelint
pnpm typecheck
pnpm packages:metadata:check
pnpm packages:test
pnpm packages:test:browser:chromium
pnpm packages:test:browser:firefox
pnpm packages:test:browser:webkit
pnpm packages:build
pnpm packages:verify:dist
pnpm packages:verify:pack
pnpm benchmarks:test
pnpm site:test
pnpm site:build:dev
pnpm site:test:browser:chromium
```

`pnpm packages:test:coverage` is an optional check of the coverage configuration and is not part of the release gate. Run `pnpm release:verify:metadata` only after preparing the release version and changelog.

## Benchmarks

Full benchmark workloads are informational and are not part of the release gate.

They use built package artifacts and must run after `pnpm packages:build`:

```sh
pnpm packages:build
pnpm benchmarks:run
```

For a quick run of every benchmark profile without using the timings as performance data:

```sh
pnpm packages:build
pnpm benchmarks:run -- --smoke
```

See [`benchmarks/README.md`](benchmarks/README.md) for comparison workflows and report semantics.

## Notes

- The root `@rightxt/tracker-workspace` package is `private` and is never published.
- Package READMEs use absolute repository URLs so they render correctly on npm.
- `dist`, `.release`, `site-dist`, and `site/.work` are generated; do not edit or commit them.
- GitHub Release notes come from `CHANGELOG.md`.
- `published-sources` contains generated demo source snapshots. Development does not occur on that branch.
