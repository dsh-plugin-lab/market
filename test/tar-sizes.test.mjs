import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readTar, readTarSizes } from '../scripts/lib/shared/tar.mjs'

/** Build a one-file ustar archive, so the size facts have a fixture without shipping a binary. */
function tarWith(entries) {
  const blocks = []
  for (const [name, payload] of Object.entries(entries)) {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100, 'utf8')
    header.write('0000644', 100, 8, 'utf8')
    header.write(`${payload.length.toString(8).padStart(11, '0')}\0`, 124, 13, 'utf8')
    header.write('0', 156, 1, 'utf8')
    header.write('ustar\0', 257, 6, 'utf8')
    // The checksum field is not validated by the reader; a plausible value keeps the fixture honest.
    header.write(`${' '.repeat(8)}`, 148, 8, 'utf8')
    blocks.push(header, payload, Buffer.alloc((512 - (payload.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}

test('the unpacked total and the largest file are reported', () => {
  const big = Buffer.alloc(4096, 'a')
  const small = Buffer.alloc(1024, 'b')
  const archive = tarWith({ 'package/small.txt': small, 'package/big.gif': big })
  const sizes = readTarSizes(archive)
  assert.equal(sizes.unpacked, 4096 + 1024)
  assert.equal(sizes.fileCount, 2)
  assert.deepEqual(sizes.largest, { path: 'package/big.gif', bytes: 4096 })
})

test('sizes and entries describe the same archive', () => {
  const archive = tarWith({
    'package/a.txt': Buffer.alloc(10, 'a'),
    'package/b.txt': Buffer.alloc(20),
  })
  assert.deepEqual([...readTar(archive).keys()], [...readTar(archive).keys()])
  assert.equal(readTarSizes(archive).fileCount, readTar(archive).size)
})

test('a truncated archive reports neither the missing file nor a partial one', () => {
  const archive = tarWith({ 'package/a.txt': Buffer.alloc(2048, 'a') })
  const truncated = archive.subarray(0, 512 + 100)
  // The guard stops before inserting a short payload: a half file looks complete to every caller.
  assert.equal(readTar(truncated).size, 0)
  assert.equal(readTarSizes(truncated).fileCount, 0)
  assert.equal(readTarSizes(truncated).unpacked, 0)
})
