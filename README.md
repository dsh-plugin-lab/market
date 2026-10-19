# dsh-plugin-lab plugin market

The plugin market index for the `dsh-plugin-lab` organization. It is **not a plugin**: it publishes
one JSON file that DSH reads, and that file is generated, never written by hand.

Add this URL in DSH — **插件 → 发现 → 添加索引源**:

```text
https://dsh-plugin-lab.github.io/market/index.json
```

What a user gets from it is one list: every plugin in the organization, with its localized name and
description, icon, repository, and each published version together with its publish time, install
source and DSH compatibility range. The index is metadata only — the code is installed from npm.

## What this repository is

A market **index** in **format 1** of DSH's plugin market index format. Two things are deliberately
kept apart:

- **Metadata** — the market's own title, categories, labels, sort keys, and one entry per plugin.
  It lives here, and it is the only thing this repository owns.
- **Plugin source** — each plugin's npm package and repository, which is built, tested and published
  from that plugin's own repository and is never present here.

Two consequences: the index is a **build artifact**, reproducible from its three inputs, and the
only facts this repository authors itself are the curated ones.

## The constraint that decides the architecture

The build runs on a GitHub runner, where **no plugin checkout exists**. Nothing here may read a
plugin from disk. Every machine-derived fact therefore comes from npm:

- the **registry packument** (`GET https://registry.npmjs.org/<name>`) — versions, publish times,
  `engines.dsh`, `gitHead`, `repository`, `homepage`, `author`, `keywords`;
- the **published tarball** of the newest listed version — `locale/*.json` for the display text, and
  the icon file the package itself points at.

Curation — market title, categories, labels, sort keys, per-plugin categorization, overrides — is
the part no source can derive, so it is an input (`config.json`), not a lookup.

This is why a plugin's own repository cannot be the input even though it is where the source lives:
it is not checked out during the build, and adding a checkout per plugin would be a second mechanism
for facts npm already publishes.

## What it contains

| Path                                 | Role                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `plugins.txt`                        | The npm package names, one per line. **Its order is the index order**                        |
| `config.json`                        | All manual curation: market title, declarations, per-plugin curation, overrides, build knobs |
| `scripts/build-index.mjs`            | Reads both inputs plus npm; writes `public/index.json` and `public/icons/*`                  |
| `scripts/check-index.mjs`            | Validates the output with `parseMarketIndex`, and flags members the format lacks             |
| `docs/market-format.md`              | Field-by-field reference for the produced `index.json`                                       |
| `AGENTS.md`                          | Rules for working in this repository (Chinese, maintainer-facing)                            |
| `.github/workflows/build-market.yml` | When the build runs, and the deployment of `public/` to Pages                                |
| `public/`                            | Build output. Gitignored, deployed as an artifact, never committed                           |

## The three sources of truth

Each field has exactly one origin, and the three origins are checked independently:

1. **`plugins.txt`** — which plugins exist in the market, and in what default order.
2. **`config.json`** — everything a machine cannot decide: names the reader sees for categories and
   labels, which plugin belongs to which category, sort keys, and any override.
3. **npm** — everything about a published package: its versions, when they were published, what
   they require, and where they come from.

Which bucket a field falls into (rows are plugin fields unless marked otherwise):

| Field                                                                                | Bucket         | Comes from                                                    |
| ------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------- |
| membership and order                                                                 | curated        | `plugins.txt`                                                 |
| `name`                                                                               | curated        | the line in `plugins.txt`                                     |
| `versions[]`, `publishTimestamp`                                                     | automatic      | registry `versions` and `time`                                |
| `source`                                                                             | automatic      | npm by default; `git` pins the registry `gitHead`             |
| `engines.dsh`                                                                        | automatic      | registry manifest `engines.dsh`                               |
| `repository`                                                                         | automatic      | registry `repository`, `git+` prefix stripped                 |
| `homepage`                                                                           | automatic      | registry `homepage`, a `#readme` fragment kept                |
| `author`                                                                             | automatic      | registry `author`                                             |
| `metadata.keywords`                                                                  | automatic      | registry `keywords` minus `keywordBlocklist`, plus the name   |
| `icon`                                                                               | automatic      | the file the package's own `icon` field names                 |
| `title`, `description`                                                               | semi-automatic | tarball `locale/<lang>.json` → `meta.title` / `description`   |
| `metadata.category`, `.labels`                                                       | curated        | `config.json` `plugins.<name>`, else `keywordRules`           |
| `metadata.sortKeys` ids                                                              | curated        | `config.json` `plugins.<name>.sortKeys`                       |
| `metadata.sortKeys` values                                                           | automatic      | config numbers, or the GitHub API for `githubStars`           |
| index `title`, `description`                                                         | curated        | `config.json` `market`                                        |
| index `metadata.*`                                                                   | curated        | `config.json` `metadata`; unused declarations are pruned      |
| any `title` / `description` / `icon` / `author` / `homepage` / `repository` override | curated        | `config.json` `plugins.<name>`, wins over the automatic value |

The one value outside the three buckets is a sort key declared as `{ "githubStars": … }`: it is an
integer read from the GitHub API at build time, so it changes with no commit here.

