import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CODES, Diagnostics } from '../scripts/lib/diagnostics.mjs'

test('every documented code is unique and carries a description', () => {
  for (const [code, description] of Object.entries(CODES)) {
    assert.equal(typeof code, 'string')
    assert.equal(typeof description, 'string')
    assert.ok(description.length > 0, code)
  }
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

test('toJSON carries the codes and the context', () => {
  const diagnostics = new Diagnostics()
  diagnostics.add('version-skipped', 'no timestamp', { plugin: 'p', version: '1.0.0' })
  const document = diagnostics.toJSON()
  assert.equal(document.count, 1)
  assert.deepEqual(document.codes, ['version-skipped'])
  assert.deepEqual(document.items[0], {
    code: 'version-skipped',
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
