#!/usr/bin/env node
/**
 * Compare what the organization's repositories declare with what the market advertises.
 *
 * The index is a photograph of npm. Between a merge and a release there is a gap the market cannot see
 * and therefore cannot report: the repository says 0.5.0, npm still serves 0.4.0, and every check in
 * this repository is correctly green. That gap is invisible for as long as nobody looks — one plugin
 * sat in it for two weeks because its publish was blocked on a credential nobody knew had expired.
 *
 * So this asks the other side: for every public repository in the organization, read its `package.json`
 * from the default branch, and compare the version there with the version the market lists.
 *
 * Two findings, both about drift rather than about failure:
 *
 *   - unpublished: the repository is ahead of npm, i.e. merged but not released;
 *   - missing:     the repository is a DSH plugin (it has a `dsh` field) but is not in `plugins.txt`.
 *
 * It only reports. Deciding to release, or to list a plugin, is a human act — an automatic fix here
 * would make the market claim things nobody decided.
 *
 * Usage: node scripts/check-org-drift.mjs [--write <file>] [--org <name>] [--strict]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import semver from 'semver'
import { organizationRepositories, repositoryManifest } from './lib/sources/github.mjs'
import { json } from './lib/shared/http.mjs'
import { ROOT, flag, info, ok, reportFatal, warn } from './lib/shared/cli.mjs'

/** The manifest of a repository, or `undefined` when it has none — absence is the ordinary case. */
async function manifestOf(repository) {
  try {
    return await repositoryManifest(repository.full_name, repository.default_branch ?? 'main')
  } catch {
    return undefined
  }
}

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'))
  const org = flag('org', new URL(config.market.indexUrl).hostname.split('.')[0])
  const output = flag('write', undefined)
  const strict = process.argv.includes('--strict')

  const listed = (await readFile(join(ROOT, 'plugins.txt'), 'utf8'))
    .replace(/^\uFEFF/u, '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+#.*$/u, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

  info(`organization: ${org}, ${listed.length} plugin(s) listed`)

  const repositories = await organizationRepositories(org)
  info(`${repositories.length} public repository(ies)`)

  const findings = []
  const plugins = []
  for (const repository of repositories) {
    const manifest = await manifestOf(repository)
    if (manifest === undefined || typeof manifest !== 'object') continue
    if (manifest.dsh === undefined) continue
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue
    plugins.push({ name: manifest.name, version: manifest.version, repository: repository.name })
  }

  for (const plugin of plugins) {
    if (!listed.includes(plugin.name)) {
      findings.push({
        code: 'missing',
        name: plugin.name,
        message: `${plugin.name} is a DSH plugin in ${plugin.repository} but is not in plugins.txt`,
      })
      continue
    }
    const packument = await json(
      `https://registry.npmjs.org/${plugin.name.replace('/', '%2F')}`,
    ).catch(() => undefined)
    const published = packument?.['dist-tags']?.latest
    if (typeof published !== 'string') {
      findings.push({
        code: 'unpublished',
        name: plugin.name,
        message: `${plugin.name} is in plugins.txt but npm publishes no "latest" version`,
      })
      continue
    }
    if (
      semver.valid(plugin.version) &&
      semver.valid(published) &&
      semver.gt(plugin.version, published)
    ) {
      findings.push({
        code: 'unpublished',
        name: plugin.name,
        message: `${plugin.name}: repository is at ${plugin.version}, npm serves ${published} — merged but not released`,
      })
    }
  }

  for (const name of listed) {
    if (!plugins.some((plugin) => plugin.name === name)) {
      info(`${name}: no public repository declares this name (private repo or renamed)`)
    }
  }

  console.log('')
  for (const finding of findings) {
    warn(`${finding.code}: ${finding.message}`)
  }
  if (findings.length === 0)
    ok('the market and the organization agree: nothing merged-but-unreleased, nothing missing')

  if (output !== undefined) {
    await writeFile(
      output,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), findings }, null, 2)}\n`,
      'utf8',
    )
    info(`wrote ${output}`)
  }

  if (strict && findings.length > 0) process.exitCode = 1
}

main().catch(reportFatal)
