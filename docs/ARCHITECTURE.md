# dsh-plugin-lab plugin market — architecture

**This is the "why" layer.** Design decisions that should not change casually, and the constraints
behind them. Field-level contract: [market-format.md](market-format.md). Commands and operational
traps: [AGENTS.md](../AGENTS.md). No file list and no field table lives here on purpose.

## What it publishes

One generated `index.json` in DSH's plugin market format 1, plus `icons/*` and a `status.json`, served
from GitHub Pages. It is not a plugin and publishes no package: the code it describes is installed
from npm.

## The constraint that decides everything

The build runs on a GitHub runner, where **no plugin repository is checked out**. So no fact about a
plugin may come from reading its source.

Every machine fact comes from two published sources:

- the npm packument: versions, publish times, `engines`, `gitHead`, `repository`, `homepage`, `author`, `keywords`;
- the published tarball of the newest listed version: `locale/*.json` for display text, and the icon
  file the package itself points at.

This is also why the market cannot be fixed by editing a plugin's checkout, and why a change to a
plugin only reaches the index after that plugin publishes.

## Sources of truth

| Input                                  | Owns                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `plugins.txt`                          | which packages are listed, and in what order                                                                    |
| `config.json`                          | everything no source can derive: market title, categories, labels, sort keys, per-plugin curation and overrides |
| npm (+ the GitHub API for star counts) | every fact about a published package                                                                            |

Nothing else is authoritative. Curation lives only in `config.json`; the scripts hold no display
values, and no document keeps a second copy of the current category list.

## Decisions

- **The index is generated and never committed.** A committed copy would be a second source of truth
  that goes stale the moment a plugin publishes. `public/` is ignored and deployed as an artifact.
- **Five versions per plugin, prereleases included.** Enough history to roll back one or two releases,
  small enough that the index stays a few kilobytes rather than a full release archive. It does not
  change what DSH installs by default: the reader still picks the highest stable version. Anything
  older than the fifth is installed with `dsh plugin add <name>@<version>` and is deliberately not
  advertised. `build.maxVersionsPerPlugin` and `build.includePrerelease` reverse it.
- **Deployment happens only when `index.json` changed.** The deployment history then means "the
  content changed here" instead of 24 identical deploys a day.
- **`status.json` exists because the format has no time member.** With deployment deduplicated, the
  deployment history no longer answers "how old is this index", so the build writes its own record.
- **Build and deploy are separate jobs.** Only the deploy job holds a Pages environment and a write
  scope, so a pull request can run the whole build and validator and still not reach the live site.
- **A failed build opens an issue.** A scheduled workflow's failure notification reaches only whoever
  last edited the `cron` line, so a silent index would otherwise be the default outcome.
- **Display facts are passed through, not normalised.** `author`, `homepage` and `repository` appear as
  the package publishes them. When they disagree across packages, the fix belongs in those packages:
  an override here would hide the drift, not remove it.
- **Nothing that only matters to a maintainer lives in the README.** The front page answers what a
  reader does; this repository's file map and rules live in [AGENTS.md](../AGENTS.md).

## What it deliberately does not do

- No version number and no package: nothing is published from here.
- No plugin code, tests or CI for plugins: each plugin owns its own.
- No offline copy of the index, and no hand edit that could survive a rebuild.
- No members the format does not define. The reader drops them silently; there is no place for npm
  `dist-tags`, download counts or deprecation.
