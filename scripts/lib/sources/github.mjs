/**
 * GitHub, as plain data.
 *
 * Same rule as the npm source: return values, never verdicts. A rate-limited star lookup is an
 * ordinary outcome here — the caller decides that it is environmental rather than a defect.
 */
import { githubHeaders, json } from '../shared/http.mjs'

const API = 'https://api.github.com'

/**
 * A star reader with a per-run cache. Two plugins in the same repository, or a retried lookup, must
 * not spend two requests: the anonymous limit is small and the build runs four plugins at a time.
 */
export function starReader() {
  const cache = new Map()
  return async function stars(owner, repo) {
    const key = `${owner}/${repo}`
    if (cache.has(key)) return cache.get(key)
    const count = (await json(`${API}/repos/${key}`, { headers: githubHeaders() })).stargazers_count
    cache.set(key, count)
    return count
  }
}

/** Every public repository in an organization, following pagination. */
export async function organizationRepositories(org) {
  const repositories = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await json(`${API}/orgs/${org}/repos?per_page=100&page=${page}&type=public`, {
      headers: githubHeaders(),
    })
    repositories.push(...batch)
    if (batch.length < 100) break
  }
  return repositories
}

/**
 * A repository's manifest, read from its default branch. Raw rather than the contents API: one
 * request instead of two, and the document is all we need.
 */
export async function repositoryManifest(fullName, branch = 'main') {
  const response = await fetch(
    `https://raw.githubusercontent.com/${fullName}/${branch}/package.json`,
    {
      headers: githubHeaders({ accept: 'application/vnd.github.raw' }),
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (!response.ok) throw new Error(`${fullName}: HTTP ${response.status}`)
  return response.json()
}
