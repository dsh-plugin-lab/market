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
 *
 * The two GitHub endpoints live in `github.mjs`; this module is only the recognition rule.
 */
import { manifestOf, organizationRepositories } from './github.mjs'

/**
 * The plugin repositories of an organization, as `{ name, repository, branch }`, sorted by name.
 *
 * `name` is the **npm package name** from the manifest. `repository` is `owner/repo`, kept because a
 * listing that cannot be traced back to a repository is not reviewable.
 */
export async function discoverPlugins(org) {
  const repositories = await organizationRepositories(org)
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
