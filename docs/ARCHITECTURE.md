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
| the organization repositories          | which packages are listed (discovered), and in what order (alphabetical by package name)                        |
| `config.json`                          | everything no source can derive: market title, categories, labels, sort keys, per-plugin curation and overrides |
| npm (+ the GitHub API for star counts) | every fact about a published package                                                                            |

Nothing else is authoritative. Curation lives only in `config.json`; the scripts hold no display
values, and no document keeps a second copy of the current category list.

## What data exists, and who owns it

Four kinds, and the boundary between them decides most of the design.

| Data                          | Written by            | Lives                       | May a reader depend on it          |
| ----------------------------- | --------------------- | --------------------------- | ---------------------------------- |
| the organization repositories | GitHub, at build time | while the repository exists | no — it is an input, not an output |
| `config.json`                 | a human               | commits forever             | no                                 |
| `index.json` + `icons/`       | the build, every run  | one deployment at a time    | **yes** — this is the contract     |
| `status.json`                 | the build, every run  | one deployment at a time    | no — it describes the build        |
| `build/diagnostics.json`      | the build, every run  | one CI run (artifact)       | no — it describes build quality    |
| `diagnostics-baseline.json`   | a human               | commits forever             | no                                 |

Three rules follow, and they are the whole of the data policy:

- **Only what is published is contract.** `index.json` is deployed and read; everything else is either
  an input to producing it or a report about producing it. Build quality never enters the artifact,
  because format 1 has no member for it and the reader would drop it silently anyway.
- **The build is a projection, not a database.** Each run recomputes everything from npm and the two
  hand-written files. There is no incremental state to get out of sync, no cache to invalidate, and no
  way for yesterday's failure to leak into today's output. The cost is refetching every package on
  every run; the benefit is that any run can be reproduced from its inputs alone.
- **The schedule is a queue entry, not a promise.** The workflow asks for an hourly build, and GitHub
  throttles cron on busy public repositories: measured over three days, 14 runs landed where 72 were
  configured, at gaps of 3.3 to 5.7 hours. That is why the front page says "several times a day"
  rather than "hourly" — it states what a reader gets. Raising the frequency does not buy freshness,
  because the throttle answers load rather than intent; release-time freshness would need the plugin
  repositories to send a `repository_dispatch`, which is a decision about that organization, not this
  one. A stale index is visible without a faster clock, because `status.json` carries the build time.
- **Facts are fetched, decisions are written.** Sort keys, categories and overrides are decisions and
  live in `config.json`; versions, timestamps and texts are facts and are never stored here. An
  override that merely repeats a published fact is reported as dead weight (`override-redundant`)
  rather than kept "just in case" — a cached degradation nobody revisits is how a repository rots.

## Decisions

- **The index is generated and never committed.** A committed copy would be a second source of truth
  that goes stale the moment a plugin publishes. `public/` is ignored and deployed as an artifact.
- **Every published version, prereleases included; deprecated ones are not.** The cap exists —
  `build.maxVersionsPerPlugin` — and it is set to `0`, which means no cap: a package's whole published
  history is a few kilobytes, so history is not where bytes are worth saving. What is excluded is not
  policy but the registry saying "do not install this": a deprecated version carries a reason, and
  format 1 has no member to mark it with, so listing it would invite exactly that failure. Deprecations
  are dropped before any cap is applied, so a cap counts versions a reader can actually install. None
  of this changes what DSH installs by default: the reader still picks the highest stable version, and
  listing prereleases never makes one the default. `build.maxVersionsPerPlugin: N` and
  `build.includePrerelease` reverse it.
- **Deployment happens only when the published set changed.** The deployment history then means "the
  content changed here" instead of 24 identical deploys a day. "The published set" is both files a
  reader fetches: the index by its bytes, and `status.json` by its **shape** — `content`, `plugins`,
  which keys `build` carries, and which zones `localTimes` names — never by its times. Shape can change
  while content does not, and a record that grew a member while the index stood still would otherwise
  never reach a reader; two such members (`content.hash`, per-package sizes) sat undeployed until a
  plugin happened to publish. Comparing times instead would deploy hourly, which is what deduplication
  exists to prevent. The line is therefore: **a new member deploys once, a new timestamp never does.**
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
  to ignore it. The codes themselves, and the severity each carries, are declared once in
  [`scripts/lib/domain/diagnosis.mjs`](../scripts/lib/domain/diagnosis.mjs); what to _do_ about a new
  one is in [AGENTS.md](../AGENTS.md), not here.
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
