import assert from 'node:assert/strict'
import { test } from 'node:test'
import { declaresEngines, runsOn, runsOnCount } from '../scripts/lib/domain/compat.mjs'

/**
 * The compatibility table is what tells a maintainer whether an entry still installs. It must not read
 * "no declaration" as "declared support": the reader then falls back to `peerDependencies`, which an
 * index does not carry, so that case is unjudged rather than supported.
 */

const declared = (range) => ({ version: '1.0.0', engines: { dsh: range } })
const undeclared = { version: '1.0.1' }

test('an absent declaration is not counted as support', () => {
  const plugin = { versions: [declared('^0.2.1-rc.1'), undeclared] }
  assert.equal(runsOnCount(plugin, '0.2.2-rc.1'), '1/2 +1 undeclared')
})

test('a fully declared plugin keeps the plain ratio', () => {
  const plugin = { versions: [declared('^0.2.1-rc.1'), declared('^0.2.1-rc.1')] }
  assert.equal(runsOnCount(plugin, '0.2.2-rc.1'), '2/2')
})

test('declaresEngines separates the two', () => {
  assert.equal(declaresEngines(declared('^0.2.1-rc.1')), true)
  assert.equal(declaresEngines(undeclared), false)
})

test('a declared range outside the floor is not support', () => {
  const plugin = { versions: [declared('^0.1.7-rc.1')] }
  assert.equal(runsOn(declared('^0.1.7-rc.1'), '0.2.2-rc.1'), false)
  assert.equal(runsOnCount(plugin, '0.2.2-rc.1'), '0/1')
})

test('no DSH version to compare against reports unknown, not zero', () => {
  assert.equal(runsOnCount({ versions: [undeclared] }, undefined), '-')
})
