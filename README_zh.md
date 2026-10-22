# dsh-plugin-lab 插件市场

[English](README.md) | [中文](README_zh.md)

一个 URL，把 [dsh-plugin-lab](https://github.com/dsh-plugin-lab) 的全部插件放进 DSH 的「发现」页：
名称、描述、图标和可安装版本，每个插件一条。

## 怎么把它加进 DSH

1. 在 **插件** 里打开 **自定义插件市场**，启用它。
2. 打开 **插件 → 发现**，点 **添加索引源**，把下面这个 URL 粘进去：

   ```text
   https://dsh-plugin-lab.github.io/market/index.json
   ```

3. 插件就出现在列表里。挑一个装上即可。

## 它列出哪些插件

[github.com/dsh-plugin-lab](https://github.com/dsh-plugin-lab) 里的全部插件。名录从组织的公开仓发现，
那边有什么这里就有什么；这个仓里没有一份手写清单。

每个条目列出该插件已发布的全部版本（含预发布）；npm 上被标记为废弃的版本不列。打开条目挑一个版本装上即可。

## 多久更新一次

索引每小时重建一次，这个仓库有改动时也会立即重建。多数时候，是某个插件在自己的仓库里发了新版本，
而不是这里有人提交。没有新版本发布时，索引就保持原样。

`index.json` 里没有时间；当前这份是什么时候生成的，记在
[status.json](https://dsh-plugin-lab.github.io/market/status.json)。

维护者：见 [AGENTS.md](AGENTS.md)。
