#!/usr/bin/env node
/**
 * Build `public/index.json` — a plugin market index in format 1 — from the organization and
 * `config.json`.
 *
 * This runs on a GitHub runner, where no plugin repository exists on disk, so nothing here reads a
 * plugin's checkout. Every machine fact comes from two published sources: the npm packument, and the
 * published tarball of the newest listed version (for `locale/` text and the icon the package itself
 * declares). Curation — market title, categories, labels, sort keys, each plugin's category and
 * labels — is the part no source can derive, so it lives in `config.json` and is merged in here.
 *
 * **Which plugins are listed is not curation.** It used to be a hand-written `plugins.txt`; it is now
 * read from the organization, where a plugin repository declares itself (a `dsh-` name and a `dsh`
 * field). A roster kept by hand has to be updated when a repository is created, can name a package
 * that no longer exists, and can miss a repository nobody remembered to add — none of which reports
 * itself. The list is **alphabetical by package name**, because a hand-typed order is a fact nobody
 * can reconstruct later.
 *
 * The file is **orchestration only**, in five stages:
 *
 *   1. inputs   — `config.json`, the organization's plugin repositories
 *   2. facts    — packuments, tarballs, star counts (all network, all in `lib/sources/`)
 *   3. model    — facts + curation → the document (pure, in `lib/domain/`)
 *   4. contract — the document carries only members format 1 defines
 *   5. emit     — write `public/`, `build/diagnostics.json`
 *
 * Anything that needs a request happens in stage 2 and completes before stage 3 starts. That is what
 * lets the interesting half be tested without a network, and it is why star counts are resolved for a
 * whole plugin at once instead of lazily in the middle of curation.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { Diagnostics } from './lib/domain/diagnosis.mjs'
import { buildEntry } from './lib/domain/assemble.mjs'
import { pruneMetadata, starTargets } from './lib/domain/curation.mjs'
import { findUndefinedMembers } from './lib/domain/contract.mjs'
import { ROOT, info, ok, reportFatal } from './lib/shared/cli.mjs'
import { digestOf } from './lib/shared/digest.mjs'
import { repositoryOf } from './lib/shared/text.mjs'
import { discoverPlugins } from './lib/sources/discovery.mjs'
import { latestDsh, packument, tarballEntries } from './lib/sources/npm.mjs'
import { starReader } from './lib/sources/github.mjs'

const OUT = join(ROOT, 'public')
const CONCURRENCY = 4

/**
 * The npm package-name grammar, applied to the name a repository declares.
 *
 * Discovery reads it from a manifest, which is a document someone types by hand — so it is checked
 * here rather than trusted. A bad name fails the build; it does not reach DSH.
 */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

const diagnostics = new Diagnostics()
const report = (code, message, context) => diagnostics.add(code, message, context)

// ---------------------------------------------------------------------------
// Stage 1 — inputs
// ---------------------------------------------------------------------------

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/**
 * The organization whose repositories are the market's roster.
 *
 * Derived from the published index URL rather than written down again: `config.market.indexUrl` is
 * already the one place that says where this market lives, and a second copy of the organization name
 * is a second thing to keep in step. Same derivation as `check-org-drift.mjs`.
 */
function organizationOf(config) {
  return new URL(config.market.indexUrl).hostname.split('.')[0]
}

/**
 * The listed plugins, as npm package names, in display order.
 *
 * The roster comes from the repositories; `config.json` no longer decides who is listed, only how.
 * A name that discovery produces but the manifest grammar rejects stops the build: it would otherwise
 * be looked up on npm, fail, and be reported as "no published version" — the wrong diagnosis.
 */
async function listedPlugins(config) {
  const org = organizationOf(config)
  const found = await discoverPlugins(org)
  if (found.length === 0)
    throw new Error(
      `no plugin repository found in ${org} — discovery is broken, not the plugins (no dsh-* repository declares a dsh field)`,
    )
  for (const plugin of found) {
    if (!PACKAGE_NAME.test(plugin.name))
      throw new Error(
        `${plugin.repository} declares ${JSON.stringify(plugin.name)}, which is not an npm package name`,
      )
  }
  const names = found.map((plugin) => plugin.name)
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate !== undefined)
    throw new Error(
      `${duplicate} is declared by more than one repository — the roster must name each package once`,
    )
  info(`${names.length} plugin repositories discovered in ${org}`)
  return names
}

/**
 * The build knobs, with the defaults that make a bare `config.json` work: every published version
 * is listed, prereleases included, and unused declarations are pruned so the Discover page never
 * shows an empty category button.
 */
