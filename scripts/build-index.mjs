#!/usr/bin/env node
/**
 * Build `public/index.json` — a plugin market index in format 1 — from `plugins.txt` and `config.json`.
 *
 * This runs on a GitHub runner, where no plugin repository exists on disk, so nothing here reads a
 * plugin's checkout. Every machine fact comes from two published sources:
 *
 *   - the npm packument (`GET <registry>/<name>`): versions, publish times, `engines`, `gitHead`,
 *     `repository`, `homepage`, `author`, `keywords`;
 *   - the published tarball of the newest listed version: `locale/*.json` for the display title and
 *     description, and the icon named by that package's own `icon` field.
 *
 * Curation — market title, categories, labels, sort keys, and each plugin's category and labels — is
 * the part no source can derive, so it lives in `config.json` and is only ever merged in here.
 *
 * Output is validated by `scripts/check-index.mjs` before anything is deployed. Versions of DSH
 * that read the index apply their own validation too; see `@deepseek-ai/dsh-plugin-market-index`.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import semver from 'semver'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'public')

const NPM = 'https://registry.npmjs.org'
const GITHUB_API = 'https://api.github.com'

/** The npm package-name grammar, so a typo in `plugins.txt` fails here and not in DSH. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
/** `locale/<language>.json` inside a published package; the language id is the file name. */
const LANGUAGE_FILE = /^package\/locale\/([a-z]{2,8}(?:-[a-z0-9]{1,8})*)\.json$/u
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])

const FETCH_TIMEOUT_MS = 30_000
const FETCH_ATTEMPTS = 3
const CONCURRENCY = 4

