# Market index format 1 — field reference

`public/index.json` is the file DSH reads when a user adds
`https://dsh-plugin-lab.github.io/market/index.json` under **插件 → 发现 → 添加索引源**. This document
records what each member means, where it comes from, and the constraint the reader enforces.

**It is generated output.** Nobody edits it by hand: `scripts/build-index.mjs` deletes `public/` and
writes it again from `plugins.txt`, `config.json` and npm, and `scripts/check-index.mjs` runs the
official `parseMarketIndex` from `@deepseek-ai/dsh-plugin-market-index` over the result. To change a
value, change an input — [README.md](../README.md) says which input owns which field.

The format is defined by the plugin market index format Agent Note; the validator in
`@deepseek-ai/dsh-plugin-market-index` is the executable definition, and this document follows it.

## Root object

| Member        | Type            | Required | Source                             | Constraint                             |
| ------------- | --------------- | -------- | ---------------------------------- | -------------------------------------- |
| `format`      | number          | yes      | build constant                     | must be exactly `1`                    |
| `title`       | `LocalizedText` | yes      | `config.json` `market.title`       | must contain `en`                      |
| `description` | `LocalizedText` | no       | `config.json` `market.description` | must contain `en`                      |
| `metadata`    | object          | no       | `config.json` `metadata`           | absent groups read as empty            |
| `plugins`     | array           | yes      | `plugins.txt`                      | array; this build never emits it empty |

`metadata` being optional is why a bare index can still parse; it is not optional for the Discover
page, which needs the declarations for every id the plugins reference.

## `LocalizedText`

Either a plain string, or an object keyed by language id:

- **language ids are lowercase** and match `^[a-z]{2,8}(-[a-z0-9]{1,8})*$` — `en`, `zh`, `zh-cn` are
  valid; `zh-CN` is rejected;
- **the object must contain `en`** — a localized object carrying only `zh` is rejected;
- every value must be a string with at least one non-whitespace character.

`config.json`'s localized objects are copied into the index verbatim, so this rule applies to them
too. A plugin's `locale/<language>.json` contributes its file name as the language id.

## `metadata` (index level)

Declarations the readers resolve ids against. All three groups are records of id → declaration; an
empty id is rejected.

| Group        | Declaration shape                       | Constraint                                          |
| ------------ | --------------------------------------- | --------------------------------------------------- |
| `categories` | `{ "title": LocalizedText }`            | a plugin's `metadata.category` must be one of these |
| `labels`     | `{ "title": LocalizedText }`            | every plugin label must be here; no repeats         |
| `sortKeys`   | `{ "title", "order": "asc" \| "desc" }` | every plugin sort-key id must be here               |

Ids are opaque strings: the format does not constrain their spelling, but every consumer of an id
must find it declared. This build prunes declarations no plugin uses (with a warning), so the
Discover page never shows an empty filter.

## Plugin object

| Member        | Type            | Req. | Source                           | Constraint                                  |
| ------------- | --------------- | ---- | -------------------------------- | ------------------------------------------- |
| `name`        | string          | yes  | `plugins.txt`                    | valid npm package name, ≤ 214 chars, unique |
| `title`       | `LocalizedText` | no   | tarball `locale/`, or config     | must contain `en`                           |
| `description` | `LocalizedText` | no   | tarball `locale/`, else registry | must contain `en`                           |
| `icon`        | string          | no   | tarball `icon` file, or config   | `data:` URL, https, or index origin         |
| `author`      | string          | no   | registry `author`, or config     | non-whitespace string                       |
| `homepage`    | string          | no   | registry `homepage`, or config   | absolute `http(s)`; fragment allowed        |
| `repository`  | object          | no   | registry `repository`, or config | `{ "url", "directory"? }`, see below        |
| `metadata`    | object          | no   | config + registry `keywords`     | see below; absent members are empty         |
| `versions`    | array           | yes  | registry `versions` and `time`   | non-empty, unique, descending               |

The name is the package name, not a display name: it is what gets installed, and it must equal the
name npm serves. Display naming is `title`.

### `repository`

| Member      | Type   | Constraint                                                            |
| ----------- | ------ | --------------------------------------------------------------------- |
| `url`       | string | absolute `http(s)`, no credentials, **no query or fragment**          |
| `directory` | string | relative POSIX directory; segments `[A-Za-z0-9._@+-]`, no `.` or `..` |

