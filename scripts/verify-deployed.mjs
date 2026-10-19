#!/usr/bin/env node
/**
 * Verify what the world actually gets, after a deployment.
 *
 * Everything up to here checks files this machine produced. That is not the same claim as "the
 * published URL serves them": Pages can still be serving the previous generation from a CDN edge, a
 * deployment can silently publish an empty directory, and the index URL can be right in the build and
 * wrong in reality. All three look identical from inside the build.
 *
 * So this fetches the live URL and compares it with the file just built. Two things are asserted: the
 * shape (the official validator accepts it) and the identity (same plugin versions, and a `status.json`
 * whose `builtAt` is this build's, which is what distinguishes "updated" from "still the old copy").
 *
 * Freshness trick: the live request carries a unique query string. Pages caches by full URL, so a new
 * query is a cache miss — it reaches the origin instead of an edge copy up to ten minutes old. The
 * canonical URL (without the query) is still what the validator is given, because relative icon
 * references resolve against it.
 *
 * Usage: node scripts/verify-deployed.mjs [--url <index-url>] [--built <dir>] [--attempts 6]
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { MarketIndexError, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const problems = []
const error = (message) => problems.push(message)
const info = (message) => console.log(`  [INFO] ${message}`)
const ok = (message) => console.log(`  [OK]   ${message}`)

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/** The comparable shape of an index: what a reader would actually see. */
function fingerprint(index) {
  return index.plugins
    .map(
      (plugin) => `${plugin.name}@${plugin.versions.map((version) => version.version).join(',')}`,
    )
    .sort()
    .join(' | ')
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'error',
    headers: { accept: 'application/json', 'user-agent': 'dsh-market-verify' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  if (response.redirected) throw new Error('the response was redirected; the format forbids it')
  return response.json()
}

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'))
  const indexUrl = flag(
    'url',
    config.market?.indexUrl ?? 'https://dsh-plugin-lab.github.io/market/index.json',
  )
  const builtDir = flag('built', join(ROOT, 'public'))
  const attempts = Number(flag('attempts', '6'))
  const statusUrl = new URL('status.json', indexUrl).href

  const expected = JSON.parse(await readFile(join(builtDir, 'index.json'), 'utf8'))
  const expectedStatus = JSON.parse(await readFile(join(builtDir, 'status.json'), 'utf8'))
  info(`live URL: ${indexUrl}`)
  info(`built ${expected.plugins.length} plugin(s) at ${expectedStatus.builtAt}`)

  let lastReason
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // A unique query defeats the edge cache; see the header comment.
    const bust = `verify=${Date.now()}-${attempt}`
    try {
      const served = await fetchJson(`${indexUrl}?${bust}`)
      let index
      try {
        index = parseMarketIndex(served, indexUrl)
      } catch (failure) {
        if (failure instanceof MarketIndexError) {
          // A malformed live index is not a caching delay: it will never become correct by waiting.
          console.error(
            `  [ERR]  ${indexUrl} serves an invalid index: ${failure.path} ${failure.reason}`,
          )
          process.exitCode = 1
          return
        }
        throw failure
      }

      const live = fingerprint(index)
      const wanted = fingerprint(expected)
      if (live !== wanted) {
        lastReason = `the live index lists different versions than this build (attempt ${attempt}/${attempts})`
        info(lastReason)
        await sleep(15_000)
        continue
      }

      const status = await fetchJson(`${statusUrl}?${bust}`)
      if (status.builtAt !== expectedStatus.builtAt) {
        lastReason = `status.json says ${status.builtAt}, this build wrote ${expectedStatus.builtAt} (attempt ${attempt}/${attempts})`
        info(lastReason)
        await sleep(15_000)
        continue
      }

      ok(`${index.plugins.length} plugin(s), same versions as the build`)
      ok(`status.json builtAt matches: ${expectedStatus.builtAt}`)
      console.log('')
      for (const plugin of index.plugins) {
        info(`${plugin.name}: ${plugin.versions.map((version) => version.version).join(', ')}`)
      }
      return
    } catch (failure) {
      lastReason = `${failure.message} (attempt ${attempt}/${attempts})`
      info(lastReason)
      if (attempt < attempts) await sleep(15_000)
    }
  }

  error(`the deployed index never matched this build: ${lastReason}`)
  console.log('')
  for (const problem of problems) console.error(`  [ERR]  ${problem}`)
  console.error('  [ERR]  the deployment is not what readers are getting')
  process.exitCode = 1
}

main().catch((failure) => {
  console.error(`  [ERR]  ${failure.message}`)
  process.exitCode = 1
})
