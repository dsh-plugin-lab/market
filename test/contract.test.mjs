import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALLOWED, findUndefinedMembers } from '../scripts/lib/domain/contract.mjs'
import { digestOf } from '../scripts/lib/shared/digest.mjs'

/**
 * The contract table is the one thing the generator and the validator share, so it is worth pinning:
 * if a member lands in the wrong list, the build starts writing something DSH drops silently.
 */

const collect = () => {
  const found = []
  return { found, report: (message) => found.push(message) }
}

test('a well-formed index reports nothing', () => {
  const { found, report } = collect()
  findUndefinedMembers(
    {
      format: 1,
      title: { en: 'Market' },
      metadata: {
        categories: { tools: { title: { en: 'Tools' } } },
        labels: { local: { title: { en: 'Local' } } },
        sortKeys: { stars: { title: { en: 'Stars' }, order: 'desc' } },
      },
      plugins: [
        {
          name: 'p',
          title: { en: 'P' },
          metadata: {
            category: 'tools',
            keywords: ['p'],
            labels: ['local'],
            sortKeys: { stars: 3 },
          },
          versions: [
            {
              version: '1.0.0',
              publishTimestamp: 1_700_000_000,
              source: { type: 'npm' },
              engines: { dsh: '^0.2.0-rc.1' },
            },
          ],
        },
      ],
    },
    report,
  )
  assert.deepEqual(found, [])
})

test('a member the format does not define is reported with its path', () => {
  const { found, report } = collect()
  findUndefinedMembers(
    {
      format: 1,
      title: { en: 'M' },
      metadata: {},
      plugins: [{ name: 'p', metadata: { keywords: [], labels: [], sortKeys: {} }, versions: [] }],
      distTags: { latest: '1.0.0' },
    },
    report,
  )
  assert.equal(found.length, 1)
  assert.match(found[0], /^\$\.distTags:/u)
})

test('an undefined member nested in a version is caught, not just at the top', () => {
  const { found, report } = collect()
  findUndefinedMembers(
    {
      format: 1,
      title: { en: 'M' },
      metadata: {},
      plugins: [
        {
          name: 'p',
          metadata: { keywords: [], labels: [], sortKeys: {} },
          versions: [
            {
              version: '1.0.0',
              publishTimestamp: 1,
              source: { type: 'npm', integrity: 'sha512-…' },
              engines: {},
            },
          ],
        },
      ],
    },
    report,
  )
  assert.ok(found.some((message) => message.includes('$.plugins[0].versions[0].source.integrity')))
})

test('the two source shapes are told apart: a git source may carry commit and path', () => {
  const { found, report } = collect()
  findUndefinedMembers(
    {
      format: 1,
      title: { en: 'M' },
      metadata: {},
      plugins: [
        {
          name: 'p',
          metadata: { keywords: [], labels: [], sortKeys: {} },
          versions: [
            {
              version: '1.0.0',
              publishTimestamp: 1,
              source: { type: 'git', url: 'https://example.com/r.git', commit: 'a'.repeat(40) },
              engines: {},
            },
          ],
        },
      ],
    },
    report,
  )
  assert.deepEqual(found, [])
})

test('every kind in the table is a list of member names', () => {
  for (const [kind, members] of Object.entries(ALLOWED)) {
    assert.ok(Array.isArray(members), kind)
    for (const member of members) assert.equal(typeof member, 'string', kind)
  }
})

test('the digest is over the exact bytes, so a trailing newline matters', () => {
  // A known vector: this is the same value the build publishes and the verifier recomputes, and the
  // two-byte difference below is exactly the class of bug it exists to catch.
  assert.equal(
    digestOf('abc'),
    'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.notEqual(digestOf('abc'), digestOf('abc\n'))
  assert.equal(digestOf(Buffer.from('abc')), digestOf('abc'))
})
