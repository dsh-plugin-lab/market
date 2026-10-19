/**
 * Build diagnostics: every degraded outcome, with a stable code **and a declared severity**.
 *
 * A degradation is not an error. One plugin's broken packaging must not take the whole index down,
 * so the build keeps going and records what it lost. The record exists because a free-text warning
 * in a CI log is read by nobody: with codes, the build can be compared against a committed baseline
 * (`diagnostics-baseline.json`), and a new degradation becomes a reviewable diff instead of a
 * yellow line nobody scrolls to.
 *
 * The severity lives here rather than at each call site. Before it did, whether the same class of
 * failure was tolerated or fatal depended on which file caught it, so nobody could answer "what is
 * strict?" without reading every script. Three levels:
 *
 *   - `degrade`     — the index is still produced and the code is **ratcheted**: it has to appear in
 *                     the baseline before CI goes green.
 *   - `environment` — depends on the machine, not on the plugins (no token, a rate limit). Reported,
 *                     never ratcheted; otherwise the local run is red and CI is green for the same
 *                     code, and people learn to ignore both.
 *   - `fatal`       — no honest degraded output exists (bad inputs, a package that is not published,
 *                     a document the reader would reject). Those **throw** and never reach this
 *                     table; they are listed in docs/ARCHITECTURE.md so that the answer to "what is
 *                     fatal?" also has one home.
 *
 * This is deliberately **not** part of `index.json`. Format 1 defines no member for build quality,
 * the reader drops unknown members silently, and mixing the two meanings into one document would
 * put build metadata in the consumer's contract.
 */

/** Recorded degradations: the index is still written, and the code is ratcheted. */
export const CODES = {
  'locale-missing': 'The published package has no locale/<language>.json.',
  'locale-invalid': 'A locale file is not valid JSON.',
  'text-missing-en': 'No English text was found, and the format requires "en".',
  'prerelease-only': 'No stable version is published; a prerelease is listed instead.',
  'latest-tag-prerelease': 'The "latest" dist-tag is a prerelease and is not listed.',
  'tarball-unreadable': 'The published tarball could not be read; registry text is used instead.',
  'version-skipped': 'A version was skipped (no timestamp, out-of-range time, or no gitHead).',
  'engine-invalid': 'engines.dsh is a workspace range or not a SemVer range.',
  'title-missing': 'No title in any language; the entry shows the package name.',
  'icon-declared-missing': 'package.json names an icon the tarball does not contain.',
  'icon-extension': 'The declared icon is not an SVG/PNG/JPEG/WebP file.',
  'repository-invalid': 'The repository field is not an http(s) URL and was omitted.',
  'sortkey-unresolved': 'A declared sort key could not be resolved to a number.',
  'metadata-unused': 'A declared category, label or sort key is referenced by no plugin.',
  'override-redundant': 'config.json overrides a field the registry already publishes identically.',
}

/**
 * Codes whose presence depends on the machine, not on the plugins.
 *
 * Without a GitHub token a local run hits the API rate limit; CI passes a token and does not. Letting
 * those ratchet would make the baseline flip on environment alone, so they are reported and never
 * compared.
 */
export const ENVIRONMENTAL = new Set(['stars-unavailable', 'dsh-version-unavailable'])

export const ENVIRONMENTAL_CODES = {
  'dsh-version-unavailable': 'The current DSH version could not be read; status.json omits it.',
  'stars-unavailable': 'A GitHub star count could not be read; the sort key is omitted.',
}

/**
 * The severity of every code. Derived from the two tables above so the sets cannot drift apart; a
 * code with no severity is a code nobody decided about, and `test/diagnostics.test.mjs` fails on one.
 */
export const SEVERITY = Object.fromEntries([
  ...Object.keys(CODES).map((code) => [code, 'degrade']),
  ...Object.keys(ENVIRONMENTAL_CODES).map((code) => [code, 'environment']),
])

export class Diagnostics {
  #items = []

  /** Record one degradation. `context` carries the plugin (and version) it happened to. */
  add(code, message, context = {}) {
    if (SEVERITY[code] === undefined) throw new Error(`unknown diagnostic code: ${code}`)
    this.#items.push({ code, severity: SEVERITY[code], message, ...context })
    console.log(`  [WARN] ${message}`)
    return this
  }

  get items() {
    return [...this.#items]
  }

  get size() {
    return this.#items.length
  }

  /** The distinct codes, sorted: this is what the baseline compares. */
  get codes() {
    return [...new Set(this.#items.map((item) => item.code))].sort()
  }

  /** The codes a baseline must account for; environmental ones are reported but not counted. */
  get ratcheted() {
    return this.codes.filter((code) => !ENVIRONMENTAL.has(code))
  }

  /** What CI uploads and a human reads; small on purpose. */
  toJSON() {
    return {
      generatedAt: new Date().toISOString(),
      count: this.size,
      codes: this.codes,
      ratcheted: this.ratcheted,
      items: this.items,
    }
  }
}

/**
 * Compare what this build degraded with what this repository has accepted.
 *
 * A ratchet turns one way only: a degradation either is in the accepted set or it is new, and new ones
 * fail the build. Written as a set comparison rather than a count on purpose — the same degradation
 * moving from one plugin to another is not a regression, an extra one is.
 *
 * Three groups come back, and the caller decides how loudly to report each (that decision is the
 * command layer's, not this function's):
 *
 *   - `added`   — emitted but not accepted: a new silent loss, to be explained or fixed;
 *   - `removed` — accepted but no longer emitted: the baseline carries an allowance nobody needs;
 *   - `ignored` — environment-dependent: reported, never compared.
 */
export function ratchet(codes, baseline) {
  const ignored = codes.filter((code) => ENVIRONMENTAL.has(code))
  const current = new Set(codes.filter((code) => !ENVIRONMENTAL.has(code)))
  const accepted = new Set(baseline.filter((code) => !ENVIRONMENTAL.has(code)))
  return {
    added: [...current].filter((code) => !accepted.has(code)).sort(),
    removed: [...accepted].filter((code) => !current.has(code)).sort(),
    ignored: [...ignored].sort(),
  }
}
