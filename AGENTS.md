# dsh-market — 维护索引

本仓的产物不是文件，是**一次构建**：`plugins.txt` + `config.json` + npm 上已发布的事实 →
`public/index.json`。所以这里没有「改产物」这个动作，只有「改输入」和「重跑」。

**本文职责**：在本仓干活要遵守的规则、常用命令、坑。
**不负责**：对外说明 → [README.md](README.md)；字段语义 → [docs/market-format.md](docs/market-format.md)。

## 常用命令

| 目的                   | 命令                                                          |
| ---------------------- | ------------------------------------------------------------- |
| 装依赖（与锁文件一致） | `pnpm install --frozen-lockfile --config.node-linker=hoisted` |
| 构建索引               | `pnpm run build` → `node scripts/build-index.mjs`             |
| 校验索引               | `pnpm run check` → `node scripts/check-index.mjs`             |
| 构建 + 校验（验收）    | `pnpm run index`                                              |
| 格式化                 | `pnpm run format` / `pnpm run format:check`                   |

- `check` 读的是 `public/index.json`，**必须先 build**；`pnpm run index` 就是这两步连跑。
- `build` 要联网：npm registry；声明了 `githubStars` 排序键时还要 GitHub API。
- 图标按索引 URL 解析，所以让 `check` 按你本地起的地址解析：
  `node scripts/check-index.mjs --url http://127.0.0.1:8080/index.json`。
- 验收跑 `pnpm run index`，但**退出码 0 不够**：输出表还要读（见「验证方式」）。

## 全局规则

- **`config.json` 是策展的唯一入口。** 分类、标签、排序键、市场标题、每插件的覆盖值全在这里；
  脚本里不写这些值，文档里也不许记一份「当前分类表」—— 那是第二份真源。
- **不要手改 `public/`。** 它被 `.gitignore` 和 `.prettierignore` 同时排除，且 `build` 每次先整个删掉
  目录再写。手改在本地活不过下一次构建，在线上根本到不了。
- **加插件只动 `plugins.txt` 和 `config.json` 两个文件。** `plugins.txt` 加一行（顺序即默认展示顺序），
  要策展就在 `config.json` 的 `plugins.<name>` 里写。不要动 `scripts/`，不要在别处登记一份插件清单。
- **名录里有、npm 上没有 = 构建失败。** 先发版再进名录；这不是可跳过的步骤。
- **声明面成对改。** 给插件写 `category` / `labels` / 排序键 id，必须同时在根 `metadata` 里声明同名项，
  否则 build 直接失败（不是警告）。反方向：`build.pruneUnusedMetadata` 默认开着，声明了却没人用的项
  会被丢掉并留一条 WARN —— 看到那条 WARN，说明要么该删声明，要么该给插件补上引用。
- **语言策略。** 门面双语两件：`README.md`（英文）与 `README_zh.md`（中文），首行互链，格式照组织主页
  （`dsh-plugin-lab/.github` 的 `profile/README.md`）。**两件同改**：改一份就同改另一份，标题层级与代码块
  逐一对齐。`docs/` 只英文；本文件只中文。索引里的每个 `LocalizedText` 都**必须带 `en`**，语言 id 全小写
  （`en` / `zh` / `zh-cn`）。`config.json` 的 `market.title`、`market.description` 会**原样**进索引，
  所以同样受这条约束。
- **门面不写死数量和插件名。** 插件清单只指向组织仓 <https://github.com/dsh-plugin-lab>，由那边自己维护；
  在 README 里抄一份名字或「共 N 个插件」，就多了一处会过期的真源。**URL 是唯一要写死的东西。**
- **门面只写「用户要做的那几下」，不写阶段标签。** 「实验性 / Experimental」是插件**当前**的身份，不是
  用户要理解的步骤：一旦它转正，README 里就多了一句错话。用户要做的只有一件事 —— 打开那个插件、粘一个
  URL。同理不写「点击右上角第二排」这种位置描述，UI 会重排而文档不会自己跟着变。
- **校验必须过 `check`。** 它是官方 `parseMarketIndex` 的执行体，规则与用户机上 DSH 读到的一致；
  本地绿说明线上不会被拒。但绿只说明**格式**合法，不说明**内容**对（见「活跃坑」第 2、9 条）。
- **本仓不发版、不出包。** `private: true`，产物是 Pages 上的静态文件；版本与发布归各插件仓。

