/**
 * GitHub, as plain data.
 *
 * Same rule as the npm source: return values, never verdicts. A rate-limited star lookup is an
 * ordinary outcome here — the caller decides that it is environmental rather than a defect.
 */
import { githubHeaders, json, request } from '../shared/http.mjs'

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

/**
 * Every public repository in an organization, following pagination.
 *
 * The two failures worth distinguishing are named, because both otherwise read as a bare status code
 * and send people looking for the wrong problem: an exhausted anonymous quota is fixed by supplying a
 * token, a rejected token by replacing it.
 */
export async function organizationRepositories(org) {
  const repositories = []
  // Ten pages is a ceiling rather than a real limit: these organizations have single-digit
  // repositories. A short page ends the walk.
  for (let page = 1; page <= 10; page += 1) {
    const batch = await json(`${API}/orgs/${org}/repos?per_page=100&page=${page}&type=public`, {
      headers: githubHeaders(),
    }).catch((error) => {
      if (/rate limit|403/iu.test(error.message)) {
        throw new Error(
          `${error.message} — listing ${org} hit the anonymous quota (60 requests/hour); set GITHUB_TOKEN`,
        )
      }
      if (/401|Unauthorized/iu.test(error.message)) {
        throw new Error(
          `${error.message} — GITHUB_TOKEN was rejected: expired, revoked, or without access to ${org}`,
        )
      }
      throw error
    })
    repositories.push(...batch)
    if (batch.length < 100) break
  }
  return repositories
}

/**
 * A repository's manifest from its default branch, or `undefined` when it has none.
 *
 * Raw rather than the contents API: one request instead of two, and the document is all we need. Goes
 * through the shared `request()` helper so a transient failure is retried like every other fetch — one
 * unretried call in a build of retried ones is a difference nobody notices until a proxy hiccups.
 *
 * **A 404 is not a failure.** A repository without a manifest is not a plugin, which is an ordinary
 * outcome; a timeout is a network event, and conflating the two would report "that repository does not
 * exist" for a slow request.
 */
export async function manifestOf(fullName, branch = 'main') {
  try {
    const response = await request(
      `https://raw.githubusercontent.com/${fullName}/${branch}/package.json`,
      { accept: 'application/vnd.github.raw', headers: githubHeaders() },
    )
    return JSON.parse(await response.text())
  } catch (error) {
    if (/HTTP 404/u.test(error.message)) return undefined
    throw error
  }
}