const warnings = []
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const info = (message) => console.log(`  [INFO] ${message}`)
const ok = (message) => console.log(`  [OK]   ${message}`)
function warn(message) {
  warnings.push(message)
  console.log(`  [WARN] ${message}`)
}
function fail(message) {
  throw new Error(message)
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** `plugins.txt`: one npm package name per line, `#` starts a comment, order is the default order. */
async function readPlugins(file) {
  const text = await readFile(file, 'utf8')
  const names = []
  for (const [index, rawLine] of text
    .replace(/^\uFEFF/u, '')
    .split(/\r?\n/u)
    .entries()) {
    const line = rawLine.replace(/\s+#.*$/u, '').trim()
    if (line === '' || line.startsWith('#')) continue
    if (!PACKAGE_NAME.test(line))
      fail(`plugins.txt:${index + 1}: ${JSON.stringify(line)} is not an npm package name`)
    if (names.includes(line)) fail(`plugins.txt:${index + 1}: ${line} is listed twice`)
    names.push(line)
  }
  if (names.length === 0) fail('plugins.txt lists no plugin')
  return names
}

/**
 * The build knobs, with the defaults that make a bare `config.json` work: every published version
 * is listed, prereleases included, and unused declarations are pruned so the Discover page never
 * shows an empty category button.
 */
function normaliseSettings(config) {
  const market = config.market ?? fail('config.json: "market" is required')
  if (typeof market.title?.en !== 'string') fail('config.json: "market.title.en" is required')
  const build = config.build ?? {}
  return {
    indexUrl: market.indexUrl ?? 'https://dsh-plugin-lab.github.io/market/index.json',
    includePrerelease: build.includePrerelease ?? true,
    maxVersionsPerPlugin: build.maxVersionsPerPlugin ?? 0,
    keywordBlocklist: new Set((build.keywordBlocklist ?? []).map((word) => word.toLowerCase())),
    maxKeywords: build.maxKeywords ?? 12,
    pruneUnusedMetadata: build.pruneUnusedMetadata ?? true,
    keywordRules: config.keywordRules ?? {},
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function get(url, { accept = 'application/json', headers = {} } = {}) {
  let lastError
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept, 'user-agent': 'dsh-market-index-builder', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < FETCH_ATTEMPTS) await sleep(500 * attempt)
    }
  }
  fail(`${url}: ${lastError?.message ?? 'request failed'}`)
}

async function getJson(url, options) {
  return (await get(url, options)).json()
}

async function getPackument(name) {
  // The full packument, not the abbreviated one: only this one carries `time`, `repository`,
  // `homepage`, `author` and `keywords`.
  return getJson(`${NPM}/${name.replace('/', '%2F')}`)
}

/** The GitHub token is optional; without it the stars lookup simply runs into the anonymous limit. */
async function getGithubStars(owner, repo, cache) {
  const key = `${owner}/${repo}`
  if (cache.has(key)) return cache.get(key)
  const headers = { 'x-github-api-version': '2022-11-28' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  let stars
  try {
    const body = await getJson(`${GITHUB_API}/repos/${key}`, { headers })
    stars = body.stargazers_count
  } catch (error) {
    warn(`github stars for ${key} unavailable: ${error.message}`)
  }
  cache.set(key, stars)
  return stars
}

// ---------------------------------------------------------------------------
// Tar (the published package, so `locale/` and the icon are exactly what users install)
// ---------------------------------------------------------------------------

function tarString(block, offset, length) {
  const slice = block.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8')
}

function paxPath(bytes) {
  let path
  for (const line of bytes.toString('utf8').split('\n')) {
    const match = /^\d+ ([\w.]+)=(.*)$/u.exec(line)
    if (match?.[1] === 'path') path = match[2]
  }
  return path
}

/** A minimal ustar reader: enough for a `pnpm pack` / `npm publish` tarball, no dependency. */
function readTar(buffer) {
  const entries = new Map()
  let offset = 0
  let pendingName
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarString(header, 0, 100)
    const size = Number.parseInt(tarString(header, 124, 12).trim() || '0', 8)
    const flag = String.fromCharCode(header[156]) || '0'
    const prefix = tarString(header, 345, 155)
    const dataStart = offset + 512
    const data = buffer.subarray(dataStart, dataStart + size)

    if (flag === 'x') {
      pendingName = paxPath(data)
    } else if (flag === 'L') {
      pendingName = data.toString('utf8').replace(/\0+$/u, '')
    } else if (flag === '0' || flag === '\0' || flag === '7') {
      const path = pendingName ?? (prefix === '' ? name : `${prefix}/${name}`)
      entries.set(path, data)
      pendingName = undefined
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return entries
}

async function getPublishedPackage(tarballUrl) {
  const response = await get(tarballUrl, { accept: 'application/octet-stream' })
  const gzipped = Buffer.from(await response.arrayBuffer())
  return readTar(gunzipSync(gzipped))
}

// ---------------------------------------------------------------------------
// Field derivation
// ---------------------------------------------------------------------------

/** `git+https://github.com/o/r.git`, `git@github.com:o/r.git` and `github:o/r` all become a page URL. */
function repositoryUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  let url = raw.trim()
  url = url.replace(/^git\+/u, '')
  const scp = /^git@([^:]+):(.+)$/u.exec(url)
  if (scp) url = `https://${scp[1]}/${scp[2]}`
  const shorthand = /^github:(.+)$/u.exec(url)
  if (shorthand) url = `https://github.com/${shorthand[1]}`
  url = url.replace(/^git:\/\//u, 'https://')
  url = url.replace(/^ssh:\/\/git@/u, 'https://')
  url = url.replace(/[?#].*$/u, '')
  url = url.replace(/\.git$/u, '')
  if (!/^https?:\/\//u.test(url)) return undefined
  try {
    if (!URL.canParse(url)) return undefined
  } catch {
    return undefined
  }
  return url
}

function repositoryOf(source, layout) {
  if (source === undefined || source === null) return undefined
  const raw = typeof source === 'string' ? { url: source } : source
  const url = repositoryUrl(raw.url)
  if (url === undefined) return undefined
  const repository = { url }
  const directory = raw.directory ?? layout.directory
  if (typeof directory === 'string' && directory !== '') {
    repository.directory = directory.replace(/^\.\//u, '').replace(/\/$/u, '')
  }
  return repository
}

function authorOf(raw) {
  if (typeof raw === 'string') return raw.trim() === '' ? undefined : raw.trim()
  if (raw && typeof raw.name === 'string' && raw.name.trim() !== '') return raw.name.trim()
  return undefined
}

/** `LocalizedText`: a string, or a record of lowercase language ids that must include `en`. */
function localizedText(over, fromLocale, fallback) {
  const text = {}
  for (const [language, value] of Object.entries(fromLocale ?? {})) {
    if (typeof value === 'string' && value.trim() !== '') text[language] = value.trim()
  }
  if (typeof fallback === 'string' && fallback.trim() !== '' && text.en === undefined) {
    text.en = fallback.trim()
  }
  for (const [language, value] of Object.entries(over ?? {})) {
    if (typeof value === 'string' && value.trim() !== '') text[language] = value.trim()
  }
  if (Object.keys(text).length === 0) return undefined
  if (text.en === undefined) {
    warn(`no English text (languages: ${Object.keys(text).join(', ')}) — the index requires "en"`)
    return undefined
  }
  return text
}

/** The `meta.title` / `meta.description` pairs of `locale/*.json`, keyed by the file's language id. */
function localeText(entries) {
  const titles = {}
  const descriptions = {}
  const found = []
  for (const [path, bytes] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    const match = LANGUAGE_FILE.exec(path)
    if (match === null) continue
    let parsed
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      warn(`${path}: not valid JSON (${error.message})`)
      continue
    }
    const language = match[1]
    const title = parsed?.meta?.title ?? parsed?.title
    const description = parsed?.meta?.description ?? parsed?.description
    if (typeof title === 'string') titles[language] = title
    if (typeof description === 'string') descriptions[language] = description
    found.push(language)
  }
  if (found.length === 0) warn('no locale/<language>.json in the published package')
  return { titles, descriptions, languages: found }
}

function slugOf(name) {
  return name.replace(/^@/u, '').replace(/\//gu, '-')
}

function keywordsOf(settings, ...lists) {
  const words = []
  for (const list of lists) {
    for (const word of list ?? []) {
      if (typeof word !== 'string') continue
      const trimmed = word.trim()
      if (trimmed === '') continue
      if (settings.keywordBlocklist.has(trimmed.toLowerCase())) continue
      if (!words.includes(trimmed)) words.push(trimmed)
    }
  }
  return words.slice(0, settings.maxKeywords)
}

// ---------------------------------------------------------------------------
// Curation
// ---------------------------------------------------------------------------

/** Explicit curation wins; otherwise keywords chosen in `config.json` decide. Deterministic by order. */
function curate(name, config, settings, keywords) {
  const explicit = config.plugins?.[name] ?? {}
  const rules = settings.keywordRules ?? {}
  const lowered = keywords.map((word) => word.toLowerCase())

  let category = explicit.category
  if (category === undefined) {
    for (const [id, words] of Object.entries(rules.category ?? {})) {
      if (words.some((word) => lowered.includes(word.toLowerCase()))) {
        category = id
        break
      }
    }
  }

  let labels = explicit.labels
  if (labels === undefined) {
    labels = []
    for (const [id, words] of Object.entries(rules.labels ?? {})) {
      if (words.some((word) => lowered.includes(word.toLowerCase())) && !labels.includes(id)) {
        labels.push(id)
      }
    }
  }

  return { explicit, category, labels }
}

/** `sortKeys` values are numbers, or `{ "githubStars": true | "owner/repo" }` for a fetched number. */
async function sortKeysOf(explicit, repository, stars) {
  const values = {}
  for (const [id, value] of Object.entries(explicit.sortKeys ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      values[id] = value
      continue
    }
    const requested = value?.githubStars
    if (requested === true) {
      const match = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/?$/u.exec(repository?.url ?? '')
      if (match === null) {
        warn(`sortKeys.${id}: no repository URL to read GitHub stars from`)
        continue
      }
      const count = await stars(match[1], match[2])
      if (typeof count === 'number') values[id] = count
      continue
    }
    if (typeof requested === 'string') {
      const [owner, repo] = requested.split('/')
      const count = await stars(owner, repo)
      if (typeof count === 'number') values[id] = count
      continue
    }
    warn(`sortKeys.${id}: ${JSON.stringify(value)} is neither a number nor a supported source`)
  }
  return values
}

// ---------------------------------------------------------------------------
// One plugin
// ---------------------------------------------------------------------------

async function buildPlugin(name, config, settings, stars) {
  const packument = await getPackument(name)
  const published = Object.keys(packument.versions ?? {}).sort(semver.rcompare)
  if (published.length === 0) fail(`${name}: the registry lists no version`)

  const selected = []
  for (const version of published) {
    if (!settings.includePrerelease && semver.prerelease(version) !== null) continue
    if (settings.maxVersionsPerPlugin > 0 && selected.length >= settings.maxVersionsPerPlugin) break
    selected.push(version)
  }
  if (selected.length === 0) fail(`${name}: no version survives the build filters`)
  const latestTagged = packument['dist-tags']?.latest
  if (typeof latestTagged === 'string' && !selected.includes(latestTagged)) {
    fail(`${name}: the "latest" tag (${latestTagged}) is not among the listed versions`)
  }

  const explicit = config.plugins?.[name] ?? {}
  const sourceConfig = explicit.source ?? { type: 'npm' }
  const newest = selected[0]
  const newestManifest = packument.versions[newest]

  // The published bytes, for the two things the packument does not carry.
  let entries = new Map()
  try {
    entries = await getPublishedPackage(newestManifest.dist.tarball)
  } catch (error) {
    warn(
      `${name}: the ${newest} tarball is unreadable (${error.message}) — falling back to registry text`,
    )
  }
  const manifest = entries.has('package/package.json')
    ? JSON.parse(entries.get('package/package.json').toString('utf8'))
    : newestManifest

  const versions = []
  for (const version of selected) {
    const manifestVersion = packument.versions[version]
    const timestamp = Date.parse(packument.time?.[version] ?? '')
    if (!Number.isFinite(timestamp)) {
      warn(
        `${name}@${version}: the registry publishes no timestamp for it — the version is skipped`,
      )
      continue
    }
    const publishTimestamp = Math.floor(timestamp / 1000)
    if (publishTimestamp < 0 || publishTimestamp >= 1e11) {
      warn(
        `${name}@${version}: publish time ${publishTimestamp} is out of range — the version is skipped`,
      )
      continue
    }

    let source
    if (sourceConfig.type === 'git') {
      const commit = manifestVersion.gitHead
      if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/u.test(commit)) {
        warn(
          `${name}@${version}: no 40-hex gitHead, so a git source cannot be pinned — the version is skipped`,
        )
        continue
      }
      const url = repositoryUrl(
        sourceConfig.url ?? packument.repository?.url ?? manifestVersion.repository?.url,
      )
      if (url === undefined) {
        fail(`${name}@${version}: a git source needs an https repository URL`)
      }
      source = { type: 'git', url, commit }
      const directory = sourceConfig.directory ?? repositoryOf(packument.repository, {})?.directory
      if (typeof directory === 'string' && directory !== '') source.path = directory
    } else {
      source = { type: 'npm' }
      if (typeof sourceConfig.registry === 'string') source.registry = sourceConfig.registry
    }

    const engines = {}
    const dsh = manifestVersion.engines?.dsh
    if (typeof dsh === 'string' && dsh.trim() !== '') {
      if (dsh.startsWith('workspace:')) {
        warn(`${name}@${version}: engines.dsh is a workspace range — it is not published`)
      } else if (semver.validRange(dsh) !== null) {
        engines.dsh = dsh
      } else {
        warn(
          `${name}@${version}: engines.dsh ${JSON.stringify(dsh)} is not a SemVer range — it is omitted`,
        )
      }
    }
    versions.push({ version, publishTimestamp, source, engines })
  }
  if (versions.length === 0) fail(`${name}: no listed version could be described`)

  const locale = localeText(entries)
  const title = localizedText(explicit.title, locale.titles, undefined)
  const description = localizedText(
    explicit.description,
    locale.descriptions,
    packument.description,
  )
  if (title === undefined)
    warn(`${name}: no title in any language — the index shows the package name`)

  // Icon: an explicit URL/data URL, otherwise the file the package itself points at.
  let icon
  if (typeof explicit.icon === 'string' && explicit.icon.trim() !== '') {
    icon = explicit.icon.trim()
  } else if (typeof manifest.icon === 'string' && manifest.icon.trim() !== '') {
    const iconPath = `package/${manifest.icon.trim().replace(/^\.\//u, '')}`
    const bytes = entries.get(iconPath)
    const extension = extname(iconPath).toLowerCase()
    if (bytes === undefined) {
      warn(`${name}: package.json names ${manifest.icon}, but the tarball does not contain it`)
    } else if (!ICON_EXTENSIONS.has(extension)) {
      warn(`${name}: ${manifest.icon} is not an SVG/PNG/JPEG/WebP file — no icon is listed`)
    } else {
      const file = `icons/${slugOf(name)}${extension}`
      await mkdir(join(OUT, 'icons'), { recursive: true })
      await writeFile(join(OUT, file), bytes)
      icon = file
    }
  }

  const repository = repositoryOf(explicit.repository ?? packument.repository, {})
  if (repository === undefined && packument.repository !== undefined) {
    warn(
      `${name}: repository ${JSON.stringify(packument.repository)} is not an http(s) URL — it is omitted`,
    )
  }

  const keywords = keywordsOf(settings, packument.keywords, explicit.keywords, [name])
  const { category, labels } = curate(name, config, settings, keywords)
  const sortKeys = await sortKeysOf(explicit, repository, stars)

  const homepage = typeof explicit.homepage === 'string' ? explicit.homepage : packument.homepage
  const author = authorOf(explicit.author) ?? authorOf(packument.author)

  return {
    plugin: {
      name,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(icon === undefined ? {} : { icon }),
      ...(author === undefined ? {} : { author }),
      ...(typeof homepage === 'string' && homepage.trim() !== '' && URL.canParse(homepage)
        ? { homepage: homepage.trim() }
        : {}),
      ...(repository === undefined ? {} : { repository }),
      metadata: {
        ...(category === undefined ? {} : { category }),
        keywords,
        labels,
        sortKeys,
      },
      versions,
    },
    newest,
    languages: locale.languages,
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Declarations no plugin references are dropped, so the Discover page shows no empty filter. */
function pruneMetadata(metadata, plugins, enabled) {
  if (!enabled) return metadata
  const usedCategories = new Set(plugins.map((plugin) => plugin.metadata.category).filter(Boolean))
  const usedLabels = new Set(plugins.flatMap((plugin) => plugin.metadata.labels))
  const usedSortKeys = new Set(plugins.flatMap((plugin) => Object.keys(plugin.metadata.sortKeys)))
  const keep = (group, used) => {
    const kept = {}
    for (const [id, declaration] of Object.entries(group)) {
      if (used.has(id)) kept[id] = declaration
      else
        warn(
          `metadata.${group === metadata.categories ? 'categories' : 'group'}: "${id}" is declared but unused — dropped`,
        )
    }
    return kept
  }
  return {
    categories: keep(metadata.categories, usedCategories),
    labels: keep(metadata.labels, usedLabels),
    sortKeys: keep(metadata.sortKeys, usedSortKeys),
  }
}

function validateDeclarations(metadata, plugins) {
  for (const plugin of plugins) {
    const { category, labels, sortKeys } = plugin.metadata
    if (category !== undefined && metadata.categories[category] === undefined) {
      fail(
        `${plugin.name}: category "${category}" is not declared in config.json metadata.categories`,
      )
    }
    for (const label of labels) {
      if (metadata.labels[label] === undefined) {
        fail(`${plugin.name}: label "${label}" is not declared in config.json metadata.labels`)
      }
    }
    for (const id of Object.keys(sortKeys)) {
      if (metadata.sortKeys[id] === undefined) {
        fail(`${plugin.name}: sort key "${id}" is not declared in config.json metadata.sortKeys`)
      }
    }
  }
}

async function mapLimit(items, limit, worker) {
  const results = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}

async function main() {
  const config = await readJson(join(ROOT, 'config.json'))
  const settings = normaliseSettings(config)
  const names = await readPlugins(join(ROOT, 'plugins.txt'))
  info(`${names.length} plugin(s) listed in plugins.txt`)

  // Clear the output first: the plugins below write their icons into it as they are resolved.
  await rm(OUT, { recursive: true, force: true })
  await mkdir(join(OUT, 'icons'), { recursive: true })

  const starsCache = new Map()
  const stars = (owner, repo) => getGithubStars(owner, repo, starsCache)

  const built = await mapLimit(names, CONCURRENCY, (name) =>
    buildPlugin(name, config, settings, stars),
  )

  const plugins = built.map((entry) => entry.plugin)
  const declared = {
    categories: config.metadata?.categories ?? {},
    labels: config.metadata?.labels ?? {},
    sortKeys: config.metadata?.sortKeys ?? {},
  }
  validateDeclarations(declared, plugins)
  const metadata = pruneMetadata(declared, plugins, settings.pruneUnusedMetadata)

  const index = {
    format: 1,
    title: config.market.title,
    ...(config.market.description === undefined ? {} : { description: config.market.description }),
    metadata,
    plugins,
  }

  await writeFile(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  console.log('')
  console.log(
    `  ${'plugin'.padEnd(28)} ${'versions'.padStart(8)}  ${'newest'.padEnd(14)} ${'languages'.padEnd(12)} title`,
  )
  console.log(`  ${'-'.repeat(28)} ${'-'.repeat(8)}  ${'-'.repeat(14)} ${'-'.repeat(12)} -----`)
  for (const entry of built) {
    const title = entry.plugin.title?.en ?? '(package name)'
    console.log(
      `  ${entry.plugin.name.padEnd(28)} ${String(entry.plugin.versions.length).padStart(8)}  ` +
        `${entry.newest.padEnd(14)} ${(entry.languages.join(',') || '-').padEnd(12)} ${title}`,
    )
  }
  console.log('')
  ok(`public/index.json written (${plugins.length} plugins, ${warnings.length} warning(s))`)
  ok(`index URL: ${settings.indexUrl}`)
  if (warnings.length > 0) info('warnings are listed above; the build still produced a valid index')
}

main().catch((error) => {
  console.error(`  [ERR]  ${error.message}`)
  process.exitCode = 1
})
