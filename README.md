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

The index is rebuilt every hour, and whenever this repository changes. Most of the time it updates
because a plugin published a new version in its own repository, not because someone committed here.
If nothing new was published, the index stays exactly as it is.

`index.json` has no timestamp; [status.json](https://dsh-plugin-lab.github.io/market/status.json)
records when the current copy was built.

Maintainers: [AGENTS.md](AGENTS.md).
