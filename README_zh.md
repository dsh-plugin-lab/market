# dsh-plugin-lab 插件市场

[English](README.md) | [中文](README_zh.md)

一个 URL，把 [dsh-plugin-lab](https://github.com/dsh-plugin-lab) 的全部插件放进 DSH 的「发现」页：
名称、描述、图标和可安装版本，每个插件一条。

## 把它加进 DSH

1. 在 **插件** 里打开 **自定义插件市场**，启用它。
2. 打开 **插件 → 发现**，点 **添加索引源**，把下面这个 URL 粘进去：

   ```text
   https://dsh-plugin-lab.github.io/market/index.json
   ```

3. 插件就出现在列表里。挑一个装上即可。

## 它列出哪些插件

[github.com/dsh-plugin-lab](https://github.com/dsh-plugin-lab) 里的全部插件。列表从 npm 读，
那边发布什么这里就跟什么；这个仓里没有一份手写清单。

## 多久更新一次

每小时重建一次，本仓有改动时立即重建。
[status.json](https://dsh-plugin-lab.github.io/market/status.json) 记着上一轮生成了什么、什么时候。

每个条目只带最新稳定版。要装旧版本或预发布版本，直接指定版本号：
`dsh plugin add <包名>@<版本>`。

维护者：见 [AGENTS.md](AGENTS.md)。
