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
import semver from 'semver'
import { ratchet } from './lib/domain/diagnosis.mjs'
import { findUndefinedMembers } from './lib/domain/contract.mjs'
import { latestDsh } from './lib/sources/npm.mjs'
import { ROOT, flag, info, ok, reportFatal, warn } from './lib/shared/cli.mjs'
import {
  MarketIndexError,
  marketInstallTarget,
  parseMarketIndex,
} from '@deepseek-ai/dsh-plugin-market-index'

const PUBLIC = join(ROOT, 'public')
const INDEX_FILE = join(PUBLIC, 'index.json')
const DIAGNOSTICS_FILE = join(ROOT, 'build', 'diagnostics.json')
const BASELINE_FILE = join(ROOT, 'diagnostics-baseline.json')

/** What the build recorded about its own quality; absent when only `check` was run. */
async function readDiagnostics() {
  if (!existsSync(DIAGNOSTICS_FILE)) {
    warn(`${DIAGNOSTICS_FILE} is missing — run \`pnpm run build\` first to ratchet diagnostics`)
    return undefined
  }
  return JSON.parse(await readFile(DIAGNOSTICS_FILE, 'utf8'))
}

/** The codes this repository has explicitly accepted. */
async function readBaseline() {
  if (!existsSync(BASELINE_FILE)) {
    error(`${BASELINE_FILE} is missing — a build must have something to ratchet against`)
    return []
  }
  const baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8'))
  if (!Array.isArray(baseline.codes)) {
    error(`${BASELINE_FILE}: "codes" must be an array`)
    return []
  }
  return baseline.codes
}

const problems = []
const error = (message) => problems.push(message)

/**
 * The contract lives in one place, shared with the generator: a member the format does not define is
 * dropped by the reader silently, so writing one and checking for one must use the same table.
 */
const walk = (raw) => findUndefinedMembers(raw, error)

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
    return await latestDsh()
  } catch (failure) {
    warn(
      `could not read the current DSH version (${failure.message}); compatibility is not checked`,
    )
    return undefined
  }
}

async function main() {
  const raw = JSON.parse(await readFile(INDEX_FILE, 'utf8'))
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'))
  const indexUrl =
    flag('url', undefined) ??
    config.market?.indexUrl ??
    'https://dsh-plugin-lab.github.io/market/index.json'
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

  // The ratchet: a degradation the build emitted but the baseline does not list is a new silent loss,
  // and it fails here rather than scrolling past in a log. The reverse direction is reported too, so a
  // baseline cannot quietly keep allowances nobody needs any more.
  //
  // Codes that depend on the machine rather than on the plugins are reported and never compared: a
  // local run without a GitHub token hits the rate limit, CI passes a token and does not, and a
  // baseline that flips on environment alone teaches people to ignore it.
  const diagnostics = await readDiagnostics()
  if (diagnostics !== undefined) {
    const baseline = await readBaseline()
    // The comparison is a pure decision (`ratchet`); the wording and the volume of each outcome are
    // this command's business, because deciding what is loud belongs to the entry point.
    const { added, removed, ignored } = ratchet(diagnostics.codes, baseline)
    for (const code of added) {
      const items = diagnostics.items.filter((item) => item.code === code)
      const context = items
        .slice(0, 3)
        .map((item) => [item.plugin, item.version].filter(Boolean).join('@') || item.message)
        .join('; ')
      error(
        `new diagnostic ${code} (${items.length}x) — ${context}. Understand it, then add "${code}" to diagnostics-baseline.json or fix the cause`,
      )
    }
    for (const code of removed) {
      warn(
        `diagnostics-baseline.json lists "${code}", but this build did not emit it — remove it from the baseline`,
      )
    }
    for (const code of ignored) {
      warn(`${code}: environment-dependent, reported but not ratcheted (no GitHub token?)`)
    }
    info(
      `diagnostics: ${diagnostics.count} occurrence(s), codes ${
        diagnostics.codes.length === 0 ? 'none' : diagnostics.codes.join(', ')
      }`,
    )
  }

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
  const dsh = await currentDsh(flag('dsh', undefined))
  if (dsh !== undefined) info(`compatibility measured against DSH ${dsh}`)

  // Widths are measured, not fixed: a declared range grows every time upstream opens another
  // prerelease line, and a hard-coded column turns that into a misaligned table nobody trusts.
  const rows = index.plugins.map((plugin) => {
    const newest = plugin.versions[0]
    if (dsh !== undefined && plugin.versions.every((version) => !runsOn(version, dsh))) {
      warn(
        `${plugin.name}: no listed version declares support for DSH ${dsh} — the entry would install nothing`,
      )
    }
    return {
      plugin: plugin.name,
      versions: String(plugin.versions.length),
      default: String(defaultVersion(plugin)),
      engines: newest.engines.dsh ?? 'any',
      runsOn:
        dsh === undefined
          ? '-'
          : `${plugin.versions.filter((version) => runsOn(version, dsh)).length}/${plugin.versions.length}`,
      icon: plugin.icon === undefined ? '-' : 'yes',
    }
  })
  const columns = ['plugin', 'versions', 'default', 'engines', 'runsOn', 'icon']
  const width = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(column.length, ...rows.map((row) => row[column].length)),
    ]),
  )
  const line = (row) => `  ${columns.map((column) => row[column].padEnd(width[column])).join('  ')}`
  console.log(line(Object.fromEntries(columns.map((column) => [column, column]))))
  console.log(`  ${columns.map((column) => '-'.repeat(width[column])).join('  ')}`)
  for (const row of rows) console.log(line(row))
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

main().catch(reportFatal)
