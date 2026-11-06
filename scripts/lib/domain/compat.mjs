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
 * Whether a version declares support for a given DSH, by the declared half of the reader's rule: the
 * plugin's `engines.dsh`, with prereleases participating in the range.
 *
 * An absent declaration returns `true` and means **nothing is declared here** — the reader then falls
 * back to `peerDependencies`, which an index does not carry. Callers that report coverage must not
 * count that case as support; {@link runsOnCount} keeps it apart.
 */
export function runsOn(version, dsh) {
  const range = version.engines?.dsh
  if (range === undefined) return true
  return semver.satisfies(dsh, range, { includePrerelease: true })
}

/** Whether a version declares `engines.dsh` at all — the difference between "runs" and "unjudged". */
export function declaresEngines(version) {
  return version.engines?.dsh !== undefined
}

/**
 * How many listed versions declare support for `dsh`, out of how many. `-` when there is no DSH version
 * to compare against; versions with no declaration are reported separately, never as support.
 */
export function runsOnCount(plugin, dsh) {
  if (dsh === undefined) return '-'
  const declared = plugin.versions.filter(declaresEngines)
  const supported = declared.filter((version) => runsOn(version, dsh)).length
  const undeclared = plugin.versions.length - declared.length
  const coverage = `${supported}/${plugin.versions.length}`
  return undeclared === 0 ? coverage : `${coverage} +${undeclared} undeclared`
}
