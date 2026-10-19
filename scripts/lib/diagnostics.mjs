/**
 * Build diagnostics: every degraded outcome, with a stable code.
 *
 * A degradation is not an error. One plugin's broken packaging must not take the whole index down,
 * so the build keeps going and records what it lost. The record exists because a free-text warning
 * in a CI log is read by nobody: with codes, the build can be compared against a committed baseline
 * (`diagnostics-baseline.json`), and a new degradation becomes a reviewable diff instead of a
 * yellow line nobody scrolls to.
 *
 * This is deliberately **not** part of `index.json`. Format 1 defines no member for build quality,
 * the reader drops unknown members silently, and mixing the two meanings into one document would
 * put build metadata in the consumer's contract. See docs/ARCHITECTURE.md.
 */

/** Every code the build can emit, with what it means. Tests and the baseline refer to these. */
export const CODES = {
  'dsh-version-unavailable': 'The current DSH version could not be read; status.json omits it.',
  'stars-unavailable': 'A GitHub star count could not be read; the sort key is omitted.',
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
}

/**
 * Codes whose presence depends on the machine, not on the plugins.
 *
 * Without a GitHub token a local run hits the API rate limit; CI passes a token and does not. Letting
 * those ratchet would make the baseline flip on environment alone, so they are reported and never
 * compared.
 */
export const ENVIRONMENTAL = new Set(['stars-unavailable', 'dsh-version-unavailable'])

export class Diagnostics {
  #items = []

  /** Record one degradation. `context` carries the plugin (and version) it happened to. */
  add(code, message, context = {}) {
    if (CODES[code] === undefined) throw new Error(`unknown diagnostic code: ${code}`)
    this.#items.push({ code, message, ...context })
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

  /** What CI uploads and a human reads; small on purpose. */
  toJSON() {
    return {
      generatedAt: new Date().toISOString(),
      count: this.size,
      codes: this.codes,
      items: this.items,
    }
  }
}
