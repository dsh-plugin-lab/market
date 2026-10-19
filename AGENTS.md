# dsh-market — 维护索引

本仓的产物不是文件，是一次构建：`plugins.txt` + `config.json` + npm 上已发布的事实 → `public/index.json`。
所以这里只有「改输入」和「重跑」，没有「改产物」。

- 职责：在本仓干活要遵守的规则、命令、运营坑。
- 不负责：对外说明 → [README.md](README.md)；为什么是这个形状 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；
  产物字段与格式约束 → [docs/market-format.md](docs/market-format.md)。

## 常用命令

| 目的                   | 命令                                                          |
| ---------------------- | ------------------------------------------------------------- |
| 装依赖（与锁文件一致） | `pnpm install --frozen-lockfile --config.node-linker=hoisted` |
| 跑脚本测试             | `pnpm run test`                                               |
| 构建索引               | `pnpm run build`                                              |
| 校验索引               | `pnpm run check`                                              |
| 构建 + 校验（验收）    | `pnpm run index`                                              |
| 全量验收               | `pnpm run verify`（test + index + format:check）              |
| 格式化                 | `pnpm run format` / `pnpm run format:check`                   |

- `check` 读的是 `public/index.json` 与 `build/diagnostics.json`，必须先 build；`pnpm run index` 是两步连跑。
- `build` 要联网：npm registry；声明了 `githubStars` 排序键时还要 GitHub API。
- 图标按索引 URL 解析，本地自测用 `node scripts/check-index.mjs --url http://127.0.0.1:8080/index.json`。
- 退出码 0 不够：输出表要读（见「验证方式」）。

## 全局规则

- **`config.json` 是策展的唯一入口。** 分类、标签、排序键、市场标题、每插件覆盖值全在这里；脚本里不写这些值，
  任何文档也不许再记一份「当前分类表」。
- **不要手改 `public/`。** 它被 `.gitignore` 与 `.prettierignore` 排除，`build` 每次先整个删掉再写。
  手改在本地活不过下一次构建，在线上根本到不了。
- **加插件只动 `plugins.txt` 和 `config.json` 两个文件。** `plugins.txt` 加一行（顺序即展示顺序），
  要策展就在 `config.json` 的 `plugins.<name>` 里写。不要在别处登记第二份插件清单。
- **名录里有、npm 上没有 = 构建失败。** 先发版再进名录，这一步不可跳过。
- **声明面成对改。** 写 `category` / `labels` / 排序键 id，必须同时在根 `metadata` 声明同名项，否则 build 直接失败。
  反方向：没人引用的声明会被 prune 并留 WARN —— 看到就该删声明或补引用。
- **语言策略。** 门面双语两件，首行互链，格式照组织主页（`dsh-plugin-lab/.github` 的 `profile/README.md`）；
  **改一份就同改另一份**。`docs/` 只英文，本文件只中文。索引里的文案另受 format 约束，见 [docs/market-format.md](docs/market-format.md)。
- **门面三条不许。** 不写死插件数量与名字（清单只指向组织仓）；不写阶段标签（「实验性」会转正）；
  不写维护者文件清单（那是本文档地图的活）。UI 位置描述同样不写，它会重排。
- **校验必须过 `check`，但绿只证明格式合法。** 内容对不对是另一件事，见「验证方式」。
- **本仓不发版、不出包。** `private: true`，产物是 Pages 上的静态文件；版本与发布归各插件仓。

## 活跃坑

只收运营向的坑；格式语法不在此列，见 [docs/market-format.md](docs/market-format.md)。

1. **`dist-tags.latest` 不进索引。** format 1 没有这个成员。`build` 只拿它做一致性检查：稳定的 `latest`
   不在列出版本里就 fail，预发布的 `latest` 只 WARN。不要「顺手补一个 distTag 字段」。
2. **定时失败只发给最后改 cron 的人。** 所以失败时工作流自己开或评论一条固定标题 issue
   （`[market] the index build is failing`），下一次成功自动关掉。**「没人报错」不等于「跑绿了」**：
   结论在 Actions 和那条 issue 里，不在收件箱里。
