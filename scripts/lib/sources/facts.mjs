/**
 * Everything one plugin needs from the outside world, fetched before any decision is made.
 *
 * This is the only place that composes the three sources — registry, tarball, GitHub — for one
 * plugin, and it does so **before** the pure half of the build runs. That inversion is what keeps
 * `domain/` free of requests: by the time curation asks "how many stars", the number is already in a
 * map, or the answer "could not read it" already is.
 *
 * `targetsFor` is a callback rather than an argument because the answer depends on the packument
 * (a repository may be published by npm, not configured), and because *which* repositories to read
 * stars from is a curation rule that must not be imported here — the dependency arrow points one way
 * only: entry point → sources → shared.
 *
 * Two facts are allowed to be absent rather than fatal, because both have an honest degraded form: an
 * unreadable tarball still leaves the registry's text, and an unreadable star count still leaves the
 * plugin listed without that sort key.
 */
import semver from 'semver'
import { packument as readPackument, tarballEntries } from './npm.mjs'

/**
 * `{ published, tarball, counts }`.
 *
 * `tarball` is `{ entries, sizes, bytes }` or `{ unreadable }`; `counts` maps `owner/repo` to a number
 * or to `undefined` when the lookup failed.
 */
export async function factsFor({ name, explicit, stars, targetsFor = () => [], report }) {
  const published = await readPackument(name)

  // Which tarball to read is `dist-tags.latest` — the version `npm install` would give you today —
  // because locale text and the icon describe what a reader is about to install. Falling back to the
  // semver-newest version matters: sorting the version strings puts `2.9.3` above `2.10.0`, so the
  // naive `sort().at(-1)` silently reads the wrong release.
  const tagged = published['dist-tags']?.latest
  const newest =
    typeof tagged === 'string' && published.versions?.[tagged] !== undefined
      ? tagged
      : semver.rsort(Object.keys(published.versions ?? {}))[0]
  const tarballUrl = published.versions?.[newest]?.dist?.tarball
  if (typeof tarballUrl !== 'string')
    throw new Error(`${name}: the registry publishes no version with a tarball`)

  let tarball
  try {
    const fetched = await tarballEntries(tarballUrl)
    tarball = { entries: fetched.entries, sizes: fetched.sizes, bytes: fetched.bytes }
  } catch (error) {
    // "We could not fetch it" is not "the package does not have it": this is a network event, and the
    // model is told so explicitly instead of inferring it from a missing value.
    tarball = { unreadable: error.message }
    report('tarball-unreadable', `${name}: the tarball is unreadable (${error.message})`, {
      plugin: name,
    })
  }

  const counts = new Map()
  for (const [owner, repo] of targetsFor(published)) {
    try {
      counts.set(`${owner}/${repo}`, await stars(owner, repo))
    } catch (error) {
      counts.set(`${owner}/${repo}`, undefined)
      report('stars-unavailable', `github stars for ${owner}/${repo}: ${error.message}`)
    }
  }

  return { published, tarball, counts }
}
