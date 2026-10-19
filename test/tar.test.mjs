import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readTar } from '../scripts/lib/tar.mjs'

/** A ustar header block. Checksums are not verified by the reader, so they are left zero. */
function header({ name, size = 0, flag = '0', prefix = '' }) {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8')
  block.write(flag, 156, 1, 'utf8')
  block.write('ustar\0', 257, 6, 'utf8')
  block.write(prefix, 345, 155, 'utf8')
  return block
}

function entry({ name, data = '', flag = '0', prefix = '' }) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  const padded = Buffer.alloc(Math.ceil(payload.length / 512) * 512)
  payload.copy(padded)
  return Buffer.concat([header({ name, size: payload.length, flag, prefix }), padded])
}

test('reads a plain entry', () => {
  const tar = Buffer.concat([entry({ name: 'package/package.json', data: '{"a":1}' })])
  const entries = readTar(tar)
  assert.deepEqual([...entries.keys()], ['package/package.json'])
  assert.equal(entries.get('package/package.json').toString('utf8'), '{"a":1}')
})

test('reads several entries and stops at the zero block', () => {
  const tar = Buffer.concat([
    entry({ name: 'package/a.txt', data: 'a' }),
    entry({ name: 'package/b.txt', data: 'b' }),
    Buffer.alloc(1024),
  ])
  const entries = readTar(tar)
  assert.deepEqual([...entries.keys()], ['package/a.txt', 'package/b.txt'])
})

test('a pax extended header supplies the path of the next entry', () => {
  const longPath = `package/${'x'.repeat(120)}.json`
  const record = `${longPath}\n`
  const paxBody = `${Buffer.byteLength(`000 path=${record}`)} path=${record}`
  const tar = Buffer.concat([
    entry({ name: 'PaxHeader', data: paxBody, flag: 'x' }),
    entry({ name: 'truncated-name', data: 'payload' }),
  ])
  const entries = readTar(tar)
  assert.deepEqual([...entries.keys()], [longPath])
  assert.equal(entries.get(longPath).toString('utf8'), 'payload')
})

test('a GNU long-name entry supplies the path of the next entry', () => {
  const longPath = `package/${'y'.repeat(120)}.json`
  const tar = Buffer.concat([
    entry({ name: '././@LongLink', data: `${longPath}\0`, flag: 'L' }),
    entry({ name: 'truncated', data: 'body' }),
  ])
  assert.deepEqual([...readTar(tar).keys()], [longPath])
})

test('the ustar prefix carries the leading directories', () => {
  const tar = Buffer.concat([
    entry({ name: 'en.json', prefix: 'package/locale', data: '{"meta":{}}' }),
  ])
  assert.deepEqual([...readTar(tar).keys()], ['package/locale/en.json'])
})

test('directory entries are skipped, not read as files', () => {
  const tar = Buffer.concat([
    entry({ name: 'package/locale/', flag: '5' }),
    entry({ name: 'package/locale/en.json', data: '{}' }),
  ])
  assert.deepEqual([...readTar(tar).keys()], ['package/locale/en.json'])
})

test('a truncated archive yields only what is complete', () => {
  const complete = entry({ name: 'package/a.txt', data: 'a'.repeat(600) })
  // Cut inside the payload, not inside the padding: the header still claims 600 bytes.
  const truncated = complete.subarray(0, 512 + 300)
  const entries = readTar(truncated)
  // A declared size that does not fit must not produce a short, silently wrong entry.
  assert.deepEqual([...entries.keys()], [])
})

test('a complete entry before a truncated one still reads', () => {
  const first = entry({ name: 'package/a.txt', data: 'fine' })
  const second = entry({ name: 'package/b.txt', data: 'b'.repeat(600) })
  const archive = Buffer.concat([first, second]).subarray(0, first.length + 512 + 100)
  const entries = readTar(archive)
  assert.deepEqual([...entries.keys()], ['package/a.txt'])
  assert.equal(entries.get('package/a.txt').toString('utf8'), 'fine')
})

test('an empty buffer reads as empty', () => {
  assert.deepEqual([...readTar(Buffer.alloc(0)).keys()], [])
})
