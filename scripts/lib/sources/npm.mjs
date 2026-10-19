/**
 * npm, as plain data.
 *
 * A source only turns the external world into ordinary values; it never decides what a failure means.
 * That decision belongs to the caller, because the same failure is a degradation during a build and a
 * fatal error during a check. Everything here throws on failure and returns data on success.
 */
import { gunzipSync } from 'node:zlib'
import { readTar, readTarSizes } from '../shared/tar.mjs'
import { buffer, json } from '../shared/http.mjs'

export const NPM = 'https://registry.npmjs.org'

/**
 * The full packument, not the abbreviated one: only this contains `time`, `repository`, `homepage`,
 * `author` and `keywords`, and those are exactly what the index publishes.
 */
export function packument(name) {
  return json(`${NPM}/${name.replace('/', '%2F')}`)
}

/** The newest published DSH, used by `status.json` and by the compatibility column in `check`. */
export function latestDsh() {
  return json(`${NPM}/@deepseek-ai%2Fdsh`, {
    accept: 'application/vnd.npm.install-v1+json',
  }).then((body) => body['dist-tags']?.latest)
}

/**
 * The published tarball, so locale text and the icon are exactly what a user installs.
 *
 * Three facts come back with the entries because they are all worth knowing and all invisible from a
 * file listing: the compressed size this build paid, the unpacked size a consumer installs, and the
 * single file that dominates it. A package shipping a four-megabyte image for its README is otherwise
 * only visible as "the build is slow".
 */
export async function tarballEntries(tarballUrl) {
  const compressed = await buffer(tarballUrl, { accept: 'application/octet-stream' })
  const archive = gunzipSync(compressed)
  return {
    entries: readTar(archive),
    sizes: readTarSizes(archive),
    bytes: compressed.length,
  }
}