## 活跃坑

1. **validator 静默丢未定义成员 → npm `dist-tags` 无处可放。** format 1 没有承载 dist-tag 的成员。
   `build` 只把 `dist-tags.latest` 当一致性检查（它不在列出版本里就 fail），从不写进索引 —— 这是对的，
   不要「顺手补一个 `distTag` 字段」。`parseMarketIndex` 对未定义成员的做法是**静默丢弃**：索引照常通过，
   字段永远不会出现在读者那一侧。本仓唯一能照出这类问题的是 `check-index.mjs`，它把未定义成员报成错误。
2. **`en` 是必需的。** 根 `title` 与每个 `LocalizedText` 都要有 `en`。只有 `zh` 的 `locale/` 不会让 build
   失败：它 WARN 一句然后丢掉标题，索引里退回包名 —— 看起来像「名字没配」，实际是缺英文。
3. **时间是秒，不是毫秒。** `publishTimestamp` 是整数 Unix **秒**；多三位不会被纠正，只会被校验器拒掉。
   它来自 registry 的 `time`，build 自己除 1000 取整。
4. **npm 的 `repository.url` 带 `git+` 前缀。** `git+https://…`、`git@host:o/r`、`github:o/r` 在 build 里
   一律归一成 `https://…`，并去掉 `.git` 与 `#…`。所以索引里的仓库链接**与 npm 页面上看到的字面值不同**；
   比对时别拿 npm 原值当期望值。
5. **`zh-CN` 这种大写语言 id 非法。** 规则是 `^[a-z]{2,8}(-[a-z0-9]{1,8})*$`。`config.json` 的文案对象
   原样进索引，写 `zh-CN` 会让**整份索引**在读者那侧读不出来；插件 `locale/zh-CN.json` 同理 —— 它会被读成
   语言 id `zh-CN`，然后被校验器拒掉。
6. **git 源必须是 40 位小写 commit。** `source.type: "git"` 的 `commit` 校验为 `^[0-9a-f]{40}$`，build 从
   npm 版本的 `gitHead` 取；取不到就**跳过这个版本**（WARN），不是让构建失败。
7. **`icon` 的相对路径按索引 URL 解析。** `icons/x.svg` 是相对引用，读者用**索引所在 URL** 解析成绝对地址；
   `check` 同时断言解析结果落在索引同源、且文件真在 `public/` 里。所以改部署路径或 `market.indexUrl`
   要连图标一起想。
8. **定时失败只发给最后改 cron 的人 —— 所以现在由工作流自己开 issue。** GitHub 定时工作流失败的通知对象是
   最后修改 cron 表达式的那个账号，别人看不到红。所以失败时会开或评论一条固定标题的 issue
   （`[market] the index build is failing`），后续成功的那次自动关掉它。**「没人报错」不等于「跑绿了」**：
   真结论在 Actions 和那条 issue 里，不在收件箱里。运行责任人变更时，这条要一并交接。
9. **`status.json` 才是「这份索引多新」的答案。** format 1 里没有任何时间成员，索引文件本身答不了这个问题；
   部署又只在内容变化时发生，所以部署历史也不再等于新鲜度。`status.json` 记 `builtAt` / 插件数 / 版本数 /
   构建时的最新 DSH。**内容没变就不重新部署**，这是有意的：`deploy` 被 skipped 不是假绿，判据在 `build`。
10. **只列最新稳定版，所以旧版本装不到。** `config.json` 的 `build.includePrerelease: false` +
    `maxVersionsPerPlugin: 1` 让每个条目只有一条版本记录。这是体量换覆盖面的取舍：想回滚到旧版或装 alpha，
    直接 `pnpm add <name>@<version>`，**不要**去索引里找 —— 它已经不在那儿了。要恢复全量把
    `maxVersionsPerPlugin` 写成 `0`。
11. **星标拿不到时，星标排序整项消失。** `{ "githubStars": true }` 走 GitHub API，匿名额度很低；失败只 WARN，
    该插件的 `sortKeys` 值不写 → `metadata.sortKeys` 被当成「声明了但没人用」prune 掉 → Discover 页的星标
    排序整项不见，而构建是绿的。要稳定就在环境里给 `GITHUB_TOKEN`。
