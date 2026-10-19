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
import { Diagnostics } from './lib/diagnostics.mjs'
import {
  authorOf,
  keywordsOf,
  localeText,
  localizedText,
  repositoryOf,
  repositoryUrl,
  slugOf,
} from './lib/normalize.mjs'
import { readTar } from './lib/tar.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'public')

const NPM = 'https://registry.npmjs.org'
const GITHUB_API = 'https://api.github.com'

/** The npm package-name grammar, so a typo in `plugins.txt` fails here and not in DSH. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])

const FETCH_TIMEOUT_MS = 30_000
const FETCH_ATTEMPTS = 3
const CONCURRENCY = 4

/**
 * Every degraded outcome goes through here with a stable code. Free-text warnings were invisible:
 * they scrolled past in a CI log and nothing compared this build with the last one. The codes are
 * what `diagnostics-baseline.json` ratchets against.
 */
const diagnostics = new Diagnostics()
const warn = (code, message, context) => diagnostics.add(code, message, context)
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const info = (message) => console.log(`  [INFO] ${message}`)
const ok = (message) => console.log(`  [OK]   ${message}`)
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
    includePrerelease: build.includePrerelease ?? false,
    maxVersionsPerPlugin: build.maxVersionsPerPlugin ?? 1,
    keywordBlocklist: new Set((build.keywordBlocklist ?? []).map((word) => word.toLowerCase())),
    maxKeywords: build.maxKeywords ?? 12,
    pruneUnusedMetadata: build.pruneUnusedMetadata ?? true,
    keywordRules: config.keywordRules ?? {},
  }
}

/** The newest published DSH, recorded in `status.json` so "is this index current?" has an answer. */
async function latestDsh() {
  try {
    const packument = await getJson(`${NPM}/@deepseek-ai%2Fdsh`, {
      accept: 'application/vnd.npm.install-v1+json',
    })
    return packument['dist-tags']?.latest
  } catch (error) {
    warn('dsh-version-unavailable', `could not read the current DSH version (${error.message})`)
    return undefined
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
    warn('stars-unavailable', `github stars for ${key} unavailable: ${error.message}`)
  }
  cache.set(key, stars)
  return stars
}

