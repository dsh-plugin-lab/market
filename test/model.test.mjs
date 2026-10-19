import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEntry } from '../scripts/lib/domain/assemble.mjs'
import { selectVersions } from '../scripts/lib/domain/derive.mjs'

/**
 * The domain is pure, so these tests are the algorithm's specification: no network, no disk, no clock.
 * Before the split, this half of the build lived inside a 245-line function that fetched, parsed,
 * curated and wrote files in one pass — so the rules below were only ever exercised against whatever
 * npm happened to be serving that day.
 */

const SETTINGS = {
  includePrerelease: true,
  maxVersionsPerPlugin: 3,
  keywordBlocklist: new Set(['dsh']),
  maxKeywords: 12,
  keywordRules: {},
}

/** A packument with `versions` published at one-day intervals, newest last. */
function packumentOf(versions, extra = {}) {
  const time = {}
  const records = {}
  versions.forEach((version, index) => {
    time[version] = new Date(Date.UTC(2026, 0, 1 + index)).toISOString()
    records[version] = {
      name: 'p',
      version,
      dist: { tarball: `https://registry.example/p/-/p-${version}.tgz` },
      engines: { dsh: '^0.2.0-rc.1' },
      ...extra,
    }
  })
  return {
    name: 'p',
    'dist-tags': { latest: versions.at(-1) },
    versions: records,
    time,
    repository: { type: 'git', url: 'git+https://github.com/o/p.git' },
    author: { name: 'someone' },
    ...extra,
  }
}

const collect = () => {
  const reported = []
  return { reported, report: (code, message) => reported.push({ code, message }) }
}

test('versions are listed newest first and capped by the policy', () => {
  const { reported, report } = collect()
  const selected = selectVersions(
    'p',
    packumentOf(['1.0.0', '1.1.0', '1.2.0', '1.3.0']),
    SETTINGS,
    report,
  )
  assert.deepEqual(selected, ['1.3.0', '1.2.0', '1.1.0'])
  assert.deepEqual(reported, [])
})

test('prereleases are excluded by a stable-only policy, and are not a defect', () => {
  const { reported, report } = collect()
  const selected = selectVersions(
    'p',
    packumentOf(['1.0.0', '1.1.0-rc.1']),
    { ...SETTINGS, includePrerelease: false },
    report,
  )
  assert.deepEqual(selected, ['1.0.0'])
  // `latest` is a prerelease the policy excluded: reported, never fatal.
  assert.deepEqual(
    reported.map((entry) => entry.code),
    ['latest-tag-prerelease'],
  )
})

test('a stable "latest" that the listed set dropped is fatal', () => {
  const { report } = collect()
  // The registry published 1.1.0 but its `latest` tag still points at 1.0.0. A cap of one then lists a
  // version that is not the one `npm install` would give you — a defect, not a policy.
  const packument = packumentOf(['1.0.0', '1.1.0'])
  packument['dist-tags'].latest = '1.0.0'
  assert.throws(
    () => selectVersions('p', packument, { ...SETTINGS, maxVersionsPerPlugin: 1 }, report),
    /not among the listed versions/u,
  )
})

test('a package with only prereleases falls back to one of them', () => {
  const { reported, report } = collect()
  const selected = selectVersions(
    'p',
    packumentOf(['1.0.0-rc.1']),
    { ...SETTINGS, includePrerelease: false },
    report,
  )
  assert.deepEqual(selected, ['1.0.0-rc.1'])
  assert.deepEqual(
    reported.map((entry) => entry.code),
    ['prerelease-only'],
  )
})

test('a version with no publish time is skipped, not silently listed at epoch zero', () => {
  const { reported, report } = collect()
  const packument = packumentOf(['1.0.0', '1.1.0'])
  delete packument.time['1.1.0']
  const entry = buildEntry({
    name: 'p',
    config: {},
    explicit: {},
    settings: SETTINGS,
    packument,
    tarball: { entries: new Map() },
    starsFor: () => undefined,
    report,
  })
  assert.deepEqual(
    entry.plugin.versions.map((version) => version.version),
    ['1.0.0'],
  )
  assert.equal(reported[0].code, 'version-skipped')
})

test('publishTimestamp is Unix seconds, not milliseconds', () => {
  const { report } = collect()
  const entry = buildEntry({
    name: 'p',
    config: {},
    explicit: {},
    settings: SETTINGS,
    packument: packumentOf(['1.0.0']),
    tarball: { entries: new Map() },
    starsFor: () => undefined,
    report,
  })
  const [record] = entry.plugin.versions
  assert.equal(record.publishTimestamp, Date.UTC(2026, 0, 1) / 1000)
  assert.ok(record.publishTimestamp < 1e11, 'seconds, not milliseconds')
})

test('an unreadable tarball degrades the entry instead of failing it', () => {
  const { reported, report } = collect()
  const entry = buildEntry({
    name: 'p',
    config: {},
    explicit: {},
    settings: SETTINGS,
    packument: packumentOf(['1.0.0']),
    tarball: { unreadable: 'timed out' },
    starsFor: () => undefined,
    report,
  })
  assert.equal(entry.plugin.name, 'p')
  assert.equal(entry.plugin.title, undefined, 'no locale text without the tarball')
  const codes = reported.map((item) => item.code)
  assert.ok(codes.includes('tarball-unreadable'))
  // One cause, not four consequences.
  assert.ok(!codes.includes('locale-missing'), 'the tarball failure is not also a missing locale')
})

test('an override that equals the published value is reported as dead weight', () => {
  const { reported, report } = collect()
  buildEntry({
    name: 'p',
    config: {},
    explicit: {
      repository: { url: 'https://github.com/o/p' },
      homepage: undefined,
    },
    settings: SETTINGS,
    packument: packumentOf(['1.0.0'], { homepage: undefined }),
    tarball: { entries: new Map() },
    starsFor: () => undefined,
    report,
  })
  assert.ok(reported.some((item) => item.code === 'override-redundant'))
})

test('an icon the package declares but does not ship is reported, not invented', () => {
  const { reported, report } = collect()
  const manifest = Buffer.from(JSON.stringify({ name: 'p', icon: './icon.svg' }))
  const entry = buildEntry({
    name: 'p',
    config: {},
    explicit: {},
    settings: SETTINGS,
    packument: packumentOf(['1.0.0']),
    tarball: { entries: new Map([['package/package.json', manifest]]) },
    starsFor: () => undefined,
    report,
  })
  assert.equal(entry.plugin.icon, undefined)
  assert.deepEqual(entry.assets, [])
  assert.ok(reported.some((item) => item.code === 'icon-declared-missing'))
})

test('an icon the package ships becomes an asset, and the entry points at its path', () => {
  const { report } = collect()
  const manifest = Buffer.from(JSON.stringify({ name: 'p', icon: './icon.svg' }))
  const svg = Buffer.from('<svg viewBox="0 0 36 36"/>')
  const entry = buildEntry({
    name: 'p',
    config: {},
    explicit: {},
    settings: SETTINGS,
    packument: packumentOf(['1.0.0']),
    tarball: {
      entries: new Map([
        ['package/package.json', manifest],
        ['package/icon.svg', svg],
      ]),
    },
    starsFor: () => undefined,
    report,
  })
  assert.equal(entry.plugin.icon, 'icons/p.svg')
  assert.deepEqual(
    entry.assets.map((asset) => asset.file),
    ['icons/p.svg'],
  )
  assert.equal(entry.assets[0].bytes.toString(), '<svg viewBox="0 0 36 36"/>')
})
