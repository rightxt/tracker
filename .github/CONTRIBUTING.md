# Contributing to Tracker

Contributions are welcome. Tracker is a monorepo, so one change may legitimately affect several packages or project areas.

Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md) when participating in the project.

## Where to start

Use the channel that matches what you want to report or propose:

- **Bug:** open a Bug report issue, or submit a small, well-understood fix directly as a pull request.
- **Documentation error:** open a Documentation issue, or submit an obvious correction directly as a pull request.
- **Usage or integration question:** use GitHub Discussions in **Q&A**.
- **Feature, API, behavior, architecture, demo, benchmark, or tooling improvement:** start in GitHub Discussions under **Ideas** before investing in a substantial implementation.
- **Security vulnerability:** follow [SECURITY.md](./SECURITY.md). Do not disclose vulnerabilities in public issues, discussions, or pull requests.

Discuss substantial API, behavior, or architecture changes before implementing them.

## Pull requests

Keep each pull request focused on one logical goal. A single goal may require coordinated changes across Core, adapters, tests, documentation, the site, or other parts of the repository.

Draft pull requests are welcome when you want to show an approach before it is ready for final review.

If an issue or discussion already exists, link it from the pull request. When a pull request fully fixes an issue, GitHub closing keywords such as `Fixes #123` are appropriate.

A merged change does **not** imply a new npm release. Documentation, site, test, benchmark, and tooling changes may not require one, and package changes may be accumulated before the next release.

## Development setup

Use the Node.js and pnpm versions declared by the repository, then install dependencies from the workspace root:

```sh
corepack enable
pnpm install --frozen-lockfile
```

See the workflow-specific documentation:

- [`tests/README.md`](../tests/README.md) for the test architecture and browser/distribution verification.
- [`benchmarks/README.md`](../benchmarks/README.md) for benchmark prerequisites, profiles, and report comparison.
- [`site/README.md`](../site/README.md) for the documentation/demo/tooling site.

## Verification

Run the checks relevant to your change. CI runs the full project matrix, so contributors do not need to reproduce every browser and distribution check locally.

For code changes, run the applicable checks:

```sh
pnpm format:check
pnpm eslint
pnpm stylelint
pnpm typecheck
pnpm packages:test
pnpm packages:build
```

Use the more specific commands documented in the repository when changing browser behavior, distribution artifacts, the site, or benchmarks.

Bug fixes should include a regression test when practical. Update documentation when public API or user-visible behavior changes.

## Release-related files

Normal contributions should not prepare a release. In particular:

- Do not bump individual package versions or the workspace release version as part of an ordinary contribution.
- Do not decide the release's semantic version.
- Do not create release tags or publish packages.
- You are not required to update `CHANGELOG.md` for a normal pull request.
- Do not commit generated distribution output excluded from version control.

Maintainers handle release preparation separately. All public packages are versioned and released together.