npm publishes `git+https://github.com/o/r.git`; the build strips `git+`, the `.git` suffix and any
fragment, so the index carries the plain page URL. The repository is display only — it is never an
install source.

### Plugin `metadata`

| Member     | Type        | Source                                  | Constraint                        |
| ---------- | ----------- | --------------------------------------- | --------------------------------- |
| `category` | string      | config, else keywords                   | declared in `metadata.categories` |
| `keywords` | string[]    | registry `keywords` + config            | free-form, not checked            |
| `labels`   | string[]    | config, else keywords                   | declared in `metadata.labels`     |
| `sortKeys` | id → number | config, or GitHub API for `githubStars` | declared ids; finite numbers      |

`keywords` is the only free-form field here: it is what a user can search the market with, so it has
no declaration table. `category`, `labels` and `sortKeys` do, and an undeclared id rejects the whole
index — `scripts/build-index.mjs` already refuses to write one.

### `icon`

Two forms, and only two:

- **`data:` URL** — base64 SVG, PNG, JPEG or WebP, at most 32 KiB decoded. The build never emits
  this form; it exists for a hand-curated icon in `config.json`.
- **A URL or path** — resolved against the index URL. The build writes `icons/<slug>.<ext>` into
  `public/`, so the value is relative (`icons/x.svg`), and the reader resolves it to
  `https://dsh-plugin-lab.github.io/market/icons/x.svg`. It must resolve to https or to the index's
  own origin.

The icon is copied from the published tarball, so what users see is exactly what the package ships.

## Version object

| Member             | Type   | Req. | Source                           | Constraint                              |
| ------------------ | ------ | ---- | -------------------------------- | --------------------------------------- |
| `version`          | string | yes  | registry `versions`              | exact SemVer, unique in the plugin      |
| `publishTimestamp` | number | yes  | registry `time[version]` / 1000  | integer **Unix seconds**, `[0, 10^11)`  |
| `source`           | object | yes  | config type + registry `gitHead` | `npm` or `git`, see below               |
| `engines`          | object | no   | registry `engines.dsh`           | `{ "dsh"?: SemVer range }`, may be `{}` |

`publishTimestamp` is the only timestamp in the format, and it is in seconds. Milliseconds are not
normalized: a value three digits too long simply fails the range check.

### `source`

| Variant | Shape                                                                 |
| ------- | --------------------------------------------------------------------- |
| npm     | `{ "type": "npm", "registry"?: url }`                                 |
| git     | `{ "type": "git", "url": string, "commit": string, "path"?: string }` |

The npm form is the default, because that is where the packages are published:

- `type` is literally `npm`;
- `registry` is an `http(s)` URL with no credentials, query or fragment; omitting it means the
  installing client's own registry.

The git form pins each version to its own commit:

- `url` is a **canonical** https URL — it must equal its own normalized form — naming a repository
  with at least two path segments and no `.tgz` / `.tar.gz` suffix;
- `commit` is **40 lowercase hex digits**, taken from the registry's `gitHead`; a version without
  one is skipped rather than pinned to a guess;
- `path` is a relative POSIX package directory, with the same rules as `repository.directory`.

### `engines.dsh`

A SemVer range of the DSH versions the plugin version runs on. Absent means any. Two constraints:

- it must be a **valid SemVer range** (the build validates with `semver.validRange` before writing);
- it must **not** be a `workspace:` range — those are local development artifacts that never exist
  in a published package, and the reader rejects them.

The range is the plugin's own declaration, copied from its published manifest. It is what decides
whether an entry shows as installable in DSH, so it changes only when that plugin publishes a
`package.json` change.

## What a reader does with it

- **Versions are sorted descending by SemVer precedence** on read; file order does not decide it.
- **The default version is the highest non-prerelease one**, falling back to the highest overall.
- **The install spec comes from `source`**: `name@version` for npm (plus the registry to ask first,
  when named), and `git+<url>.git#<commit>` for git — with `&path:/<directory>` appended when the
  package is not at the repository root.

## Members format 1 does not define

**The reader drops them silently.** The index still parses, the value never reaches a user, and
nothing in DSH reports it. This is the single most expensive mistake available here, so
`scripts/check-index.mjs` reports unknown members as errors instead. The complete list of allowed
members:

