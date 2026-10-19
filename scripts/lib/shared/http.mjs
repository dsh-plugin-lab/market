/**
 * The single HTTP policy for this repository.
 *
 * Before this module each entry point carried its own: three attempts with backoff in the builder,
 * one attempt and a shorter timeout in the checks, and a different redirect policy in the deployed
 * verifier. None of those differences were chosen; each file simply grew its own `fetch`. Now the
 * policy is one default plus explicit overrides, so a difference has to be argued for at the call
 * site instead of appearing by accident.
 *
 * Sources (`lib/sources/`) use this; domain code never imports it.
 */
import process from 'node:process'

const DEFAULTS = {
  accept: 'application/json',
  headers: {},
  redirect: 'follow',
  attempts: 3,
  timeoutMs: 30_000,
  backoffMs: 500,
  userAgent: 'dsh-market-index-builder',
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * One request, retried `attempts` times on any failure. Returns the `Response`; a non-2xx answer is a
 * failure, because every caller here wants either a body or an explanation.
 */
export async function request(url, options = {}) {
  const settings = { ...DEFAULTS, ...options }
  let lastError
  for (let attempt = 1; attempt <= settings.attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: settings.accept,
          'user-agent': settings.userAgent,
          ...settings.headers,
        },
        redirect: settings.redirect,
        signal: AbortSignal.timeout(settings.timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < settings.attempts) await sleep(settings.backoffMs * attempt)
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? 'request failed'}`)
}

export async function json(url, options = {}) {
  return (await request(url, options)).json()
}

/** Raw bytes — for a tarball, and for anything where the response is not JSON. */
export async function buffer(url, options = {}) {
  return Buffer.from(await (await request(url, options)).arrayBuffer())
}

/** The GitHub API version header, and the optional token that lifts the anonymous rate limit. */
export function githubHeaders(extra = {}) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return { ...headers, ...extra }
}
