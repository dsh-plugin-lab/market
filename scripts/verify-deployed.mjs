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
 * whose contents hash to what this run built. That digest — not a timestamp — is the identity: two
 * builds a second apart produce different times and identical bytes, a cached response produces an
 * old time with old bytes, and only the hash distinguishes "the deployment served this content" from
 * "it served the previous generation at some earlier moment".
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { ROOT, flag, info, ok, reportFatal } from './lib/shared/cli.mjs'
import { json, request } from './lib/shared/http.mjs'
import { MarketIndexError, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const problems = []
const error = (message) => problems.push(message)
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/** The digest of a body, in the same shape `status.json` publishes. */
function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

/** The response body as bytes: a digest has to be taken over exactly what a reader receives. */
const fetchBytes = async (url) =>
  Buffer.from(
    await (
      await request(url, {
        redirect: 'error',
        userAgent: 'dsh-market-verify',
        attempts: 1,
        timeoutMs: 20_000,
        accept: 'application/json',
      })
    ).arrayBuffer(),
  )

const fetchJson = (url) =>
  json(url, {
    redirect: 'error',
    userAgent: 'dsh-market-verify',
    attempts: 1,
    timeoutMs: 20_000,
  })

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'))
  const indexUrl = flag(
    'url',
    config.market?.indexUrl ?? 'https://dsh-plugin-lab.github.io/market/index.json',
  )
  const builtDir = flag('built', join(ROOT, 'public'))
  const attempts = Number(flag('attempts', '6'))
  const statusUrl = new URL('status.json', indexUrl).href

  const expectedBytes = await readFile(join(builtDir, 'index.json'))
  const expected = JSON.parse(expectedBytes.toString('utf8'))
  const expectedStatus = JSON.parse(await readFile(join(builtDir, 'status.json'), 'utf8'))
  const wantedHash = expectedStatus.content?.hash ?? digestOf(expectedBytes)
  const wantedBytes = expectedBytes.length
  info(`live URL: ${indexUrl}`)
  info(`this build: ${wantedHash} (${wantedBytes} bytes, ${expected.plugins.length} plugins)`)

  let lastReason
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // A unique query defeats the edge cache; see the header comment.
    const bust = `verify=${Date.now()}-${attempt}`
    try {
      const body = await fetchBytes(`${indexUrl}?${bust}`)
      const liveHash = digestOf(body)
      if (liveHash !== wantedHash) {
        lastReason = `the live index is ${liveHash}, this build produced ${wantedHash} (attempt ${attempt}/${attempts})`
        info(lastReason)
        await sleep(15_000)
        continue
      }

      let index
      try {
        index = parseMarketIndex(JSON.parse(body.toString('utf8')), indexUrl)
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

      // The hash already proves the bytes; the status file only has to agree about what they are.
      const status = await fetchJson(`${statusUrl}?${bust}`)
      if (status.content?.hash !== undefined && status.content.hash !== liveHash) {
        lastReason = `status.json claims ${status.content.hash} but the index hashes to ${liveHash} (attempt ${attempt}/${attempts})`
        info(lastReason)
        await sleep(15_000)
        continue
      }

      ok(`${index.plugins.length} plugin(s), the deployed bytes match this build`)
      ok(`content hash: ${liveHash} (${body.length} bytes)`)
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

main().catch(reportFatal)
