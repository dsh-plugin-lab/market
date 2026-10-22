#!/usr/bin/env node
/**
 * Build `public/index.json` — a plugin market index in format 1 — and the `status.json` next to it.
 *
 * This runs on a GitHub runner, where no plugin repository exists on disk, so nothing here reads a
 * plugin's checkout. Every machine fact comes from two published sources: the npm packument, and the
 * published tarball of the newest listed version (for `locale/` text and the icon the package itself
 * declares). Curation — market title, categories, labels, sort keys, each plugin's category and
 * labels — is the part no source can derive, so it lives in `config.json`.
 *
 * The file is **orchestration only**. Everything with a rule in it lives in a module:
 *
 *   1. inputs   — `domain/settings.mjs` resolves `config.json`; `sources/discovery.mjs` names the roster
 *   2. facts    — `sources/facts.mjs` composes registry + tarball + stars, all network
 *   3. model    — `domain/assemble.mjs` (derive → curate → assemble), pure
 *   4. contract — `domain/contract.mjs` refuses a member format 1 does not define
 *   5. emit     — `domain/document.mjs`, `domain/status.mjs`, and two writes
 *
 * What remains here is the order, the console, and the decision that a failure is fatal. That is the
 * whole point of the split: the interesting half is testable without a network, and this file can be
 * read top to bottom as a description of one build.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { Diagnostics } from './lib/domain/diagnosis.mjs'
import { buildEntry } from './lib/domain/assemble.mjs'
import { findUndefinedMembers } from './lib/domain/contract.mjs'
import { marketIndex } from './lib/domain/document.mjs'
import { pruneMetadata, starTargets, validateDeclarations } from './lib/domain/curation.mjs'
import { compareRoster, validateRoster } from './lib/domain/roster.mjs'
import { normaliseSettings, organizationOf } from './lib/domain/settings.mjs'
import { buildStatus } from './lib/domain/status.mjs'
import { ROOT, info, ok, reportFatal, warn } from './lib/shared/cli.mjs'
import { mapLimit } from './lib/shared/concurrency.mjs'
import { digestOf } from './lib/shared/digest.mjs'
import { renderTable } from './lib/shared/table.mjs'
import { repositoryOf } from './lib/shared/text.mjs'
import { discoverPlugins } from './lib/sources/discovery.mjs'
import { factsFor } from './lib/sources/facts.mjs'
import { starReader } from './lib/sources/github.mjs'
import { latestDsh } from './lib/sources/npm.mjs'

const OUT = join(ROOT, 'public')
const CONCURRENCY = 4

const diagnostics = new Diagnostics()
const report = (code, message, context) => diagnostics.add(code, message, context)

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

/**
 * The roster, and what it disagrees with curation about.
 *
 * The roster comes from the repositories; `config.json` no longer decides who is listed, only how. The
 * dangerous direction is "curated, not discovered": a partial listing still produces a well-formed
 * index that exits 0 and quietly delists whatever it missed, so the names somebody chose to curate are
 * the anchor. The benign direction is said out loud too, because a silent fallback to `keywordRules`
 * looks exactly like a curation nobody wrote.
 */
async function rosterOf(config) {
  const org = organizationOf(config)
  const names = validateRoster(await discoverPlugins(org))
  const { orphaned, uncurated } = compareRoster({
    curated: Object.keys(config.plugins ?? {}),
    discovered: names,
  })
  for (const name of orphaned)
    report('curation-orphaned', `${name}: curated in config.json, but discovery did not find it`, {
      plugin: name,
    })
  for (const name of uncurated)
    warn(`${name}: discovered but not curated — category and labels fall back to keywordRules`)
  info(`${names.length} plugin repositories discovered in ${org}`)
  return names
}

/** The facts each plugin needs, fetched concurrently but kept in roster order. */
async function factsOf(names, config, settings) {
  const stars = starReader()
  return mapLimit(names, CONCURRENCY, async (name) => {
    const explicit = config.plugins?.[name] ?? {}
    // Which repositories a plugin's stars come from is a curation rule; the fetcher is told, not
    // taught, so `sources/` keeps its single dependency direction.
    const targetsFor = (published) =>
      starTargets(explicit, repositoryOf(explicit.repository ?? published.repository, {}))
    return {
      name,
      explicit,
      ...(await factsFor({ name, explicit, stars, targetsFor, report })),
    }
  })
}

