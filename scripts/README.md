# scripts/ — 模块定位索引

本文件回答「每个文件是什么、数据怎么流、改哪会波及谁」。改码要守的规则在 [AGENTS.md](AGENTS.md)；
为什么是这个形状在 [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)；产物字段契约在
[../docs/market-format.md](../docs/market-format.md)。

## 数据怎么流

一次构建只朝一个方向走，每一步只依赖上一步：

```
npm / GitHub / Pages          外部世界
      │  sources/              取成普通数据，不判断「缺了怎么办」
      ▼
 事实（packument、tarball、星标）
      │  domain/derive.mjs     推导：版本、时间戳、locale 文本、图标、作者
      ▼
 已发布事实（facts）
      │  domain/curation.mjs   决策：分类、标签、排序键
      ▼
 决策（category、labels、sortKeys）
      │  domain/assemble.mjs   拼装：facts + 决策 → format-1 条目
      ▼
 文档（index、status）
      │  build-index.mjs       写入 public/、build/diagnostics.json
      ▼
 读者拿到的东西
```

`domain/document.mjs` 与 `domain/status.mjs` 各自拼一个产物：前者是 format-1 文档，后者是构建记录。
两者都不读时钟、不联网，时间由调用方传进去。

**规矩**：`sources/` 只产出数据，`domain/` 不知道网络，命令层才决定「这算致命还是降级」。
四个入口彼此不调用。

## 四个入口

一个入口一种语义，退出码含义因此不同——这就是它们是四个文件而不是一个 `--mode` 的原因。

| 入口                                       | 定位                                       | 读什么                                                           | 写什么                                                                                | 失败意味着                                  |
| ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| [build-index.mjs](build-index.mjs)         | 生成：五个阶段串起来                       | 组织仓（自动发现）、`config.json`、npm、GitHub                   | `public/index.json`、`public/icons/*`、`public/status.json`、`build/diagnostics.json` | 输入坏了（致命）或数据不全（降级，写 code） |
| [check-index.mjs](check-index.mjs)         | 判定：产物合法吗、降级越界吗、今天装得上吗 | `public/`、`build/diagnostics.json`、`diagnostics-baseline.json` | 表格 + 退出码                                                                         | 契约被破坏，或出现基线外的降级              |
| [verify-deployed.mjs](verify-deployed.mjs) | 核对线上：读者拿到的字节是不是这一轮       | 线上 `index.json`、`status.json`、本地 `public/`                 | 表格 + 退出码                                                                         | 线上哈希与本轮不符                          |
| [check-org-drift.mjs](check-org-drift.mjs) | 核对现实：组织仓声明的版本与 npm 是否脱节  | GitHub 组织仓、各仓 `package.json`、registry                     | 控制台、可选 `build/org-drift.json`                                                   | 默认不失败：它报告漂移，由 CI 决定怎么用    |

## 库

