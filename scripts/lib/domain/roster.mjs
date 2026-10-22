/**
 * The two ways curation and discovery can disagree, as a pure decision — plus the roster's own
 * grammar check.
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

/** The npm package-name grammar, applied to the name a repository declares. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

/**
 * The discovered repositories, reduced to the package names to list — or a thrown error.
 *
 * Validation happens here rather than at the first npm lookup, because the failure has to name its
 * cause. A malformed name would otherwise be fetched, fail, and be reported as "no published
 * version", which sends the reader to npm for a problem that lives in a `package.json`.
 */
export function validateRoster(discovered) {
  if (discovered.length === 0)
    throw new Error(
      'no plugin repository found — discovery is broken, not the plugins (no dsh-* repository declares a dsh field)',
    )
  for (const plugin of discovered) {
    if (!PACKAGE_NAME.test(plugin.name))
      throw new Error(
        `${plugin.repository} declares ${JSON.stringify(plugin.name)}, which is not an npm package name`,
      )
  }
  const names = discovered.map((plugin) => plugin.name)
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate !== undefined)
    throw new Error(
      `${duplicate} is declared by more than one repository — the roster must name each package once`,
    )
  return names
}

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
