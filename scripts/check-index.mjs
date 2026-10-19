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
  console.log(
    `  ${'plugin'.padEnd(28)} ${'versions'.padStart(8)}  ${'default'.padEnd(14)} ${'engines.dsh'.padEnd(30)} icon`,
  )
  console.log(`  ${'-'.repeat(28)} ${'-'.repeat(8)}  ${'-'.repeat(14)} ${'-'.repeat(30)} ----`)
  for (const plugin of index.plugins) {
    const newest = plugin.versions[0]
    console.log(
      `  ${plugin.name.padEnd(28)} ${String(plugin.versions.length).padStart(8)}  ` +
        `${String(defaultVersion(plugin)).padEnd(14)} ${(newest.engines.dsh ?? 'any').padEnd(30)} ${plugin.icon === undefined ? '-' : 'yes'}`,
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
