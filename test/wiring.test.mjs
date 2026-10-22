import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateDeclarations } from '../scripts/lib/domain/curation.mjs'
import { normaliseSettings, organizationOf } from '../scripts/lib/domain/settings.mjs'
import { validateRoster } from '../scripts/lib/domain/roster.mjs'
import { mapLimit } from '../scripts/lib/shared/concurrency.mjs'
import { renderTable } from '../scripts/lib/shared/table.mjs'

/**
 * The wiring that used to live inside `build-index.mjs`, where it could only be exercised by running a
 * whole build against whatever npm was serving. None of it needs a network, so none of it belongs
 * there.
 */

const repository = (name, declared = name) => ({
  name: declared,
  repository: `dsh-plugin-lab/${name}`,
})

test('config.json resolves to settings with defaults for everything it omits', () => {
  const settings = normaliseSettings({ market: { title: { en: 'M' } } })
  assert.equal(settings.includePrerelease, false)
  assert.equal(settings.maxVersionsPerPlugin, 1)
  assert.equal(settings.pruneUnusedMetadata, true)
  assert.deepEqual(settings.localTimeZones.length, 3, 'the default zones apply when unset')
  assert.equal(settings.indexUrl, 'https://dsh-plugin-lab.github.io/market/index.json')
})

test('a title is required, because the format requires one', () => {
  assert.throws(() => normaliseSettings({ market: {} }), /market\.title\.en/u)
})

test('the organization is derived from the index URL, not written twice', () => {
  assert.equal(
    organizationOf({ market: { indexUrl: 'https://dsh-plugin-lab.github.io/market/index.json' } }),
    'dsh-plugin-lab',
  )
})

test('a roster with no plugin is a broken discovery, not an empty market', () => {
  assert.throws(() => validateRoster([]), /discovery is broken/u)
})

test('a declared name that is not an npm package name fails, naming its repository', () => {
  assert.throws(
    () => validateRoster([repository('dsh-bad', 'Not A Package')]),
    /dsh-plugin-lab\/dsh-bad declares "Not A Package"/u,
  )
})

test('two repositories declaring one package name fail', () => {
  assert.throws(
    () => validateRoster([repository('dsh-a', 'same'), repository('dsh-b', 'same')]),
    /same is declared by more than one repository/u,
  )
})

test('a valid roster keeps discovery order', () => {
  assert.deepEqual(validateRoster([repository('dsh-b'), repository('dsh-a')]), ['dsh-b', 'dsh-a'])
})

test('a declaration no plugin references is a dead filter and fails the build', () => {
  const metadata = { categories: { tools: {} }, labels: { local: {} }, sortKeys: { stars: {} } }
  assert.throws(
    () =>
      validateDeclarations(metadata, [
        { name: 'p', metadata: { category: 'ui', labels: [], sortKeys: {} } },
      ]),
    /category "ui" is not declared/u,
  )
  assert.throws(
    () =>
      validateDeclarations(metadata, [
        { name: 'p', metadata: { category: 'tools', labels: ['online'], sortKeys: {} } },
      ]),
    /label "online" is not declared/u,
  )
  assert.throws(
    () =>
      validateDeclarations(metadata, [
        { name: 'p', metadata: { category: 'tools', labels: [], sortKeys: { downloads: 1 } } },
      ]),
    /sort key "downloads" is not declared/u,
  )
})

test('mapLimit keeps result order aligned with input order', async () => {
  const items = [30, 10, 20]
  const results = await mapLimit(items, 3, async (ms, index) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return index
  })
  assert.deepEqual(results, [0, 1, 2])
})

test('mapLimit runs no more than its limit at a time', async () => {
  let running = 0
  let peak = 0
  await mapLimit([...Array(8).keys()], 3, async () => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running -= 1
  })
  assert.equal(peak, 3)
})

test('a table is as wide as its widest cell, and can right-align a column', () => {
  const lines = renderTable(
    ['name', 'n'],
    [
      { name: 'a', n: '1' },
      { name: 'longer', n: '22' },
    ],
    {
      align: { n: 'right' },
    },
  )
  assert.equal(lines[0], '  name     n', 'the header is aligned like its column')
  assert.equal(lines[1], '  ------  --')
  assert.equal(lines[2], '  a        1')
  assert.equal(lines[3], '  longer  22')
})
