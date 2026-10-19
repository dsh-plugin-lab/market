#!/usr/bin/env node
/**
 * Validate `public/index.json` with the official format-1 validator before anything is deployed.
 *
 * The validator (`parseMarketIndex`) applies the rules DSH itself applies when it reads an index, so
 * a green run here means the index will not be rejected on the user's machine. It also *drops* members
 * the format does not define, silently — which is how a plausible-looking field like `dist-tags` can
 * sit in a generator for months and never reach a reader. This script therefore reports dropped
 * members as errors too, and checks that every relative icon it produced exists on disk.
 *
 * Usage: node scripts/check-index.mjs [--url <index-url>]
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import {
  MarketIndexError,
  marketInstallTarget,
  parseMarketIndex,
} from '@deepseek-ai/dsh-plugin-market-index'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PUBLIC = join(ROOT, 'public')
const INDEX_FILE = join(PUBLIC, 'index.json')

/** Members format 1 defines per record; anything else is dropped by the validator. */
const ALLOWED = {
  index: ['format', 'title', 'description', 'metadata', 'plugins'],
  metadata: ['categories', 'labels', 'sortKeys'],
  declaration: ['title'],
  sortKeyDeclaration: ['title', 'order'],
  plugin: [
    'name',
    'title',
    'description',
    'icon',
    'author',
    'homepage',
    'repository',
    'metadata',
    'versions',
  ],
  pluginMetadata: ['category', 'keywords', 'labels', 'sortKeys'],
  repository: ['url', 'directory'],
  version: ['version', 'publishTimestamp', 'source', 'engines'],
  sourceNpm: ['type', 'registry'],
  sourceGit: ['type', 'url', 'commit', 'path'],
  engines: ['dsh'],
}

const problems = []
const error = (message) => problems.push(message)
const info = (message) => console.log(`  [INFO] ${message}`)
const ok = (message) => console.log(`  [OK]   ${message}`)
const warn = (message) => console.log(`  [WARN] ${message}`)

function checkMembers(value, kind, path) {
  for (const key of Object.keys(value)) {
    if (!ALLOWED[kind].includes(key))
      error(`${path}.${key}: format 1 does not define this member — DSH drops it silently`)
  }
}

function walk(raw) {
  checkMembers(raw, 'index', '$')
  if (raw.metadata && typeof raw.metadata === 'object') {
    checkMembers(raw.metadata, 'metadata', '$.metadata')
    for (const group of ['categories', 'labels']) {
      for (const [id, value] of Object.entries(raw.metadata[group] ?? {})) {
        checkMembers(value, 'declaration', `$.metadata.${group}.${id}`)
      }
    }
    for (const [id, value] of Object.entries(raw.metadata.sortKeys ?? {})) {
      checkMembers(value, 'sortKeyDeclaration', `$.metadata.sortKeys.${id}`)
    }
  }
  for (const [position, plugin] of (raw.plugins ?? []).entries()) {
    const at = `$.plugins[${position}]`
    checkMembers(plugin, 'plugin', at)
    if (plugin.metadata && typeof plugin.metadata === 'object') {
      checkMembers(plugin.metadata, 'pluginMetadata', `${at}.metadata`)
    }
    if (plugin.repository && typeof plugin.repository === 'object') {
      checkMembers(plugin.repository, 'repository', `${at}.repository`)
    }
    for (const [versionPosition, version] of (plugin.versions ?? []).entries()) {
      const versionAt = `${at}.versions[${versionPosition}]`
      checkMembers(version, 'version', versionAt)
      checkMembers(
        version.source ?? {},
        version.source?.type === 'git' ? 'sourceGit' : 'sourceNpm',
        `${versionAt}.source`,
      )
      if (version.engines !== undefined)
        checkMembers(version.engines, 'engines', `${versionAt}.engines`)
    }
  }
}

/** The version DSH picks as an entry's default: the highest non-prerelease one. */
function defaultVersion(plugin) {
  const stable = plugin.versions.filter((version) => semver.prerelease(version.version) === null)
  return (stable[0] ?? plugin.versions[0])?.version
}

/**
 * Whether a version runs on a given DSH, using the reader's own rule: the plugin's `engines.dsh`
 * decides alone, and prereleases participate in the range (DSH itself ships prereleases).
 */
