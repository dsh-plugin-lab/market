/**
 * GitHub Pages, as plain data.
 *
 * The query string is deliberate: Pages answers from a cache keyed on the full URL, so a fixed URL
 * can serve the previous generation for minutes after a deployment. A unique query reaches the
 * origin, which is the only thing worth comparing against a fresh build.
 */
import { request } from '../shared/http.mjs'

export async function deployedIndex(url) {
  const separator = url.includes('?') ? '&' : '?'
  const busted = `${url}${separator}probe=${Date.now()}-${Math.random().toString(36).slice(2)}`
  // No retries against a live URL: a cached answer is not going to change because we asked again,
  // and the verifier has its own wait loop for propagation.
  const response = await request(busted, { attempts: 1, timeoutMs: 15_000 })
  return response.json()
}

/** `status.json` sits next to `index.json`; the caller passes the index URL and this derives it. */
export async function deployedStatus(indexUrl) {
  const url = new URL(indexUrl)
  url.pathname = url.pathname.replace(/\/[^/]*$/u, '/status.json')
  url.search = ''
  return deployedIndex(url.toString())
}
