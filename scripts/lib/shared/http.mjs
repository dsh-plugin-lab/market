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
 * Whether another attempt could plausibly answer differently.
 *
 * A 500 or a timeout might; a 404 will not — the server has already told us the thing is not there,
 * and asking twice more only spends two requests to hear it again. That distinction matters beyond
 * politeness: the caller needs to tell "npm never published this name" (an answer it can act on) from
 * "the network broke" (which it must not swallow).
 */
const retryable = (status) => status === undefined || status === 429 || status >= 500

/**
 * One request, retried `attempts` times on a *retryable* failure. Returns the `Response`; a non-2xx
 * answer is a failure, because every caller here wants either a body or an explanation.
 *
 * An error that carries `status` means the server answered. Callers branch on it — `sources/npm.mjs`
 * treats 404 as "not published" rather than as a transport failure — so it is part of the contract,
 * not an implementation detail.
 */
export async function request(url, options = {}) {
  const settings = { ...DEFAULTS, ...options }
  let lastError
  for (let attempt = 1; attempt <= settings.attempts; attempt += 1) {
    let response
    try {
      response = await fetch(url, {
        headers: {
          accept: settings.accept,
          'user-agent': settings.userAgent,
          ...settings.headers,
        },
        redirect: settings.redirect,
        signal: AbortSignal.timeout(settings.timeoutMs),
      })
    } catch (error) {
      lastError = error
      if (attempt < settings.attempts) await sleep(settings.backoffMs * attempt)
      continue
    }
    if (response.ok) return response
    const answered = Object.assign(
      new Error(`${url}: HTTP ${response.status} ${response.statusText}`),
      { status: response.status },
    )
    if (!retryable(response.status)) throw answered
    lastError = answered
    if (attempt < settings.attempts) await sleep(settings.backoffMs * attempt)
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
