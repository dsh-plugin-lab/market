# dsh-plugin-lab plugin market

[English](README.md) | [中文](README_zh.md)

One URL that puts every plugin from [dsh-plugin-lab](https://github.com/dsh-plugin-lab) into DSH's
Discover tab: name, description, icon and an installable version, for each plugin.

## How to add it to DSH

1. In **Plugins**, open **Custom plugin markets**, and turn it on.
2. Open **Plugins → Discover**, choose **Add index source**, and paste this URL:

   ```text
   https://dsh-plugin-lab.github.io/market/index.json
   ```

3. The plugins appear. Pick one and install it.

## Which plugins it lists

Every plugin in [github.com/dsh-plugin-lab](https://github.com/dsh-plugin-lab). The list is discovered
from the organization's public repositories, so it follows what that organization publishes; nothing
is listed by hand here.

Each entry lists every published version, prereleases included. Versions its package marks deprecated
on npm are left out — open one and pick the version you want.

## How often it updates

The index rebuilds itself: several times a day, and right after any change that affects what it lists.
Nobody has to trigger a build. `index.json` carries no timestamp;
[status.json](https://dsh-plugin-lab.github.io/market/status.json) records when the copy you are
reading was built.

Maintainers: [AGENTS.md](AGENTS.md).
