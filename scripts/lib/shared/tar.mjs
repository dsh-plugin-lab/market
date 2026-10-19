/**
 * A minimal ustar reader: enough for a tarball produced by `npm publish`, with no dependency.
 *
 * This is the one component whose failure is silent by design — an unreadable tarball only costs the
 * display text and the icon, so the build continues. That is exactly why it has tests: a tar format
 * the reader does not understand would otherwise degrade every entry in the market and still pass
 * every other check.
 *
 * Two views over the same walk: `readTar` for the paths and bytes a caller needs, and
 * `readTarSizes` for how large the package is and what makes it large. The second exists because a
 * package's size is a fact about the plugin (and about how long every market build takes), and a
 * number nobody can explain is a number nobody acts on.
 */

function tarString(block, offset, length) {
  const slice = block.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8')
}

/** A pax extended header's `path=` record, which is how long paths are carried. */
function paxPath(bytes) {
  let path
  for (const line of bytes.toString('utf8').split('\n')) {
    const match = /^\d+ ([\w.]+)=(.*)$/u.exec(line)
    if (match?.[1] === 'path') path = match[2]
  }
  return path
}

/**
 * Walk the archive once, handing each regular file to `onFile(path, data, size)`.
 *
 * Handles the three ways a path is carried (plain `name`, ustar `prefix`, pax `x` and GNU `L`
 * extension) and skips directories and other non-regular entries.
 */
function walk(buffer, onFile) {
  let offset = 0
  let pendingName
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarString(header, 0, 100)
    const size = Number.parseInt(tarString(header, 124, 12).trim() || '0', 8)
    const flag = String.fromCharCode(header[156]) || '0'
    const prefix = tarString(header, 345, 155)
    const dataStart = offset + 512
    // A declared size that does not fit the buffer means a truncated archive. Stop before inserting:
    // a short payload would look like a complete file to every caller, and the loss would be silent.
    if (dataStart + size > buffer.length) break
    const data = buffer.subarray(dataStart, dataStart + size)

    if (flag === 'x') {
      pendingName = paxPath(data)
    } else if (flag === 'L') {
      pendingName = data.toString('utf8').replace(/\0+$/u, '')
    } else if (flag === '0' || flag === '\0' || flag === '7') {
      const path = pendingName ?? (prefix === '' ? name : `${prefix}/${name}`)
      onFile(path, data, size)
      pendingName = undefined
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
}

/** Read a tar buffer into a path → bytes map. */
export function readTar(buffer) {
  const entries = new Map()
  walk(buffer, (path, data) => entries.set(path, data))
  return entries
}

/**
 * How big the package is, and which file makes it big.
 *
 * `unpacked` is the sum of the file sizes the archive declares; `largest` is the single biggest file.
 * Both describe what a plugin publishes, which is why they are worth recording: one package shipping a
 * four-megabyte image for its README is invisible until someone measures it, and that measurement is
 * paid for by every consumer's install and by this repository's hourly build.
 */
export function readTarSizes(buffer) {
  let unpacked = 0
  let largest
  let fileCount = 0
  walk(buffer, (path, _data, size) => {
    unpacked += size
    fileCount += 1
    if (largest === undefined || size > largest.bytes) largest = { path, bytes: size }
  })
  return { unpacked, largest, fileCount }
}
