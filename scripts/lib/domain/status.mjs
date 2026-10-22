/**
 * The build's own record — `public/status.json`.
 *
 * Separate from the index because format 1 defines no member for it, and it carries two identities
 * that must not be confused:
 *
 *   - `content` describes what a reader actually gets. The verifier compares it byte for byte, and it
 *     is the only thing a deployment is judged by.
 *   - `build` describes the run and is for humans. It changes every time, so it can never be the
 *     thing a deployment is judged by — which is also why deployment deduplication compares this
 *     document with `build` removed.
 *
 * The clock is passed in, not read here: two runs of the same inputs must be able to produce the same
 * bytes, and a module that calls `new Date()` cannot promise that.
 *
 * Per-plugin facts stay per plugin. A single total ("64 versions") answers no question anyone has: a
 * reader wants to know which versions of which plugin, a maintainer wants to know what this run cost.
 */
import { zonedTimes } from '../shared/time.mjs'

/** `startedAt` / `finishedAt` are `Date`s; `content` is `{ hash, bytes, pluginCount }`. */
export function buildStatus({
  content,
  startedAt,
  finishedAt,
  entries,
  diagnostics,
  dsh,
  localTimeZones,
}) {
  return {
    schema: 1,
    content,
    build: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      // The same instant, rendered for the zones a maintainer actually reads. Derived, not a second
      // fact: `finishedAt` stays the standard form, and these live under `build` so that deployment
      // deduplication keeps ignoring them.
      localTimes: zonedTimes(finishedAt, localTimeZones),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ...(dsh === undefined ? {} : { dsh }),
      source: 'npm',
    },
    plugins: entries.map((entry) => pluginRecord(entry)),
    diagnostics: {
      count: diagnostics.size,
      codes: diagnostics.codes,
    },
  }
}

/** One entry of `status.plugins`: what this plugin cost and what that entry is made of. */
function pluginRecord(entry) {
  return {
    name: entry.plugin.name,
    newest: entry.newest,
    versions: entry.plugin.versions.map((version) => version.version),
    languages: entry.languages,
    title: entry.plugin.title?.en ?? undefined,
    icon: entry.plugin.icon !== undefined,
    // What the package costs: the bytes this build downloaded, what a consumer unpacks, and the one
    // file responsible for most of it. Recorded because a package's size is otherwise only felt as
    // "the build is slow", and because the cause belongs next to the number.
    package: {
      downloadedBytes: entry.fetchedBytes,
      unpackedBytes: entry.unpackedBytes,
      fileCount: entry.fileCount,
      ...(entry.largestFile === undefined
        ? {}
        : { largestFile: entry.largestFile.path, largestFileBytes: entry.largestFile.bytes }),
    },
    // Versions the registry marks deprecated. They are not offered, and the reason they are absent
    // belongs here rather than in a diagnostic: this is an intended, permanent exclusion, and a
    // warning that fires on every build is a warning nobody reads.
    ...(entry.excluded?.deprecated?.length > 0
      ? { excluded: { deprecated: entry.excluded.deprecated } }
      : {}),
  }
}
