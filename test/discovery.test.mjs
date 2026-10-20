/**
 * The roster is discovered, so what can be tested here is the rule for recognising a plugin and the
 * order it produces — not the network. `discoverPlugins` is exercised through a fake `fetch` that
 * answers the two endpoints it asks for: the organization listing and each repository's manifest.
 *
 * The properties worth pinning are the ones a hand-kept list used to get wrong:
 *
 *   - a repository that is named `dsh-` but declares no `dsh` field is **not** a plugin;
 *   - the listed name is the manifest's `name`, not the repository's name;
 *   - the order is alphabetical by package name, whatever order the API returned.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { discoverPlugins } from '../scripts/lib/sources/discovery.mjs'

/** Answer the organization listing and each manifest, and nothing else. */
function fakeFetch({ repositories, manifests }) {
  return async (url) => {
    const href = String(url)
    const organization = href.match(/\/orgs\/([^/]+)\/repos/u)
    if (organization) {
      return {
        ok: true,
        status: 200,
        json: async () => repositories,
      }
    }
    const manifest = href.match(
      /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/[^/]+\/package\.json/u,
    )
    if (manifest) {
      const body = manifests[manifest[1]]
      if (body === undefined) return { ok: false, status: 404 }
      return { ok: true, status: 200, text: async () => JSON.stringify(body) }
    }
    throw new Error(`unexpected request: ${href}`)
  }
}

function withFetch(implementation, run) {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  return run().finally(() => {
    globalThis.fetch = original
  })
}

const repository = (name, branch = 'main') => ({
  name,
  full_name: `dsh-plugin-lab/${name}`,
  default_branch: branch,
})

test('a dsh- name without a dsh field is not a plugin', async () => {
  const fetch = fakeFetch({
    repositories: [repository('dsh-plugins'), repository('dsh-real')],
    manifests: {
      // The workspace container: `dsh-` prefixed, no `dsh` field. This is the case that used to
      // require a hand-maintained exclusion.
      'dsh-plugin-lab/dsh-plugins': { name: 'dsh-plugins', version: '0.0.0' },
      'dsh-plugin-lab/dsh-real': { name: 'dsh-real', version: '1.0.0', dsh: {} },
    },
  })

  const found = await withFetch(fetch, () => discoverPlugins('dsh-plugin-lab'))
  assert.deepEqual(
    found.map((plugin) => plugin.name),
    ['dsh-real'],
  )
})

test('the listed name is the manifest name, not the repository name', async () => {
  const fetch = fakeFetch({
    repositories: [repository('dsh-repo-name')],
    manifests: {
      'dsh-plugin-lab/dsh-repo-name': { name: '@scope/other-name', version: '1.0.0', dsh: {} },
    },
  })

  const found = await withFetch(fetch, () => discoverPlugins('dsh-plugin-lab'))
  assert.deepEqual(
    found.map((plugin) => plugin.name),
    ['@scope/other-name'],
  )
  // The repository is still reported: a listing that cannot be traced back is not reviewable.
  assert.equal(found[0].repository, 'dsh-plugin-lab/dsh-repo-name')
})

test('the order is alphabetical by package name, not the order the API returned', async () => {
  const names = ['dsh-zulu', 'dsh-alpha', 'dsh-mike']
  const fetch = fakeFetch({
    repositories: names.map((name) => repository(name)),
    manifests: Object.fromEntries(
      names.map((name) => [`dsh-plugin-lab/${name}`, { name, version: '1.0.0', dsh: {} }]),
    ),
  })

  const found = await withFetch(fetch, () => discoverPlugins('dsh-plugin-lab'))
  assert.deepEqual(
    found.map((plugin) => plugin.name),
    ['dsh-alpha', 'dsh-mike', 'dsh-zulu'],
  )
})

test('a repository with no manifest is skipped, not treated as a failure', async () => {
  const fetch = fakeFetch({
    repositories: [repository('dsh-no-manifest'), repository('dsh-real')],
    manifests: { 'dsh-plugin-lab/dsh-real': { name: 'dsh-real', version: '1.0.0', dsh: {} } },
  })

  const found = await withFetch(fetch, () => discoverPlugins('dsh-plugin-lab'))
  assert.deepEqual(
    found.map((plugin) => plugin.name),
    ['dsh-real'],
  )
})