12. **tarball 读不到不是致命错误。** build 会退回 registry 文本：`locale/` 的标题描述与包自带图标**一起消失**，
    索引仍然合法。所以「标题变成包名 / 图标没了」先看 build 输出的 WARN，别先怀疑 `config.json`。
13. **字段是谁的就由谁负责，不要在 market 里美化。** `author` 这类展示字段取自各包自己的 `package.json`，
    发行版里写成什么就显示什么（四个包的写法曾经各不相同，其中一个还没写）。**正解是回源改 + 发版**，
    在 `config.json` 里覆盖等于把一处漂移藏起来，下次还会漂。只有「源已经错了且短期发不了版」才临时覆盖。

## 文档地图

一份文件只干一件事；改某件事之前先确认它的 home 在哪，不要就地另起一份。

| 文件                                                                                                    | 它的身份（谁读它）                                                      |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [README.md](README.md) · [中文](README_zh.md)                                                           | 门面：这是什么、用户填哪个 URL、怎么加索引源（任何打开本仓的人）        |
| [AGENTS.md](AGENTS.md)                                                                                  | 本仓特有：命令、规则、活跃坑（在本仓干活的维护者与 agent）              |
| [docs/market-format.md](docs/market-format.md)                                                          | 产物的字段参考（format 1）含完整示例（改 `scripts/`、排查线上索引的人） |
| [config.json](config.json)                                                                              | 策展入口：标题、声明、每插件 curation、build 开关（加插件、改分类的人） |
| [plugins.txt](plugins.txt)                                                                              | 名录与默认顺序（同上）                                                  |
| [scripts/build-index.mjs](scripts/build-index.mjs) · [scripts/check-index.mjs](scripts/check-index.mjs) | 生成与校验的全部逻辑，也是「字段从哪来」的执行体（改构建的人）          |
| `.github/workflows/build-market.yml`                                                                    | 何时跑、怎么把 `public/` 发到 Pages（排「线上没更新」的人）             |

**三条边界**（越界即缺陷）：

- 字段语义只住 [docs/market-format.md](docs/market-format.md)，本文件只讲怎么干、踩了什么。
- 用户要看的步骤只住 [README.md](README.md)，本文件不重复，只留指针。
- `config.json` 的**结构**由 `scripts/build-index.mjs` 决定，文档只描述；改结构先改脚本，再同批改这三份文档。

## 验证方式

**本地 —— `pnpm run index`。**

- 退出码 0 之后，读两个输出表：`build` 的表给每个插件的版本数、最新版、语言列表与标题；`check` 的表给
  默认版本、`engines.dsh`、`runs on`（列出的版本里有几个声明支持当前最新的 DSH）、图标有无，末尾还逐条
  打印每个插件的安装 spec。最后这两样才是「读者会装什么」的证据。
- **`runs on` 是格式之外的第二个判据。** `check` 会去 registry 读 `@deepseek-ai/dsh` 的 `latest`，按读者的
  规则（`engines.dsh` 单独裁决、`includePrerelease: true`）数一遍有几版能装。**这份索引合法不代表今天装得上**：
  上游抬一代，条目的安装按钮就会变灰，而索引本身不会报错。要指定参照版本用 `--dsh <version>`；读不到就
  WARN 跳过这一屏，不失败。
- **WARN 要逐条读**：版本被跳过、标题退回包名、图标缺失、星标拿不到，全都只体现在这里。
- 改了 `config.json` 的声明面或 `scripts/` 之后必须重跑：声明不一致是构建失败，不是校验失败，两者红的地方不同。
- 改了 `public/` 里的东西不用管 —— 它每次重建。

**线上 —— 看三处，缺一不可。**

- GitHub Pages 的索引 URL 能取到，且**内容**对得上：拿刚发布的插件版本或刚改的策展项去比对，不是看文件日期。
- `/status.json` 的 `builtAt` / `dsh` 与你预期一致。这是唯一能回答「这份索引是什么时候生成的、对着哪代 DSH
  生成的」的地方 —— 索引自己不带时间，部署历史也因为「内容没变就跳过」而不再等价于新鲜度。
- 那次 Actions 运行的结论是绿的（或 `deploy` 被 skipped 且 `build` 绿）。定时触发失败了不会通知到大多数人
  （见「活跃坑」第 8 条），但工作流会开那条固定标题的 issue —— 去那儿看，别等邮件。
