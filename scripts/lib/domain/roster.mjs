/**
 * The two ways curation and discovery can disagree, as a pure decision.
 *
 * The roster is discovered from the organization; `config.json` only says how each plugin is shown.
 * That splits the old single list into two lists that can drift, in two directions that mean very
 * different things:
 *
 *   - **curated, not discovered** — something that used to be here is gone. Either a repository was
 *     removed or renamed, or discovery failed to see it. Both are worth a red flag; the second is
 *     the dangerous one, because a partial listing still produces a perfectly well-formed index that
 *     quietly delists whatever it missed.
 *   - **discovered, not curated** — a plugin nobody has decided how to present yet. Benign: the entry
 *     still lists, with its category and labels falling back to `keywordRules`.
 *
 * Keeping the comparison here rather than in the entry point is what lets it be tested without a
 * network, and it keeps the wording (which is the entry point's business) away from the decision.
 */

/**
 * Names in `curated` that `discovered` does not contain, and the reverse. Both sorted, so a diff of
 * two runs is stable.
 */
export function compareRoster({ curated, discovered }) {
  const discoveredSet = new Set(discovered)
  const curatedSet = new Set(curated)
  return {
    orphaned: curated.filter((name) => !discoveredSet.has(name)).sort(),
    uncurated: discovered.filter((name) => !curatedSet.has(name)).sort(),
  }
}
