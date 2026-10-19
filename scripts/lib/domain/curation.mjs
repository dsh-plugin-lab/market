/**
 * Curation: the decisions `config.json` makes, applied to facts.
 *
 * Pure by construction — no network, no disk, no clock. Star counts arrive as already-resolved
 * numbers; anything that needs a request happens in the pipeline before this module is called. That
 * inversion is the point: the rules about *what a plugin is* stay testable without a network, and
 * adding a second sort-key source means adding a fetch, not editing this file.
 */

/**
 * Explicit curation wins; otherwise keywords chosen in `config.json` decide. Deterministic by order,
 * so the same package always lands in the same category.
 */
export function curate(name, config, settings, keywords) {
  const explicit = config.plugins?.[name] ?? {}
  const rules = settings.keywordRules ?? {}
  const lowered = keywords.map((word) => word.toLowerCase())

  let category = explicit.category
  if (category === undefined) {
    for (const [id, words] of Object.entries(rules.category ?? {})) {
      if (words.some((word) => lowered.includes(word.toLowerCase()))) {
        category = id
        break
      }
    }
  }

  let labels = explicit.labels
  if (labels === undefined) {
    labels = []
    for (const [id, words] of Object.entries(rules.labels ?? {})) {
      if (words.some((word) => lowered.includes(word.toLowerCase())) && !labels.includes(id)) {
        labels.push(id)
      }
    }
  }

  return { explicit, category, labels }
}

/**
 * Which repositories a plugin's sort keys will need a star count from.
 *
 * Separate from resolving the values so the pipeline can fetch them all before the pure pass runs.
 * `true` means "the plugin's own repository"; a string is an explicit `owner/repo`.
 */
export function starTargets(explicit, repository) {
  const targets = []
  for (const value of Object.values(explicit.sortKeys ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) continue
    const requested = value?.githubStars
    if (requested === true) {
      const match = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/?$/u.exec(repository?.url ?? '')
      if (match === null) continue
      targets.push([match[1], match[2]])
    } else if (typeof requested === 'string') {
      const [owner, repo] = requested.split('/')
      if (owner !== undefined && repo !== undefined) targets.push([owner, repo])
    }
  }
  return targets
}

/**
 * `sortKeys` values are numbers, or `{ "githubStars": true | "owner/repo" }` resolved earlier.
 * A count that could not be read leaves the key out rather than publishing a zero.
 */
export function sortKeysOf(explicit, { repository, starsFor, report }) {
  const values = {}
  for (const [id, value] of Object.entries(explicit.sortKeys ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      values[id] = value
      continue
    }
    const requested = value?.githubStars
    if (requested === true) {
      const match = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/?$/u.exec(repository?.url ?? '')
      if (match === null) {
        report('sortkey-unresolved', `sortKeys.${id}: no repository URL to read GitHub stars from`)
        continue
      }
      const count = starsFor(match[1], match[2])
      if (typeof count === 'number') values[id] = count
      continue
    }
    if (typeof requested === 'string') {
      const [owner, repo] = requested.split('/')
      const count = starsFor(owner, repo)
      if (typeof count === 'number') values[id] = count
      continue
    }
    report(
      'sortkey-unresolved',
      `sortKeys.${id}: ${JSON.stringify(value)} is neither a number nor a supported source`,
    )
  }
  return values
}

/** Declarations no plugin references are dropped, so the Discover page shows no empty filter. */
export function pruneMetadata(metadata, plugins, enabled, report, quiet = new Set()) {
  if (!enabled) return metadata
  const usedCategories = new Set(plugins.map((plugin) => plugin.metadata.category).filter(Boolean))
  const usedLabels = new Set(plugins.flatMap((plugin) => plugin.metadata.labels))
  const usedSortKeys = new Set(plugins.flatMap((plugin) => Object.keys(plugin.metadata.sortKeys)))
  const keep = (group, used, name) => {
    const kept = {}
    for (const [id, declaration] of Object.entries(group)) {
      if (used.has(id)) kept[id] = declaration
      else if (quiet.has(name)) continue
      else
        report('metadata-unused', `metadata.${name}: "${id}" is declared but unused — dropped`, {
          id,
        })
    }
    return kept
  }
  return {
    categories: keep(metadata.categories, usedCategories, 'categories'),
    labels: keep(metadata.labels, usedLabels, 'labels'),
    sortKeys: keep(metadata.sortKeys, usedSortKeys, 'sortKeys'),
  }
}
