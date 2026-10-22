/**
 * The reader's own rules, as pure functions: which version an entry installs by default, and whether a
 * version declares support for a given DSH.
 *
 * These live here rather than in `check-index.mjs` because they are the *meaning* of the document, not
 * a property of the check: `defaultVersion` is what a reader gets when they press install, and it is
 * worth asserting on its own. Everything here is pure — no network, no clock — so the compatibility
 * table can be tested without a registry.
 */
import semver from 'semver'

/** The version DSH picks as an entry's default: the highest non-prerelease one. */
export function defaultVersion(plugin) {
  const stable = plugin.versions.filter((version) => semver.prerelease(version.version) === null)
  return (stable[0] ?? plugin.versions[0])?.version
}

/**
 * Whether a version runs on a given DSH, using the reader's own rule: the plugin's `engines.dsh`
 * decides alone, and prereleases participate in the range (DSH itself ships prereleases).
 */
export function runsOn(version, dsh) {
  const range = version.engines?.dsh
  if (range === undefined) return true
  return semver.satisfies(dsh, range, { includePrerelease: true })
}

/** How many listed versions declare support for `dsh`, and how many there are. `-` when unknown. */
export function runsOnCount(plugin, dsh) {
  if (dsh === undefined) return '-'
  const supported = plugin.versions.filter((version) => runsOn(version, dsh)).length
  return `${supported}/${plugin.versions.length}`
}