function normaliseSettings(config) {
  const market = config.market ?? {}
  if (typeof market.title?.en !== 'string')
    throw new Error('config.json: "market.title.en" is required')
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

// ---------------------------------------------------------------------------
// Stage 2 — facts
// ---------------------------------------------------------------------------

/**
 * Everything one plugin needs from the outside world, fetched before any decision is made.
 *
 * Two facts are allowed to be absent rather than fatal, because both have an honest degraded form:
 * an unreadable tarball still leaves the registry's text, and an unreadable star count still leaves
 * the plugin listed without that sort key. Their codes are environmental or degradations, never
 * exceptions.
 */
async function factsFor(name, explicit, stars) {
  const published = await packument(name)

  const newest = Object.keys(published.versions ?? {})
    .sort()
    .at(-1)
  let tarball
  try {
    const fetched = await tarballEntries(published.versions[newest].dist.tarball)
    tarball = { entries: fetched.entries, sizes: fetched.sizes, bytes: fetched.bytes }
  } catch (error) {
    // "We could not fetch it" is not "the package does not have it": this is a network event, and the
    // model is told so explicitly instead of inferring it from a missing value.
    tarball = { unreadable: error.message }
    diagnostics.add('tarball-unreadable', `${name}: the tarball is unreadable (${error.message})`, {
      plugin: name,
    })
  }

  // Star counts are resolved here, for every target the curation mentions, so the model can stay pure.
  // The repository has to be normalised first: npm publishes it as `git+https://…`, and the sort-key
  // grammar only understands plain http(s).
  const repository = repositoryOf(explicit.repository ?? published.repository, {})
  const counts = new Map()
  for (const [owner, repo] of starTargets(explicit, repository)) {
    try {
      counts.set(`${owner}/${repo}`, await stars(owner, repo))
    } catch (error) {
      counts.set(`${owner}/${repo}`, undefined)
      diagnostics.add('stars-unavailable', `github stars for ${owner}/${repo}: ${error.message}`)
    }
  }

  return { published, tarball, counts }
}

// ---------------------------------------------------------------------------
// Stage 3 — model, 4 — contract, 5 — emit
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = new Date()
  const config = await readJson(join(ROOT, 'config.json'))
  const settings = normaliseSettings(config)
  const names = await listedPlugins(config)

  // The output is cleared before anything writes into it; a stale icon from a removed plugin would
  // otherwise survive every later build.
  await rm(OUT, { recursive: true, force: true })
  await mkdir(join(OUT, 'icons'), { recursive: true })

  // Facts are fetched concurrently, the model runs after every fact is in hand. The order of `entries`
  // is the order of the discovered roster (alphabetical by package name), never the order responses
  // arrived in — the index is a document, not a transcript of the network.
  const stars = starReader()
  const facts = await mapLimit(names, CONCURRENCY, async (name) => ({
    name,
    explicit: config.plugins?.[name] ?? {},
    ...(await factsFor(name, config.plugins?.[name] ?? {}, stars)),
  }))

  const built = facts.map(({ name, explicit, published, tarball, counts }) =>
    buildEntry({
      name,
      config,
      explicit,
      settings,
      packument: published,
      tarball,
      starsFor: (owner, repo) => counts.get(`${owner}/${repo}`),
      report,
    }),
  )
  for (const entry of built) {
    for (const asset of entry.assets) await writeFile(join(OUT, asset.file), asset.bytes)
  }

  const plugins = built.map((entry) => entry.plugin)
  const declared = {
    categories: config.metadata?.categories ?? {},
    labels: config.metadata?.labels ?? {},
    sortKeys: config.metadata?.sortKeys ?? {},
  }
  validateDeclarations(declared, plugins)
  // A star count that could not be read leaves its sort key unused; reporting that as an unused
  // declaration would blame the curation for a network problem.
  const quiet = diagnostics.codes.includes('stars-unavailable') ? new Set(['sortKeys']) : new Set()
  const metadata = pruneMetadata(declared, plugins, settings.pruneUnusedMetadata, report, quiet)

  const index = {
    format: 1,
    title: config.market.title,
    ...(config.market.description === undefined ? {} : { description: config.market.description }),
    metadata,
    plugins,
  }

  findUndefinedMembers(index, (message) => {
    throw new Error(`the index carries a member format 1 does not define — ${message}`)
  })

  const serialised = `${JSON.stringify(index, null, 2)}\n`
  await writeFile(join(OUT, 'index.json'), serialised, 'utf8')

  // The index's own digest. This — not a timestamp — is what proves a deployment served *this* build:
  // two builds a second apart produce different times and identical bytes, and a cached response
  // produces an old time with old bytes. Only the hash answers "is the live copy this content?".
  const contentHash = digestOf(serialised)

  let dsh
  try {
    dsh = await latestDsh()
  } catch (error) {
    diagnostics.add(
      'dsh-version-unavailable',
      `could not read the current DSH version (${error.message})`,
    )
  }

  /**
   * The build's own record, separate from the index because format 1 defines no member for it.
   * Two identities, kept apart on purpose:
   *
   *   - `content` is what a reader actually gets, and the verifier compares it byte for byte;
   *   - `build` describes this run and is for humans — it changes every time, so it can never be the
   *     thing a deployment is judged by.
   *
   * Per-plugin facts stay per plugin. A single total ("20 versions") answers no question anyone has:
   * the reader wants to know which versions of which plugin, and the maintainer wants to know what
   * this run paid for each one.
   */
  const status = {
    schema: 1,
    content: {
      hash: contentHash,
      bytes: Buffer.byteLength(serialised),
      pluginCount: plugins.length,
    },
    build: {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      ...(dsh === undefined ? {} : { dsh }),
      source: 'npm',
    },
    plugins: built.map((entry) => ({
      name: entry.plugin.name,
      newest: entry.newest,
      versions: entry.plugin.versions.map((version) => version.version),
      languages: entry.languages,
      title: entry.plugin.title?.en ?? undefined,
      icon: entry.plugin.icon !== undefined,
      // What this package costs: the bytes this build downloaded, what a consumer unpacks, and the one
      // file responsible for most of it. Recorded because a package's size is otherwise only felt as
      // "the build is slow", and because the cause belongs next to the number.
      package: {
        downloadedBytes: entry.fetchedBytes,
        unpackedBytes: entry.unpackedBytes,
        fileCount: entry.fileCount,
        ...(entry.largestFile === undefined
          ? {}
          : { largestFile: entry.largestFile.path, largestFileBytes: entry.largestFile.bytes }),
      },
      // Versions the registry marks deprecated. They are not offered, and the reason they are absent
      // belongs here rather than in a diagnostic: this is an intended, permanent exclusion, and a
      // warning that fires on every build is a warning nobody reads.
      ...(entry.excluded?.deprecated?.length > 0
        ? { excluded: { deprecated: entry.excluded.deprecated } }
        : {}),
    })),
    diagnostics: {
      count: diagnostics.size,
      codes: diagnostics.codes,
    },
  }
  await writeFile(join(OUT, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8')

  // Build quality, deliberately outside `public/`: format 1 has no member for it, the deployed site
  // is the consumer's contract, and this file is for CI and maintainers.
  await mkdir(join(ROOT, 'build'), { recursive: true })
  await writeFile(
    join(ROOT, 'build', 'diagnostics.json'),
    `${JSON.stringify(diagnostics.toJSON(new Date().toISOString()), null, 2)}\n`,
    'utf8',
  )

  console.log('')
  console.log(
    `  ${'plugin'.padEnd(28)} ${'versions'.padStart(8)}  ${'newest'.padEnd(14)} ${'languages'.padEnd(12)} ${'tarball'.padEnd(9)} ${'unpacked'.padEnd(9)} largest`,
  )
  console.log(
    `  ${'-'.repeat(28)} ${'-'.repeat(8)}  ${'-'.repeat(14)} ${'-'.repeat(12)} ${'-'.repeat(9)} ${'-'.repeat(9)} -------`,
  )
  for (const entry of built) {
    const kib = (bytes) => `${Math.round((bytes ?? 0) / 1024)}KB`
    console.log(
      `  ${entry.plugin.name.padEnd(28)} ${String(entry.plugin.versions.length).padStart(8)}  ` +
        `${entry.newest.padEnd(14)} ${(entry.languages.join(',') || '-').padEnd(12)} ` +
        `${kib(entry.fetchedBytes).padEnd(9)} ${kib(entry.unpackedBytes).padEnd(9)} ` +
        `${entry.largestFile === undefined ? '-' : `${entry.largestFile.path} (${kib(entry.largestFile.bytes)})`}`,
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

/** A curation declaration a plugin points at must exist, or the Discover page has a dead filter. */
function validateDeclarations(metadata, plugins) {
  for (const plugin of plugins) {
    const { category, labels, sortKeys } = plugin.metadata
    if (category !== undefined && metadata.categories[category] === undefined) {
      throw new Error(
        `${plugin.name}: category "${category}" is not declared in config.json metadata.categories`,
      )
    }
    for (const label of labels) {
      if (metadata.labels[label] === undefined) {
        throw new Error(
          `${plugin.name}: label "${label}" is not declared in config.json metadata.labels`,
        )
      }
    }
    for (const id of Object.keys(sortKeys)) {
      if (metadata.sortKeys[id] === undefined) {
        throw new Error(
          `${plugin.name}: sort key "${id}" is not declared in config.json metadata.sortKeys`,
        )
      }
    }
  }
}

/** Run `worker` over `items`, `limit` at a time, keeping result order aligned with input order. */
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

main().catch(reportFatal)