/** The metadata block, with every dangling reference refused and every unused declaration dropped. */
function metadataOf(config, plugins, settings) {
  const declared = {
    categories: config.metadata?.categories ?? {},
    labels: config.metadata?.labels ?? {},
    sortKeys: config.metadata?.sortKeys ?? {},
  }
  validateDeclarations(declared, plugins)
  // A star count that could not be read leaves its sort key unused; reporting that as an unused
  // declaration would blame the curation for a network problem.
  const quiet = diagnostics.codes.includes('stars-unavailable') ? new Set(['sortKeys']) : new Set()
  return pruneMetadata(declared, plugins, settings.pruneUnusedMetadata, report, quiet)
}

/** The one table this build prints: what each plugin costs and what its entry contains. */
function printBuildTable(entries) {
  const kib = (bytes) => `${Math.round((bytes ?? 0) / 1024)}KB`
  const rows = entries.map((entry) => ({
    plugin: entry.plugin.name,
    versions: String(entry.plugin.versions.length),
    newest: entry.newest,
    languages: entry.languages.join(',') || '-',
    tarball: kib(entry.fetchedBytes),
    unpacked: kib(entry.unpackedBytes),
    largest:
      entry.largestFile === undefined
        ? '-'
        : `${entry.largestFile.path} (${kib(entry.largestFile.bytes)})`,
  }))
  console.log('')
  for (const line of renderTable(
    ['plugin', 'versions', 'newest', 'languages', 'tarball', 'unpacked', 'largest'],
    rows,
    { align: { versions: 'right' } },
  ))
    console.log(line)
}

async function currentDsh() {
  try {
    return await latestDsh()
  } catch (error) {
    diagnostics.add(
      'dsh-version-unavailable',
      `could not read the current DSH version (${error.message})`,
    )
    return undefined
  }
}

async function main() {
  const startedAt = new Date()
  const config = await readJson(join(ROOT, 'config.json'))
  const settings = normaliseSettings(config)
  const names = await rosterOf(config)

  // The output is cleared before anything writes into it; a stale icon from a removed plugin would
  // otherwise survive every later build.
  await rm(OUT, { recursive: true, force: true })
  await mkdir(join(OUT, 'icons'), { recursive: true })

  const facts = await factsOf(names, config, settings)
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
  const index = marketIndex({
    market: config.market,
    metadata: metadataOf(config, plugins, settings),
    plugins,
  })
  findUndefinedMembers(index, (message) => {
    throw new Error(`the index carries a member format 1 does not define — ${message}`)
  })

  const serialised = `${JSON.stringify(index, null, 2)}\n`
  await writeFile(join(OUT, 'index.json'), serialised, 'utf8')

  // The index's own digest. This — not a timestamp — is what proves a deployment served *this* build:
  // two builds a second apart produce different times and identical bytes, and a cached response
  // produces an old time with old bytes. Only the hash answers "is the live copy this content?".
  const content = {
    hash: digestOf(serialised),
    bytes: Buffer.byteLength(serialised),
    pluginCount: plugins.length,
  }
  const dsh = await currentDsh()
  const status = buildStatus({
    content,
    startedAt,
    finishedAt: new Date(),
    entries: built,
    diagnostics,
    dsh,
    localTimeZones: settings.localTimeZones,
  })
  await writeFile(join(OUT, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8')

  // Build quality, deliberately outside `public/`: format 1 has no member for it, the deployed site is
  // the consumer's contract, and this file is for CI and maintainers.
  await mkdir(join(ROOT, 'build'), { recursive: true })
  await writeFile(
    join(ROOT, 'build', 'diagnostics.json'),
    `${JSON.stringify(diagnostics.toJSON(new Date().toISOString()), null, 2)}\n`,
    'utf8',
  )

  printBuildTable(built)
  console.log('')
  ok(`public/index.json written (${plugins.length} plugins, ${diagnostics.size} diagnostic(s))`)
  ok(`index URL: ${settings.indexUrl}`)
  if (diagnostics.size > 0) info(`codes: ${diagnostics.codes.join(', ')}`)
}

main().catch(reportFatal)
