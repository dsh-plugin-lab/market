import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CODES,
  Diagnostics,
  ENVIRONMENTAL,
  ENVIRONMENTAL_CODES,
  SEVERITY,
} from '../scripts/lib/domain/diagnosis.mjs'

test('every documented code is unique and carries a description', () => {
  for (const [code, description] of Object.entries(CODES)) {
    assert.equal(typeof code, 'string')
    assert.equal(typeof description, 'string')
    assert.ok(description.length > 0, code)
  }
})

test('every code has a declared severity — an unclassified degradation is undefined behaviour', () => {
  for (const code of [...Object.keys(CODES), ...Object.keys(ENVIRONMENTAL_CODES)]) {
    assert.ok(SEVERITY[code] !== undefined, `${code} has no severity`)
    assert.ok(['degrade', 'environment'].includes(SEVERITY[code]), code)
  }
  // And the two tables agree with the declared set, so a code cannot be environmental in one place
  // and ratcheted in another.
  for (const code of ENVIRONMENTAL) assert.equal(SEVERITY[code], 'environment', code)
  for (const code of Object.keys(CODES)) assert.equal(SEVERITY[code], 'degrade', code)
})

test('the ratchet counts degradations and ignores the environment', () => {
  const diagnostics = new Diagnostics()
  diagnostics.add('locale-missing', 'no locale', { plugin: 'a' })
  diagnostics.add('stars-unavailable', 'rate limited')
  assert.deepEqual(diagnostics.codes, ['locale-missing', 'stars-unavailable'])
  assert.deepEqual(diagnostics.ratcheted, ['locale-missing'])
})

test('an unknown code is a programming error, not a silent warning', () => {
  const diagnostics = new Diagnostics()
  assert.throws(() => diagnostics.add('not-a-code', 'message'), /unknown diagnostic code/)
})

test('codes are deduplicated and sorted, items keep every occurrence', () => {
  const diagnostics = new Diagnostics()
  diagnostics.add('locale-missing', 'first', { plugin: 'a' })
  diagnostics.add('tarball-unreadable', 'second', { plugin: 'b' })
  diagnostics.add('locale-missing', 'third', { plugin: 'c' })
  assert.deepEqual(diagnostics.codes, ['locale-missing', 'tarball-unreadable'])
  assert.equal(diagnostics.size, 3)
  assert.deepEqual(
    diagnostics.items.map((item) => item.plugin),
    ['a', 'b', 'c'],
  )
})

test('toJSON carries the codes, their severity and the context', () => {
  const diagnostics = new Diagnostics()
  diagnostics.add('version-skipped', 'no timestamp', { plugin: 'p', version: '1.0.0' })
  const document = diagnostics.toJSON()
  assert.equal(document.count, 1)
  assert.deepEqual(document.codes, ['version-skipped'])
  assert.deepEqual(document.items[0], {
    code: 'version-skipped',
    severity: 'degrade',
    message: 'no timestamp',
    plugin: 'p',
    version: '1.0.0',
  })
  assert.match(document.generatedAt, /^\d{4}-\d{2}-\d{2}T/u)
})

test('a clean build has no codes', () => {
  const diagnostics = new Diagnostics()
  assert.deepEqual(diagnostics.codes, [])
  assert.equal(diagnostics.size, 0)
  assert.deepEqual(diagnostics.toJSON().items, [])
})
