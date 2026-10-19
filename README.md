# dsh-plugin-lab plugin market

[English](README.md) | [中文](README_zh.md)

One URL that puts every plugin from [dsh-plugin-lab](https://github.com/dsh-plugin-lab) into DSH's
Discover tab: name, description, icon and an installable version, for each plugin, with nothing to
configure.

## Add it to DSH

1. In **Plugins**, open the **Experimental** section and enable **Custom plugin markets**.
   > Experimental. Adds a Discover tab to Plugins for browsing and installing bundles from plugin
   > market indexes you add.
2. Open **Plugins → Discover**, choose **Add index source**, and paste this URL:

   ```text
   https://dsh-plugin-lab.github.io/market/index.json
   ```

3. The plugins appear. Pick one and install it.

## Which plugins it lists

Every plugin in [github.com/dsh-plugin-lab](https://github.com/dsh-plugin-lab). The list is read from
npm, so it follows whatever that organization publishes — there is no hand-written catalogue here to
fall out of date.

## How fresh it is

A GitHub Actions job re-reads npm and republishes every hour, and immediately when this repository
changes. What that run produced, and when, is in
[status.json](https://dsh-plugin-lab.github.io/market/status.json).

Each entry carries its newest stable version only. To install an older or prerelease version, use
`dsh plugin add` with that version instead.

## For maintainers

The index is generated, never edited:

| Path                                                 | What it is                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| [`plugins.txt`](plugins.txt)                         | Which npm packages are listed, in display order                  |
| [`config.json`](config.json)                         | Market title, categories, labels, sort keys, per-plugin curation |
| [`scripts/build-index.mjs`](scripts/build-index.mjs) | Reads those inputs plus npm, writes `public/`                    |
| [`scripts/check-index.mjs`](scripts/check-index.mjs) | Validates the output with the format-1 validator DSH itself uses |
| [`AGENTS.md`](AGENTS.md)                             | Commands, rules and traps for working here                       |
| [`docs/market-format.md`](docs/market-format.md)     | Field-by-field reference for the produced index                  |

`pnpm run index` builds and validates locally.
