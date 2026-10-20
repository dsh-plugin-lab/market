/**
 * Which plugins the market should list, read from the organization rather than from a list.
 *
 * The market used to take its roster from `plugins.txt`: one npm package name per line, kept by
 * hand. That is a second source of truth. It has to be updated when a plugin repository is created,
 * it can name a package that no longer exists, and it can miss a repository that nobody remembered
 * to add — and none of those three show up as an error until a human looks.
 *
 * The organization already declares the answer. A plugin repository **says it is one**: its name
 * starts with `dsh-` and its manifest carries the `dsh` field. Everything else in the organization —
 * this repository, the organization repository, a workspace that merely happens to be called
 * `dsh-plugins` — declares nothing of the kind and drops out on its own.
 *
 * Two consequences worth stating:
 *
 *   - **The package name comes from the manifest, not from the repository name.** They agree today.
 *     A repository that renames its package without renaming itself would otherwise be listed under
 *     a name npm has never heard of, and the failure would look like "npm is missing a version".
 *   - **The order is alphabetical**, by package name. A hand-written list had no order rule either;
 *     it had the order its author typed, which nobody could reconstruct later. Alphabetical is
 *     reproducible, and it is what a reader of the Discover page sees.
 */
import { githubHeaders, json } from '../shared/http.mjs'

const API = 'https://api.github.com'

/** A repository's manifest, or `undefined` when it has none — a repository without one is not a plugin. */
async function manifestOf(fullName, branch) {
  const response = await fetch(
    `https://raw.githubusercontent.com/${fullName}/${branch}/package.json`,
    {
      headers: githubHeaders({ accept: 'application/vnd.github.raw' }),
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`reading ${fullName}/package.json: HTTP ${response.status}`)
  return JSON.parse(await response.text())
}

/** Every public repository in an organization, following pagination. */
async function repositoriesOf(org) {
  const repositories = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await json(`${API}/orgs/${org}/repos?per_page=100&page=${page}&type=public`, {
      headers: githubHeaders(),
    }).catch((error) => {
      // The roster is no longer an optional input — without it there is no index — so an exhausted
      // anonymous quota has to read as what it is. "HTTP 403" alone sends people looking for a
      // permissions problem.
      if (/403|rate limit/iu.test(error.message)) {
        throw new Error(
          `${error.message} — listing ${org} needs GITHUB_TOKEN set (anonymous is 60 requests/hour)`,
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
 * The plugin repositories of an organization, as `{ name, repository, branch }`, sorted by name.
 *
 * `name` is the **npm package name** from the manifest. `repository` is `owner/repo`, kept because a
 * listing that cannot be traced back to a repository is not reviewable.
 */
export async function discoverPlugins(org) {
  const repositories = await repositoriesOf(org)
  const found = []

  for (const repository of repositories) {
    if (!repository.name.startsWith('dsh-')) continue
    const branch = repository.default_branch ?? 'main'
    const manifest = await manifestOf(repository.full_name, branch)
    // The declaration, not the name: a `dsh-` named repository with no `dsh` field is a workspace,
    // a tool, or something else wearing a plugin's name.
    if (!manifest?.dsh || typeof manifest.name !== 'string') continue
    found.push({ name: manifest.name, repository: repository.full_name, branch })
  }

  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return found
}