/** The published tarball, so `locale/` and the icon are exactly what users install. */
async function getPublishedPackage(tarballUrl) {
  const response = await get(tarballUrl, { accept: 'application/octet-stream' })
  const gzipped = Buffer.from(await response.arrayBuffer())
  return readTar(gunzipSync(gzipped))
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
        warn('sortkey-unresolved', `sortKeys.${id}: no repository URL to read GitHub stars from`)
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
    warn(
      'sortkey-unresolved',
      `sortKeys.${id}: ${JSON.stringify(value)} is neither a number nor a supported source`,
    )
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
  if (selected.length === 0) {
    // A package that has only ever published prereleases is not a reason to take the market down.
    selected.push(published[0])
    warn(
      'prerelease-only',
      `${name}: no stable version is published, so ${published[0]} (a prerelease) is listed instead`,
      { plugin: name },
    )
  }
  const latestTagged = packument['dist-tags']?.latest
  if (typeof latestTagged === 'string' && !selected.includes(latestTagged)) {
    const message = `${name}: the "latest" tag (${latestTagged}) is not among the listed versions`
    // A stable `latest` that is missing means this build dropped the newest release — a defect.
    // A prerelease `latest` is simply excluded by a stable-only policy, which is not a defect.
    if (semver.prerelease(latestTagged) === null) fail(message)
    else
      warn('latest-tag-prerelease', `${message} — it is a prerelease, and it is not listed`, {
        plugin: name,
      })
  }

  const explicit = config.plugins?.[name] ?? {}
  const sourceConfig = explicit.source ?? { type: 'npm' }
  const newest = selected[0]
  const newestManifest = packument.versions[newest]

  // The published bytes, for the two things the packument does not carry.
  let entries = new Map()
  let tarballUnreadable = false
  try {
    entries = await getPublishedPackage(newestManifest.dist.tarball)
  } catch (error) {
    tarballUnreadable = true
    warn(
      'tarball-unreadable',
      `${name}: the ${newest} tarball is unreadable (${error.message}) — falling back to registry text`,
      { plugin: name },
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
        'version-skipped',
        `${name}@${version}: the registry publishes no timestamp for it — the version is skipped`,
        { plugin: name, version },
      )
      continue
    }
    const publishTimestamp = Math.floor(timestamp / 1000)
    if (publishTimestamp < 0 || publishTimestamp >= 1e11) {
      warn(
        'version-skipped',
        `${name}@${version}: publish time ${publishTimestamp} is out of range — the version is skipped`,
        { plugin: name, version },
      )
      continue
    }

    let source
    if (sourceConfig.type === 'git') {
      const commit = manifestVersion.gitHead
      if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/u.test(commit)) {
        warn(
          'version-skipped',
          `${name}@${version}: no 40-hex gitHead, so a git source cannot be pinned — the version is skipped`,
          { plugin: name, version },
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
        warn(
          'engine-invalid',
          `${name}@${version}: engines.dsh is a workspace range — it is not published`,
        )
      } else if (semver.validRange(dsh) !== null) {
        engines.dsh = dsh
      } else {
        warn(
          'engine-invalid',
          `${name}@${version}: engines.dsh ${JSON.stringify(dsh)} is not a SemVer range — it is omitted`,
          { plugin: name, version },
        )
      }
    }
    versions.push({ version, publishTimestamp, source, engines })
  }
  if (versions.length === 0) fail(`${name}: no listed version could be described`)

  // One unreadable tarball already says why the display text and the icon are missing; reporting the
  // four consequences separately would turn one cause into four codes and hide the cause in the noise.
  const locale = tarballUnreadable
    ? { titles: {}, descriptions: {}, languages: [] }
    : localeText(warn, entries)
  const title = localizedText(warn, explicit.title, locale.titles, undefined)
  const description = localizedText(
    warn,
    explicit.description,
    locale.descriptions,
    packument.description,
  )
  if (title === undefined)
    warn('title-missing', `${name}: no title in any language — the index shows the package name`)

  // Icon: an explicit URL/data URL, otherwise the file the package itself points at.
  let icon
  if (typeof explicit.icon === 'string' && explicit.icon.trim() !== '') {
    icon = explicit.icon.trim()
  } else if (
    !tarballUnreadable &&
    typeof manifest.icon === 'string' &&
    manifest.icon.trim() !== ''
  ) {
    const iconPath = `package/${manifest.icon.trim().replace(/^\.\//u, '')}`
    const bytes = entries.get(iconPath)
    const extension = extname(iconPath).toLowerCase()
    if (bytes === undefined) {
      warn(
        'icon-declared-missing',
        `${name}: package.json names ${manifest.icon}, but the tarball does not contain it`,
      )
    } else if (!ICON_EXTENSIONS.has(extension)) {
      warn(
        'icon-extension',
        `${name}: ${manifest.icon} is not an SVG/PNG/JPEG/WebP file — no icon is listed`,
      )
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
      'repository-invalid',
      `${name}: repository ${JSON.stringify(packument.repository)} is not an http(s) URL — it is omitted`,
      { plugin: name },
    )
  }

  // An override is a temporary scaffold: it exists because the published metadata is wrong, and it
  // becomes dead weight the moment a release fixes the source. Nobody remembers to delete it, so say
  // so. Comparing against what the registry already provides is the only way to notice.
  if (explicit.repository !== undefined) {
    const derived = repositoryOf(packument.repository, {})
    if (JSON.stringify(derived) === JSON.stringify(repository)) {
      warn(
        'override-redundant',
        `${name}: config.json overrides "repository", but the registry already publishes the same value — delete the override`,
        { plugin: name, field: 'repository' },
      )
    }
  }

  const keywords = keywordsOf(settings, packument.keywords, explicit.keywords, [name])
  const { category, labels } = curate(name, config, settings, keywords)
  const sortKeys = await sortKeysOf(explicit, repository, stars)

  const homepage = typeof explicit.homepage === 'string' ? explicit.homepage : packument.homepage
  if (
    typeof explicit.homepage === 'string' &&
    typeof packument.homepage === 'string' &&
    explicit.homepage === packument.homepage
  ) {
    warn(
      'override-redundant',
      `${name}: config.json overrides "homepage", but the registry already publishes the same value — delete the override`,
      { plugin: name, field: 'homepage' },
    )
  }
  const author = authorOf(explicit.author) ?? authorOf(packument.author)
  if (explicit.author !== undefined && authorOf(explicit.author) === authorOf(packument.author)) {
    warn(
      'override-redundant',
      `${name}: config.json overrides "author", but the registry already publishes the same value — delete the override`,
      { plugin: name, field: 'author' },
    )
  }

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
function pruneMetadata(metadata, plugins, enabled, quietGroups = new Set()) {
  if (!enabled) return metadata
  const usedCategories = new Set(plugins.map((plugin) => plugin.metadata.category).filter(Boolean))
  const usedLabels = new Set(plugins.flatMap((plugin) => plugin.metadata.labels))
  const usedSortKeys = new Set(plugins.flatMap((plugin) => Object.keys(plugin.metadata.sortKeys)))
  const keep = (group, used) => {
    const kept = {}
    for (const [id, declaration] of Object.entries(group)) {
      if (used.has(id)) kept[id] = declaration
      else if (quietGroups.has(group)) continue
      else
        warn(
          'metadata-unused',
          `metadata.${group === metadata.categories ? 'categories' : 'group'}: "${id}" is declared but unused — dropped`,
          { id },
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
  // A star count that could not be read leaves its sort key unused; reporting that as an unused
  // declaration would blame the curation for a network problem.
  const quiet = diagnostics.codes.includes('stars-unavailable')
    ? new Set([declared.sortKeys])
    : new Set()
  const metadata = pruneMetadata(declared, plugins, settings.pruneUnusedMetadata, quiet)

  const index = {
    format: 1,
    title: config.market.title,
    ...(config.market.description === undefined ? {} : { description: config.market.description }),
    metadata,
    plugins,
  }

  await writeFile(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  // A build heartbeat, separate from the index because format 1 has no member for it. Deployment
  // happens only when `index.json` changed, so `builtAt` is also "when this content last changed".
  const dsh = await latestDsh()
  const status = {
    builtAt: new Date().toISOString(),
    plugins: plugins.length,
    versions: plugins.reduce((total, plugin) => total + plugin.versions.length, 0),
    ...(dsh === undefined ? {} : { dsh }),
    warnings: diagnostics.size,
  }
  await writeFile(join(OUT, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8')

  // Build quality, deliberately outside `public/`: format 1 has no member for it, the deployed site
  // is the consumer's contract, and this file is for CI and maintainers.
  await mkdir(join(ROOT, 'build'), { recursive: true })
  await writeFile(
    join(ROOT, 'build', 'diagnostics.json'),
    `${JSON.stringify(diagnostics.toJSON(), null, 2)}\n`,
    'utf8',
  )

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
  ok(`public/index.json written (${plugins.length} plugins, ${diagnostics.size} diagnostic(s))`)
  ok(`index URL: ${settings.indexUrl}`)
  if (diagnostics.size > 0) {
    info('diagnostics are listed above; the build still produced a valid index')
    info(`codes: ${diagnostics.codes.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(`  [ERR]  ${error.message}`)
  process.exitCode = 1
})