| Record                       | Members format 1 defines                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| index                        | `format`, `title`, `description`, `metadata`, `plugins`                                            |
| `metadata`                   | `categories`, `labels`, `sortKeys`                                                                 |
| category / label declaration | `title`                                                                                            |
| sort-key declaration         | `title`, `order`                                                                                   |
| plugin                       | `name`, `title`, `description`, `icon`, `author`, `homepage`, `repository`, `metadata`, `versions` |
| plugin `metadata`            | `category`, `keywords`, `labels`, `sortKeys`                                                       |
| `repository`                 | `url`, `directory`                                                                                 |
| version                      | `version`, `publishTimestamp`, `source`, `engines`                                                 |
| npm `source`                 | `type`, `registry`                                                                                 |
| git `source`                 | `type`, `url`, `commit`, `path`                                                                    |
| `engines`                    | `dsh`                                                                                              |

Concretely: there is **no place for npm `dist-tags`** (`latest`, `alpha`, `next`), no download
counts, no deprecation flag, no build timestamp, no version count. Adding one is a no-op that looks
like a feature.

## Complete example

One plugin, as the build would write it. The block is **annotated with `//` comments and is not
valid JSON** — the generated file contains no comments and no trailing commas. The `versions` array
is truncated to one entry, and the `metadata` groups are trimmed to the ones this plugin uses: the
real index carries every plugin, every published version, and every group a plugin references.

```text
{
  "format": 1,
  // config.json market.title. Localized, and `en` is mandatory.
  "title": { "en": "DSH Plugin Lab", "zh": "DSH 插件实验室" },
  "description": {
    "en": "Plugins built by dsh-plugin-lab for DeepSeek Harness: retrieval, account, models and development tooling.",
    "zh": "dsh-plugin-lab 出品的 DeepSeek Harness 插件：检索、账户、模型接入与开发工具。"
  },
  "metadata": {
    // Declarations. Every id a plugin references below must appear here.
    "categories": { "search": { "title": { "en": "Search & retrieval", "zh": "检索" } } },
    "labels": { "tool": { "title": { "en": "Model tool", "zh": "模型工具" } } },
    "sortKeys": {
      "stars": { "title": { "en": "GitHub stars", "zh": "GitHub 星标" }, "order": "desc" }
    }
  },
  "plugins": [
    {
      // The npm package name, from plugins.txt: it is what gets installed.
      "name": "dsh-zhihu-search",
      // locale/en.json and locale/zh.json → meta.title.
      "title": { "en": "Zhihu Search", "zh": "知乎检索" },
      // Same files → meta.description.
      "description": {
        "en": "Zhihu in-site search, global web search, and Zhida answers for the model, over the official Zhihu Open Platform API.",
        "zh": "接知乎开放平台官方接口，给模型知乎站内检索、全网检索与直答三种能力。"
      },
      // The tarball's own icon.svg, copied to public/icons/. Relative to the index URL.
      "icon": "icons/dsh-zhihu-search.svg",
      // registry homepage, `#readme` fragment kept.
      "homepage": "https://github.com/dsh-plugin-lab/dsh-zhihu-search#readme",
      // registry repository, `git+` and `.git` stripped. Display only.
      "repository": { "url": "https://github.com/dsh-plugin-lab/dsh-zhihu-search" },
      "metadata": {
        // Declared under metadata.categories above.
        "category": "search",
        // Free-form: registry keywords minus the configured blocklist, plus the name.
        "keywords": ["zhihu", "zhihu-api", "search", "tool", "dsh-zhihu-search"],
        // Declared under metadata.labels above.
        "labels": ["tool"],
        // Id declared above; the number is read from the GitHub API at build time.
        "sortKeys": { "stars": 13 }
      },
      "versions": [
        {
          "version": "2.1.2",
          // 2026-10-15T08:09:48Z as integer Unix seconds, not milliseconds.
          "publishTimestamp": 1792051788,
          // npm by default; a git source would carry url, commit and optional path here.
          "source": { "type": "npm" },
          // Copied from the published manifest's engines.dsh. `{}` means any DSH.
          "engines": { "dsh": "^0.1.7-rc.1 || ^0.2.0-rc.1" }
        }
      ]
    }
  ]
}
```

What this entry does **not** contain, and why: no `author` (the package publishes none), no
`dist-tags` (format 1 has no member for it), no build timestamp (also no member — freshness is
checked against npm, not against the file), and no other published version (truncated here only).