function runsOn(version, dsh) {
  const range = version.engines.dsh
  if (range === undefined) return true
  return semver.satisfies(dsh, range, { includePrerelease: true })
}

/** The newest published DSH, which is the version a fresh reader will be running. */
async function currentDsh(flagValue) {
  if (flagValue !== undefined) return flagValue
  try {
    const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh', {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const packument = await response.json()
    return packument['dist-tags']?.latest
  } catch (failure) {
    warn(
      `could not read the current DSH version (${failure.message}); compatibility is not checked`,
    )
    return undefined
  }
}

async function main() {
  const urlFlag = process.argv.indexOf('--url')
  const raw = JSON.parse(await readFile(INDEX_FILE, 'utf8'))
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'))
  const indexUrl =
    urlFlag === -1
      ? (config.market?.indexUrl ?? 'https://dsh-plugin-lab.github.io/market/index.json')
      : process.argv[urlFlag + 1]
  info(`index file: ${INDEX_FILE}`)
  info(`index URL (icons resolve against it): ${indexUrl}`)

  walk(raw)

  let index
  try {
    index = parseMarketIndex(raw, indexUrl)
  } catch (failure) {
    if (failure instanceof MarketIndexError) {
      console.error(`  [ERR]  ${failure.path} ${failure.reason}`)
      process.exitCode = 1
      return
    }
    throw failure
  }
  ok(`parseMarketIndex accepted format ${index.format}`)

  for (const plugin of index.plugins) {
    if (
      plugin.icon !== undefined &&
      !plugin.icon.startsWith('data:') &&
      !/^https?:/u.test(plugin.icon)
    ) {
      error(`${plugin.name}: icon ${plugin.icon} did not resolve to an absolute URL`)
    }
    if (
      plugin.icon !== undefined &&
      !plugin.icon.startsWith('data:') &&
      plugin.icon.startsWith(indexUrl.replace(/[^/]*$/u, ''))
    ) {
      const relative = plugin.icon.slice(indexUrl.replace(/[^/]*$/u, '').length)
      if (!existsSync(join(PUBLIC, relative)))
        error(`${plugin.name}: icon file ${relative} is missing from public/`)
    }
  }

  console.log('')
  const dshFlag = process.argv.indexOf('--dsh')
  const dsh = await currentDsh(dshFlag === -1 ? undefined : process.argv[dshFlag + 1])
  if (dsh !== undefined) info(`compatibility measured against DSH ${dsh}`)
  console.log(
    `  ${'plugin'.padEnd(28)} ${'versions'.padStart(8)}  ${'default'.padEnd(14)} ${'engines.dsh'.padEnd(30)} ${'runs on'.padEnd(10)} icon`,
  )
  console.log(
    `  ${'-'.repeat(28)} ${'-'.repeat(8)}  ${'-'.repeat(14)} ${'-'.repeat(30)} ${'-'.repeat(10)} ----`,
  )
  for (const plugin of index.plugins) {
    const newest = plugin.versions[0]
    const compatible =
      dsh === undefined
        ? '-'
        : `${plugin.versions.filter((version) => runsOn(version, dsh)).length}/${plugin.versions.length}`
    if (dsh !== undefined && plugin.versions.every((version) => !runsOn(version, dsh))) {
      warn(
        `${plugin.name}: no listed version declares support for DSH ${dsh} — the entry would install nothing`,
      )
    }
    console.log(
      `  ${plugin.name.padEnd(28)} ${String(plugin.versions.length).padStart(8)}  ` +
        `${String(defaultVersion(plugin)).padEnd(14)} ${(newest.engines.dsh ?? 'any').padEnd(30)} ` +
        `${compatible.padEnd(10)} ${plugin.icon === undefined ? '-' : 'yes'}`,
    )
  }
  console.log('')
  for (const plugin of index.plugins) {
    info(
      `${plugin.name} install target: ${marketInstallTarget(plugin.name, plugin.versions[0]).spec}`,
    )
  }

  if (problems.length > 0) {
    console.log('')
    for (const problem of problems) console.error(`  [ERR]  ${problem}`)
    console.error(`  [ERR]  ${problems.length} problem(s) found`)
    process.exitCode = 1
    return
  }
  console.log('')
  ok(`${index.plugins.length} plugin(s) valid, no dropped members, every icon present`)
}

main().catch((failure) => {
  console.error(`  [ERR]  ${failure.message}`)
  process.exitCode = 1
})
