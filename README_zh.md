# dsh-plugin-lab 插件市场

[English](README.md) | [中文](README_zh.md)

一个 URL，把 [dsh-plugin-lab](https://github.com/dsh-plugin-lab) 的全部插件放进 DSH 的「发现」页：
名称、描述、图标和可安装版本，一个都不用配。

## 把它加进 DSH

1. 在 **插件** 里打开 **自定义插件市场**，启用它。
2. 打开 **插件 → 发现**，点 **添加索引源**，把下面这个 URL 粘进去：

   ```text
   https://dsh-plugin-lab.github.io/market/index.json
   ```

3. 插件就出现在列表里。挑一个装上即可。

## 它列出哪些插件

[github.com/dsh-plugin-lab](https://github.com/dsh-plugin-lab) 里的全部插件。列表是从 npm 读的，
所以那边发布什么，这里就跟什么 —— 没有一份手写的清单等着过期。

## 多久更新一次

GitHub Actions 每小时重读一次 npm 并重新发布；这个仓有改动时立刻重发。某一轮生成了什么、什么时候
生成的，看 [status.json](https://dsh-plugin-lab.github.io/market/status.json)。

每个条目只带最新稳定版。要装旧版本或预发布版本，用 `dsh plugin add` 指定那个版本号。

## 给维护者

索引是生成物，从不手改：

| 路径                                                 | 是什么                                            |
| ---------------------------------------------------- | ------------------------------------------------- |
| [`plugins.txt`](plugins.txt)                         | 收录哪些 npm 包，以及展示顺序                     |
| [`config.json`](config.json)                         | 市场标题、分类、标签、排序键、逐插件策展          |
| [`scripts/build-index.mjs`](scripts/build-index.mjs) | 读上面两样加 npm，写出 `public/`                  |
| [`scripts/check-index.mjs`](scripts/check-index.mjs) | 用 DSH 读索引时用的同一个 format-1 校验器校验产物 |
| [`AGENTS.md`](AGENTS.md)                             | 在本仓干活的命令、规则与坑                        |
| [`docs/market-format.md`](docs/market-format.md)     | 产物字段的逐条参考                                |

本地跑 `pnpm run index` 即可构建加校验。
