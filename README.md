# dsh-plugin-lab plugin market

[English](README.md) | [中文](README_zh.md)

One URL that puts every plugin from [dsh-plugin-lab](https://github.com/dsh-plugin-lab) into DSH's
Discover tab: name, description, icon and an installable version, for each plugin.

## Add it to DSH

1. In **Plugins**, open **Custom plugin markets**, and turn it on.
2. Open **Plugins → Discover**, choose **Add index source**, and paste this URL:

   ```text
   https://dsh-plugin-lab.github.io/market/index.json
   ```

3. The plugins appear. Pick one and install it.

## Which plugins it lists

Every plugin in [github.com/dsh-plugin-lab](https://github.com/dsh-plugin-lab). The list is read from
npm, so it follows whatever that organization publishes; nothing is listed by hand here.

## How fresh it is

Rebuilt every hour, and on every change to this repository.
[status.json](https://dsh-plugin-lab.github.io/market/status.json) says what the last build produced
and when.

Each entry lists its five newest versions, prereleases included — open one and pick the version you
want.

Maintainers: [AGENTS.md](AGENTS.md).