## How the pipeline runs

One workflow, `.github/workflows/build-market.yml`, with two jobs, on four triggers. `push` and
`pull_request` are filtered to the files that define the index — `config.json`, `plugins.txt`,
`scripts/**`, `package.json`, the lockfile, and the workflow itself.

| Trigger                 | Why it exists                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------- |
| push to `main`          | an edited `plugins.txt` or `config.json` goes live immediately                     |
| pull request            | validated **before** it can reach `main`: build and validator only, never a deploy |
| manual dispatch         | a rebuild after a plugin publishes, or after an npm incident                       |
| schedule, every 6 hours | plugins publish without touching this repo, so the index polls                     |

- **`build`** — install, `pnpm run build`, `pnpm run check`, then upload the site artifact.
- **`deploy`** — `needs: build`, and skipped on pull requests
  (`if: github.event_name != 'pull_request'`). It publishes that artifact to GitHub Pages, and it is
  the only job with a write scope: the workflow carries top-level `permissions: contents: read`,
  while the deploy job adds `pages: write` and `id-token: write`. That split is what makes a
  pull-request run harmless.

What a run guarantees:

- **Validation gates the deployment.** `check` runs the official validator, which applies the rules
  DSH applies when it reads an index, so a rejected index never reaches the index URL — the previous
  one stays live. A pull request gets that validation without the deploy.
- **A run is reproducible from its inputs.** The build deletes `public/` before writing it, so there
  is no incremental state to rot; the same inputs and the same npm state produce the same file.

**A red run is the only signal.** A scheduled workflow's failure notification reaches only whoever
last edited the `cron` line, so "I heard nothing" is not evidence that the index is fresh.

## Adding a plugin

1. **Publish it to npm.** The index installs `name@version` from the registry; nothing is built from
   a checkout.
2. **Add one line to `plugins.txt`** — the exact package name, nothing else on the line.
3. **Curate it in `config.json` if needed**, under `"plugins": { "<name>": { … } }`: `category`,
   `labels`, `sortKeys`, or an override for `title` / `description` / `icon` / `author` /
   `homepage` / `repository`. Any category, label or sort key you name must already be declared in
   the top-level `"metadata"` block — the build fails otherwise, on purpose.
4. **Let the package describe itself.** A `locale/<lang>.json` in the tarball with `meta.title` and
   `meta.description` becomes the display text, and an `en` entry is required; the icon is whatever
   the package's own `icon` field points at.
5. **Open a pull request, then merge.** The pull request runs the build and the validator without
   deploying; merging to `main` republishes. There is nothing else to register: no plugin gets a
   file in this repository.

## Previewing the index locally

```sh
pnpm install --frozen-lockfile --config.node-linker=hoisted
pnpm run build          # node scripts/build-index.mjs  → public/index.json, public/icons/*
pnpm run check          # node scripts/check-index.mjs  → format 1 validation
pnpm run index          # build + check
pnpm run format         # prettier --write .
pnpm run format:check
```

- `build` needs the network: the npm registry, plus the GitHub API when a plugin declares a
  `githubStars` sort key.
- `check` validates what `build` wrote, so run it after any edit to `scripts/`, `config.json` or
  `plugins.txt`. It takes `--url <index-url>`, which is the URL relative icon references resolve
  against — useful when you serve `public/` yourself:
  `node scripts/check-index.mjs --url http://127.0.0.1:8080/index.json`.
- `check` also reads the newest published DSH from the registry and reports how many of each plugin's
  versions declare support for it, because a valid index can still be uninstallable on today's DSH.
  Override that reference with `--dsh <version>`; when the version cannot be read, the compatibility
  screen is skipped with a warning instead of failing the run.
- Both scripts print a summary table. Read it rather than trusting the exit code alone: every
  degraded case — no display title, no icon, an unreadable tarball, no GitHub stars — is a warning,
  not a failure.

## Language

Prose that renders outside this repository — this file and `docs/` — is English. `AGENTS.md` is
Chinese, maintainer-facing. Inside the index every localized text must carry `en`; a plugin may ship
additional lowercase language ids in its `locale/` directory, and those become extra languages on
that entry.

## What this repository deliberately does not do

- **No committed index.** `public/` is gitignored, built on the runner, deployed from there. A copy
  in git would be a second source of truth, and would drift the moment a plugin published.
- **No hand-written index.** The build removes `public/` before writing it, so a manual fix cannot
  survive the next run, and in CI it never existed. Curation belongs in `config.json`.
- **No plugin code and no plugin CI.** Each plugin is built, tested and published from its own
  repository; this one only records where to get it.
- **No facts npm does not publish in a form the format has.** There is no member in format 1 for npm
  `dist-tags`, download counts or deprecation, and the reader silently drops members the format does
  not define, so none of them are carried.
- **No retyping of machine facts.** Versions, publish times, `engines.dsh`, repository URLs,
  homepages, authors and keywords are read from the registry; typing them would create a second
  answer that goes stale silently.
- **No quiet skip of a listed plugin.** A name in `plugins.txt` that npm does not serve fails the
  build; the market never publishes an entry it could not describe.
