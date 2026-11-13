/**
 * What the two lists say about each other.
 *
 * The point of these cases is that the two directions are **not** symmetric: one is a plugin that
 * vanished, the other is a plugin nobody has presented yet. Treating them as one kind of finding is
 * how a benign "new plugin, not curated yet" ends up masking a real "something disappeared".
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareRoster, partitionByPublication } from '../scripts/lib/domain/roster.mjs'

test('a fully curated roster agrees with itself', () => {
  const names = ['dsh-a', 'dsh-b']
  assert.deepEqual(compareRoster({ curated: names, discovered: names }), {
    orphaned: [],
    uncurated: [],
  })
})

test('curated but not discovered is orphaned — this is the direction that hides', () => {
  // A partial discovery: two of four plugins were found. Without this comparison the build would
  // exit 0 and publish an index listing half the plugins.
  const { orphaned, uncurated } = compareRoster({
    curated: ['dsh-a', 'dsh-b', 'dsh-c', 'dsh-d'],
    discovered: ['dsh-a', 'dsh-b'],
  })
  assert.deepEqual(orphaned, ['dsh-c', 'dsh-d'])
  assert.deepEqual(uncurated, [])
})

test('discovered but not curated is benign and reported separately', () => {
  const { orphaned, uncurated } = compareRoster({
    curated: ['dsh-a'],
    discovered: ['dsh-a', 'dsh-new'],
  })
  assert.deepEqual(orphaned, [])
  assert.deepEqual(uncurated, ['dsh-new'])
})

test('both directions at once stay distinct', () => {
  const { orphaned, uncurated } = compareRoster({
    curated: ['dsh-gone'],
    discovered: ['dsh-new'],
  })
  assert.deepEqual(orphaned, ['dsh-gone'])
  assert.deepEqual(uncurated, ['dsh-new'])
})

test('the output is sorted, so two runs produce the same report', () => {
  const { orphaned, uncurated } = compareRoster({
    curated: ['dsh-z', 'dsh-m'],
    discovered: ['dsh-b', 'dsh-y'],
  })
  assert.deepEqual(orphaned, ['dsh-m', 'dsh-z'])
  assert.deepEqual(uncurated, ['dsh-b', 'dsh-y'])
})

test('an empty curation listing is not an error — everything is simply uncurated', () => {
  const { orphaned, uncurated } = compareRoster({ curated: [], discovered: ['dsh-a'] })
  assert.deepEqual(orphaned, [])
  assert.deepEqual(uncurated, ['dsh-a'])
})

/*
 * Publication, which is a third list and a third meaning.
 *
 * A repository is created before its first release — the `package.json` npm would publish is the thing
 * being written — so "discovered, but npm has never heard of it" is the ordinary state of a new
 * repository. It used to fail the whole build, which took every other plugin off the index because one
 * author had not cut a release yet. The cases below fix the replacement rule on both sides: skipping is
 * for the plugin nobody promised, and a curation that cannot be honoured is still a degradation.
 */

test('a plugin with no release yet is skipped, not built and not promised', () => {
  const { listed, absent, promisedButAbsent } = partitionByPublication({
    discovered: ['dsh-a', 'dsh-new'],
    curated: ['dsh-a'],
    unpublished: ['dsh-new'],
  })
  assert.deepEqual(listed, ['dsh-a'])
  assert.deepEqual(absent, ['dsh-new'])
  assert.deepEqual(promisedButAbsent, [], 'nobody curated it, so nothing was promised')
})

test('skipping unpublished plugins keeps discovery order in what remains', () => {
  const { listed } = partitionByPublication({
    discovered: ['dsh-a', 'dsh-b', 'dsh-c'],
    curated: [],
    unpublished: ['dsh-b'],
  })
  assert.deepEqual(listed, ['dsh-a', 'dsh-c'])
})

test('curating a plugin npm cannot serve is a promise the build cannot keep', () => {
  // The dangerous direction. `config.json` says "show this plugin"; the entry cannot be built. Left
  // silent, the index would look complete and be missing exactly what somebody asked to be listed.
  const { promisedButAbsent } = partitionByPublication({
    discovered: ['dsh-a', 'dsh-new'],
    curated: ['dsh-a', 'dsh-new'],
    unpublished: ['dsh-new'],
  })
  assert.deepEqual(promisedButAbsent, ['dsh-new'])
})

test('a name that is not in the roster at all is not a publication finding', () => {
  // `unpublished` comes from the facts fetch, which runs on discovered names only. A stray entry here
  // must not invent a plugin — the roster is the anchor, not this list.
  const { listed, absent } = partitionByPublication({
    discovered: ['dsh-a'],
    curated: [],
    unpublished: ['dsh-ghost'],
  })
  assert.deepEqual(listed, ['dsh-a'])
  assert.deepEqual(absent, [])
})

test('everything unpublished leaves nothing to list — the caller must refuse to deploy that', () => {
  const { listed } = partitionByPublication({
    discovered: ['dsh-a', 'dsh-b'],
    curated: [],
    unpublished: ['dsh-a', 'dsh-b'],
  })
  assert.deepEqual(listed, [])
})
