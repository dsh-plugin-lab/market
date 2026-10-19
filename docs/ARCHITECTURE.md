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
- **That record carries two identities, and they are not interchangeable.** `content.hash` is what a
  reader actually gets — the digest of the bytes written. `build.*` describes the run and changes every
  time. Verification compares the hash, because it is the only thing that distinguishes "the deployment
  served this build" from "the deployment served the previous generation at some earlier moment": two
  builds a second apart differ in time and agree in bytes, while a cached response agrees in time and
  differs in bytes. Per-plugin facts stay in a per-plugin list; a single total ("20 versions") answers
  no question anyone actually has.
- **Build and deploy are separate jobs, and verification is a third.** Only the deploy job holds a
  Pages environment and a write scope, so a pull request can run the whole build and validator and
  still not reach the live site. The `verify` job then asks the published URL, not the artifact: a
  deployment that silently serves the previous generation looks exactly like success from inside the
  run, and the only way to tell is to fetch what a reader would fetch.
- **Drift between a merge and a release is reported, never fixed.** The index is a snapshot of npm, so
  it cannot notice that a repository says `0.5.0` while npm still serves `0.4.0`; every check in this
  repository is correctly green while that gap exists. One plugin sat in it for two weeks behind an
  expired publish credential. The build therefore compares the organization's manifests with the
  registry and opens one tracking issue when they disagree. It does not release and it does not curate:
  both are decisions, and a machine that makes them would make the market claim what nobody chose.
- **A failed build opens an issue.** A scheduled workflow's failure notification reaches only whoever
  last edited the `cron` line, so a silent index would otherwise be the default outcome.
- **Degradation is recorded outside the product.** One plugin's broken packaging must not take the
  whole index down, so the build continues and loses something: display text, an icon, a version. Left
  in a log, that loss is invisible; put into `index.json`, it would be dropped by the reader (the
  format defines no member for it) and would put build metadata into the consumer's contract. So it
  goes to `build/diagnostics.json` — read by CI, uploaded as an artifact, never deployed — and the
  codes are ratcheted against a committed `diagnostics-baseline.json`. A new degradation fails `check`
  instead of scrolling past. Codes that depend on the machine (a star count, the current DSH version)
  are reported but never ratcheted, because a baseline that flips on environment alone teaches people
  to ignore it.
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
