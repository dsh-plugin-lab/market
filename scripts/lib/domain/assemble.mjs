/**
 * Assemble: facts + decisions → one format-1 plugin entry.
 *
 * The last pure step before anything is written. It knows the document's shape and nothing about the
 * registry, the network, or where files go: every value it needs was derived earlier and decided
 * earlier. Keeping it this narrow is what makes the format contract testable without a build.
 */
import { curate, sortKeysOf } from './curation.mjs'
import { deriveFacts } from './derive.mjs'

/** A facts object plus the curation outcomes → one entry in `plugins[]`. */
export function assembleEntry(facts, { category, labels, sortKeys }) {
  const { title, description, icon, author, homepage, repository, versions } = facts
  return {
    name: facts.name,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(icon === undefined ? {} : { icon }),
    ...(author === undefined ? {} : { author }),
    ...(typeof homepage === 'string' && homepage.trim() !== '' && URL.canParse(homepage)
      ? { homepage: homepage.trim() }
      : {}),
    ...(repository === undefined ? {} : { repository }),
    metadata: {
      ...(category === undefined ? {} : { category }),
      keywords: facts.keywords,
      labels,
      sortKeys,
    },
    versions,
  }
}

/**
 * The three pure stages in order, for one plugin: derive the published facts, decide the curation,
 * assemble the entry.
 *
 * They stay separate functions because each answers a different question and each is worth testing on
 * its own — "what did the package publish", "how does this market classify it", "what does the
 * document say". This wrapper exists so the pipeline does not have to know the order.
 */
export function buildEntry({
  name,
  config,
  explicit,
  settings,
  packument,
  tarball,
  starsFor,
  report,
}) {
  const facts = deriveFacts({ name, explicit, settings, packument, tarball, report })
  const { category, labels } = curate(name, config, settings, facts.keywords)
  const sortKeys = sortKeysOf(explicit, { repository: facts.repository, starsFor, report })
  return {
    plugin: assembleEntry(facts, { category, labels, sortKeys }),
    facts,
    newest: facts.newest,
    languages: facts.languages,
    assets: facts.asset === undefined ? [] : [facts.asset],
    fetchedBytes: facts.fetchedBytes,
    unpackedBytes: facts.unpackedBytes,
    fileCount: facts.fileCount,
    largestFile: facts.largestFile,
  }
}
