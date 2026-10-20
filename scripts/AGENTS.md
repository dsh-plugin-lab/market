# scripts/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。本文件只写**在 `scripts/` 里改代码要额外守什么**；
文件定位、数据流与依赖关系见 [README.md](README.md)。

## 硬约束

- **依赖方向只能单向**：命令 → `sources` / `domain` → `shared`。`domain` 不 import `sources`，
  `sources` 不 import `domain`，入口之间不互相调用。要跨层复用，先抽到更下层。
- **`domain/` 是纯的**：不发请求、不写盘、不读时钟。需要提示时由调用方传入 `report`，
  而不是让库里 `console.log` 或抛错。
- **"取不到" 与 "包里没有" 必须分开**。前者是网络事件（`{ unreadable }`），后者是包的属性。
  混成一个缺失值，就会让一次超时变成四条数据缺陷。
- **降级码必须在 `domain/diagnosis.mjs` 登记**，否则 `add()` 直接抛错；每个码还必须带 severity
  （`degrade` / `environment`），有测试盯着这条。
- **严格性只在入口层声明**：同一个 `tarball-unreadable`，在 `build` 是降级、在 `check` 是棘轮。
  库不替入口决定。
- **契约表只有一份**：`domain/contract.mjs` 同时供 build（写之前自查）与 check（校验）使用。
- **哈希只有一种实现**：`shared/digest.mjs`。build 用它生成 `status.json` 的 `content.hash`，verify
  用它判断线上；两处各写一遍，就会出现「同字节不同哈希」，表现得和部署失败一模一样。
- **棘轮是集合比较，不是计数**：同一降级换了插件不算回归，多一个才算。比较逻辑住
  `domain/diagnosis.mjs` 的 `ratchet()`，措辞与严重度归命令层。

## 改动的验收

| 改了什么                               | 必跑                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| 任何 `scripts/` 下的文件               | `pnpm run test` + `pnpm run index`                                           |
| 产物形态（`derive`/`assemble`/`text`） | 上面两条，**外加索引哈希与改前一致**（纯搬家时）或说明为什么变了             |
| 新降级码                               | 加 `test/diagnostics.test.mjs` 用例 + 决定进不进 `diagnostics-baseline.json` |
| `verify-deployed.mjs`                  | 本地起 `python -m http.server` 指向 `public/` 跑正例；再改一个字节跑反例     |
| `sources/*`                            | 至少跑一次真实构建（它要联网）                                               |

## 几个容易写错的地方

- **一次外部失败不要变成一串码**。tarball 读不到时 locale / 标题 / 图标都会跟着缺；只报根因。
- **环境相关的码不进棘轮**。本地无 token 撞 GitHub 限流是常态，见 `diagnosis.mjs` 的 `ENVIRONMENTAL`。
- **截断的压缩包不要插入半条数据**。`shared/tar.mjs` 先判长度再插入，因为半条数据看起来像完整文件。
- **别用 grep 判语义**。判图标是否铺满画布要看外层 `transform` 和 `<defs>`；判 `currentColor` 要区分注释。
- **顺序即文档**。条目顺序来自发现出的名录（包名字母序），不是响应到达顺序；并发取数不得改变输出顺序。
