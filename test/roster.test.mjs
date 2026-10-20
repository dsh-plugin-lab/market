/**
 * What the two lists say about each other.
 *
 * The point of these cases is that the two directions are **not** symmetric: one is a plugin that
 * vanished, the other is a plugin nobody has presented yet. Treating them as one kind of finding is
 * how a benign "new plugin, not curated yet" ends up masking a real "something disappeared".
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareRoster } from '../scripts/lib/domain/roster.mjs'

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