3. **`status.json` 才是「这份索引多新」的答案。** 部署只在内容变化时发生，`deploy` 被 skipped 是设计而非假绿，
   判据在 `build`。索引自己不带时间。
4. **只列最近五个版本（含预发布），更旧的装不到。** `build.maxVersionsPerPlugin: 5` +
   `build.includePrerelease: true` 决定这一点。回滚到第五个之前、或装未列出的预发布，用
   `pnpm add <name>@<version>` 直装，别去索引里找。要恢复全量把 `maxVersionsPerPlugin` 写 `0`。
   **默认版本不受影响**：读者永远选「最高的非预发布版本」，列了预发布也不会让它变成默认。
5. **降级不报错，但会被棘轮抓住。** 每条降级带一个稳定 code，写进 `build/diagnostics.json`（不进产物）。
   `check` 比对 `diagnostics-baseline.json`：**出现基线没有的 code 就红**，基线里留着不再发生的 code 也提示。
   所以「星标拿不到 → 星标排序整项消失」「tarball 读不到 → 标题与图标一起退回包名」这类静默退化，现在会在
   PR 上红，而不是等用户说「这插件怎么是空白的」。要接受某个降级，就在同一次提交里把 code 加进基线。
   `stars-unavailable` / `dsh-version-unavailable` 属环境相关（本地无 token 会撞限流），只报告不进棘轮。
6. **展示字段一律透传，不在本仓美化。** `author` / `homepage` / `repository` 是包自己发布的值；写法不一致或为空时，
   正解是回源改 + 发版。在 `config.json` 覆盖会把漂移藏起来，下次照样漂。

## 文档地图

一份文件只干一件事，改之前先确认它的 home。

| 文件                                                                                                    | 身份（谁读它）                                                        |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [README.md](README.md) · [中文](README_zh.md)                                                           | 门面：怎么加索引源、列哪些插件（任何打开本仓的人）                    |
| [AGENTS.md](AGENTS.md)                                                                                  | 本仓规则层：命令、规则、运营坑（在这里干活的维护者与 agent）          |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                                            | 设计决策：为什么读 npm 不读插件仓、为什么不提交索引、为什么分两个 job |
| [docs/market-format.md](docs/market-format.md)                                                          | 产物契约：format 1 每个字段的来源与约束，含完整示例                   |
| [config.json](config.json)                                                                              | 策展入口：标题、声明、每插件 curation、build 开关                     |
| [plugins.txt](plugins.txt)                                                                              | 名录与默认顺序                                                        |
| [scripts/build-index.mjs](scripts/build-index.mjs) · [scripts/check-index.mjs](scripts/check-index.mjs) | 生成与校验的全部逻辑，也是「字段从哪来」的执行体                      |
| `.github/workflows/build-market.yml`                                                                    | 何时跑、失败怎么报、怎么发到 Pages                                    |

三条边界（越界即缺陷）：

- 格式约束只住 [docs/market-format.md](docs/market-format.md)；本文件指向它，不抄第二份。
- 设计论证只住 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；本文件只留结论性的「不许做什么」。
- 用户步骤只住 [README.md](README.md)；本文件不重复。

## 待办

- [ ] 组织仓 `dsh-plugin-lab/.github` 的组织主页与文档地图补一行本仓入口。

## 验证方式

本地跑 `pnpm run index`，然后：

- 读 `build` 的表：每插件的版本数、最新版、语言列表、标题。
- 读 `check` 的表：默认版本、`engines.dsh`、`runs on`（几个版本声明支持当前最新 DSH）、图标有无，以及每插件的安装 spec。
- `runs on` 是格式外的第二判据：**索引合法不代表今天装得上**，上游抬一代按钮就变灰而索引不报错。参照版本用 `--dsh`。
- WARN 逐条读：版本被跳过、标题退回包名、图标缺失、星标拿不到，都只体现在这里。

线上看三处：Pages 上的 `index.json` 内容对得上、`/status.json` 的 `builtAt` 与 `dsh` 符合预期、那次 Actions 绿
（或 `deploy` skipped 且 `build` 绿）。