| 模块                     | 定位（一句话）                                       | 它不做什么                     |
| ------------------------ | ---------------------------------------------------- | ------------------------------ |
| `shared/cli.mjs`         | 参数、日志、退出码：四个入口共用的那一套             | 不知道插件、市场、索引的存在   |
| `shared/http.mjs`        | 唯一的取数策略（重试、超时、是否跟随重定向）         | 不判断响应内容是什么           |
| `shared/concurrency.mjs` | `mapLimit`：限并发但不打乱顺序                       | 不重试、不合并请求             |
| `shared/table.mjs`       | 可变宽表格：按内容量宽度、可按列右对齐               | 不决定读哪份数据               |
| `shared/time.mjs`        | 一个瞬间按多个时区渲染（IANA 名，偏移现算）          | 不读时钟、不做格式转换以外的事 |
| `shared/tar.mjs`         | 极简 ustar 读取器：三种路径承载方式 + 截断保护       | 不认识 npm，不认识包内容       |
| `shared/text.mjs`        | 把 registry / manifest 的值变成 format-1 的值        | 不发请求、不写盘               |
| `shared/digest.mjs`      | 内容身份：一个文档的 sha256（build 与 verify 共用）  | 不知道什么内容算「新」         |
| `sources/npm.mjs`        | packument、tarball（含字节数）、最新 DSH 版本        | 不决定「读不到怎么办」         |
| `sources/github.mjs`     | 星标（带缓存）、组织仓清单、某仓的 manifest          | 同上                           |
| `sources/discovery.mjs`  | 名录从哪来：`dsh-` 仓 + `dsh` 字段 + 字母序          | 不做校验（那是 domain 的活）   |
| `sources/facts.mjs`      | 一个插件的三源合流：registry + tarball + 星标        | 不分类、不拼文档               |
| `sources/pages.mjs`      | 线上索引（带绕缓存参数）                             | 不比较、不判定                 |
| `domain/settings.mjs`    | **纯**：`config.json` → 带默认值的设置 + 组织名      | 不读文件、不联网               |
| `domain/derive.mjs`      | **纯**：packument + tarball → 已发布事实             | 不做分类决策、不写文件         |
| `domain/curation.mjs`    | **纯**：事实 + `config.json` → 分类/标签/排序键      | 不发起网络请求                 |
| `domain/roster.mjs`      | **纯**：名录校验 + 与策展的双向差异                  | 不决定差异该多响               |
| `domain/assemble.mjs`    | **纯**：事实 + 决策 → format-1 条目                  | 不重新推导任何字段             |
| `domain/document.mjs`    | **纯**：顶层字段 → format-1 文档                     | 不校验成员（契约表管）         |
| `domain/status.mjs`      | **纯**：本次构建记录（`content` / `build` / 每插件） | 不读时钟：时间由调用方传入     |
| `domain/compat.mjs`      | **纯**：默认版本、`engines.dsh` 是否满足             | 不知道索引在哪                 |
| `domain/contract.mjs`    | format-1 允许的成员表 + 遍历（build 与 check 共用）  | 不判断「该不该致命」           |
| `domain/diagnosis.mjs`   | 降级码 + 每个码的 severity + 棘轮比较（纯函数）      | 不决定某个码在某个入口算什么   |

## 变更影响路由

| 你改这里                       | 会波及                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `domain/derive.mjs` 的推导规则 | `test/model.test.mjs`；产物里版本/时间戳/图标的样子                                                       |
| `domain/curation.mjs`          | 分类与标签的判定；`config.json` 里那套 keyword 规则的含义                                                 |
| `domain/assemble.mjs`          | 条目的字段集合 → [../docs/market-format.md](../docs/market-format.md) 与 `check` 的契约遍历               |
| `domain/document.mjs`          | 索引顶层成员；`findUndefinedMembers` 会立刻拒绝多余的那个                                                 |
| `domain/status.mjs`            | `status.json` 的形状；`verify-deployed.mjs` 判据与部署去重（`build` 段以外都不许随时间变）                |
| `domain/compat.mjs`            | `check` 的兼容性表与「装得上吗」结论                                                                      |
| `domain/contract.mjs`          | **build 与 check 会同时变**，这是故意的：写什么与查什么是同一张表                                         |
| `domain/diagnosis.mjs` 的码表  | `diagnostics-baseline.json`、[../AGENTS.md](../AGENTS.md) 的降级说明、严重性测试                          |
| `sources/*`                    | 只影响取数；domain 不需要动                                                                               |
| `shared/http.mjs`              | 四个入口一起变——重试与超时是全局策略                                                                      |
| `shared/time.mjs`              | `status.json` 的 `localTimes`；时区列表在 `config.json` 的 `build.localTimeZones`                         |
| 任一入口的退出码语义           | `.github/workflows/build-market.yml` 里对它的调用与失败处理                                               |
| `public/status.json` 的字段    | `verify-deployed.mjs` 的判据（`content.hash`）、部署去重（`build` 段以外的内容）、README 对 status 的描述 |
