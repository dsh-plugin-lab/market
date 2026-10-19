/**
 * The format-1 contract: which members an index may carry, and the walk that checks it.
 *
 * Shared by the generator and the validator on purpose. The generator writes these members and the
 * validator rejects anything else, so a single table keeps both from drifting — and it is the reason
 * a member the format does not define (an npm `dist-tags`, say) cannot be written here and then
 * silently dropped by the reader.
 *
 * The rules themselves belong to the official validator (`parseMarketIndex`); this table only answers
 * "does format 1 define this key at all?".
 */
export const ALLOWED = {
  index: ['format', 'title', 'description', 'metadata', 'plugins'],
  metadata: ['categories', 'labels', 'sortKeys'],
  declaration: ['title'],
  sortKeyDeclaration: ['title', 'order'],
  plugin: [
    'name',
    'title',
    'description',
    'icon',
    'author',
    'homepage',
    'repository',
    'metadata',
    'versions',
  ],
  pluginMetadata: ['category', 'keywords', 'labels', 'sortKeys'],
  repository: ['url', 'directory'],
  version: ['version', 'publishTimestamp', 'source', 'engines'],
  sourceNpm: ['type', 'registry'],
  sourceGit: ['type', 'url', 'commit', 'path'],
  engines: ['dsh'],
}

function members(value, kind, path, report) {
  if (value === null || typeof value !== 'object') return
  for (const key of Object.keys(value)) {
    if (!ALLOWED[kind].includes(key))
      report(`${path}.${key}: format 1 does not define this member — DSH drops it silently`)
  }
}

/**
 * Walk an index and report every member the format would silently drop.
 *
 * `report` receives a message, not a code: this is a contract violation, not a build degradation, so
 * the caller decides whether it is fatal. The build ignores nothing — it calls this before writing —
 * and `check` turns every message into a failed run.
 */
export function findUndefinedMembers(raw, report) {
  members(raw, 'index', '$', report)
  if (raw.metadata && typeof raw.metadata === 'object') {
    members(raw.metadata, 'metadata', '$.metadata', report)
    for (const group of ['categories', 'labels']) {
      for (const [id, value] of Object.entries(raw.metadata[group] ?? {})) {
        members(value, 'declaration', `$.metadata.${group}.${id}`, report)
      }
    }
    for (const [id, value] of Object.entries(raw.metadata.sortKeys ?? {})) {
      members(value, 'sortKeyDeclaration', `$.metadata.sortKeys.${id}`, report)
    }
  }
  for (const [position, plugin] of (raw.plugins ?? []).entries()) {
    const at = `$.plugins[${position}]`
    members(plugin, 'plugin', at, report)
    members(plugin.metadata, 'pluginMetadata', `${at}.metadata`, report)
    members(plugin.repository, 'repository', `${at}.repository`, report)
    for (const [versionPosition, version] of (plugin.versions ?? []).entries()) {
      const versionAt = `${at}.versions[${versionPosition}]`
      members(version, 'version', versionAt, report)
      members(
        version.source ?? {},
        version.source?.type === 'git' ? 'sourceGit' : 'sourceNpm',
        `${versionAt}.source`,
        report,
      )
      members(version.engines ?? {}, 'engines', `${versionAt}.engines`, report)
    }
  }
}
