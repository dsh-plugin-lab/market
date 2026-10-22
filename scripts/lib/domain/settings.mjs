/**
 * `config.json`, resolved once into the shape the rest of the build reads.
 *
 * Two jobs, both about turning a hand-written document into values:
 *
 *   - every knob gets the default that makes a bare `config.json` work, so "unset" never means
 *     "undefined behaviour" somewhere deeper;
 *   - the organization is **derived** from the published index URL instead of being written down a
 *     second time. `market.indexUrl` already says where this market lives; a separate `organization`
 *     key could disagree with it.
 *
 * Pure: no I/O, no clock. The caller reads the file.
 */
import { DEFAULT_ZONES } from '../shared/time.mjs'

/** `https://dsh-plugin-lab.github.io/market/index.json` → `dsh-plugin-lab`. */
export function organizationOf(config) {
  return new URL(config.market.indexUrl).hostname.split('.')[0]
}

/**
 * The build knobs. Defaults are chosen so a minimal `config.json` still produces a valid market:
 * every published version is listed, prereleases included, and unused declarations are pruned so the
 * Discover page never shows an empty category button.
 */
export function normaliseSettings(config) {
  const market = config.market ?? {}
  if (typeof market.title?.en !== 'string')
    throw new Error('config.json: "market.title.en" is required')
  const build = config.build ?? {}
  return {
    indexUrl: market.indexUrl ?? 'https://dsh-plugin-lab.github.io/market/index.json',
    includePrerelease: build.includePrerelease ?? false,
    maxVersionsPerPlugin: build.maxVersionsPerPlugin ?? 1,
    keywordBlocklist: new Set((build.keywordBlocklist ?? []).map((word) => word.toLowerCase())),
    maxKeywords: build.maxKeywords ?? 12,
    pruneUnusedMetadata: build.pruneUnusedMetadata ?? true,
    localTimeZones: build.localTimeZones ?? DEFAULT_ZONES,
    keywordRules: config.keywordRules ?? {},
  }
}
