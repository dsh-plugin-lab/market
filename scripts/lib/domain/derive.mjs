/**
 * Derive: published data → the facts about what a package actually shipped.
 *
 * This is the boundary between "the outside world" and "our document". Everything here turns a
 * packument and a tarball into plain values; nothing here decides how a plugin is classified, and
 * nothing here writes a file. The output of this module is the only shape the rest of the build knows
 * about, which is what keeps curation and assembly free of registry details.
 *
 * Two kinds of failure stay distinct:
 *   - a **missing** fact degrades and is reported as a code (the market still works);
 *   - a **contradiction** throws (the entry would be a lie).
 */
import semver from 'semver'
import { extname } from 'node:path'
import { authorOf, keywordsOf, localeText, localizedText, repositoryOf } from '../shared/text.mjs'

const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])

/** A contradiction: the entry would be a lie, so it is not produced at all. */
const fail = (message) => {
  throw new Error(message)
}

/**
 * Which published versions the index lists, newest first.
 *
 * Three policies meet here, and they are not the same kind of decision:
 *
 *   - **`includePrerelease` / `maxVersionsPerPlugin`** are market policy from `config.json`: how much
 *     history to advertise. Changing them changes what the market offers, nothing about the package.
 *   - **A deprecation is not policy, it is the registry saying "do not use this"** — and it is the one
 *     exclusion with a moral weight behind it: npm carries a reason ("the client plugin fails to load
 *     and DSH cannot be opened"), and listing such a version invites exactly that failure. Format 1 has
 *     no member to mark it with, so the honest move is not to list it at all.
 *   - The exclusion is **recorded, not silent**: the caller reports it, because a version quietly
 *     disappearing from a list is the same failure mode this repository keeps guarding against.
 *
 * Deprecated versions are dropped **before** the cap is applied, so `maxVersionsPerPlugin` counts
 * versions a reader may actually install.
 */
export function selectVersions(name, packument, settings, report) {
  const published = Object.keys(packument.versions ?? {}).sort(semver.rcompare)
  if (published.length === 0) fail(`${name}: the registry lists no version`)

  const deprecated = published.filter((version) => packument.versions[version]?.deprecated)
  const usable = published.filter(
    (version) => packument.versions[version]?.deprecated === undefined,
  )

  const selected = []
  for (const version of usable) {
    if (!settings.includePrerelease && semver.prerelease(version) !== null) continue
    if (settings.maxVersionsPerPlugin > 0 && selected.length >= settings.maxVersionsPerPlugin) break
    selected.push(version)
  }
  if (selected.length === 0) {
    // A package that has only ever published prereleases is not a reason to take the market down.
    selected.push(usable[0] ?? published[0])
    report(
      'prerelease-only',
      `${name}: no stable version is published, so ${selected[0]} (a prerelease) is listed instead`,
      { plugin: name },
    )
  }
  const latestTagged = packument['dist-tags']?.latest
  if (typeof latestTagged === 'string' && !selected.includes(latestTagged)) {
    const message = `${name}: the "latest" tag (${latestTagged}) is not among the listed versions`
    // A stable `latest` that is missing means this build dropped the newest release — a defect.
    // A prerelease `latest` is simply excluded by a stable-only policy, which is not a defect.
    // A deprecated `latest` is the registry contradicting itself, and it is worth being loud about.
    if (semver.prerelease(latestTagged) !== null)
      report('latest-tag-prerelease', `${message} — it is a prerelease, and it is not listed`, {
        plugin: name,
      })
    else if (deprecated.includes(latestTagged)) fail(`${message} — and it is deprecated`)
    else fail(message)
  }
  return { selected, deprecated }
}

/** One version record, or `undefined` when it cannot be described honestly. */
function versionRecord(name, version, packument, manifestVersion, sourceConfig, report) {
  const timestamp = Date.parse(packument.time?.[version] ?? '')
  if (!Number.isFinite(timestamp)) {
    report(
      'version-skipped',
      `${name}@${version}: the registry publishes no timestamp for it — the version is skipped`,
      { plugin: name, version },
    )
    return undefined
  }
  const publishTimestamp = Math.floor(timestamp / 1000)
  if (publishTimestamp < 0 || publishTimestamp >= 1e11) {
    report(
      'version-skipped',
      `${name}@${version}: publish time ${publishTimestamp} is out of range — the version is skipped`,
      { plugin: name, version },
    )
    return undefined
  }

  let source
  if (sourceConfig.type === 'git') {
    const commit = manifestVersion.gitHead
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/u.test(commit)) {
      report(
        'version-skipped',
        `${name}@${version}: no 40-hex gitHead, so a git source cannot be pinned — the version is skipped`,
        { plugin: name, version },
      )
      return undefined
    }
    const url = repositoryOf({ url: sourceConfig.url ?? packument.repository?.url }, {})?.url
    if (url === undefined) fail(`${name}@${version}: a git source needs an https repository URL`)
    source = { type: 'git', url, commit }
    const directory =
      sourceConfig.directory ?? repositoryOf(packument.repository, {})?.directory ?? undefined
    if (typeof directory === 'string' && directory !== '') source.path = directory
  } else {
    source = { type: 'npm' }
    if (typeof sourceConfig.registry === 'string') source.registry = sourceConfig.registry
  }

  const engines = {}
  const dsh = manifestVersion.engines?.dsh
  if (typeof dsh === 'string' && dsh.trim() !== '') {
    if (dsh.startsWith('workspace:')) {
      report(
        'engine-invalid',
        `${name}@${version}: engines.dsh is a workspace range — it is not published`,
      )
    } else if (semver.validRange(dsh) !== null) {
      engines.dsh = dsh
    } else {
      report(
        'engine-invalid',
        `${name}@${version}: engines.dsh ${JSON.stringify(dsh)} is not a SemVer range — it is omitted`,
        { plugin: name, version },
      )
    }
  }

  return { version, publishTimestamp, source, engines }
}

/** An icon the package ships, as bytes plus the path it gets. Writing it is the pipeline's job. */
function iconOf(name, entries, manifest, tarballUnreadable, explicit, report) {
  if (typeof explicit.icon === 'string' && explicit.icon.trim() !== '') {
    return { icon: explicit.icon.trim(), asset: undefined }
  }
  if (tarballUnreadable) return { icon: undefined, asset: undefined }
  if (typeof manifest.icon !== 'string' || manifest.icon.trim() === '')
    return { icon: undefined, asset: undefined }

  const iconPath = `package/${manifest.icon.trim().replace(/^\.\//u, '')}`
  const bytes = entries.get(iconPath)
  const extension = extname(iconPath).toLowerCase()
  if (bytes === undefined) {
    report(
      'icon-declared-missing',
      `${name}: package.json names ${manifest.icon}, but the tarball does not contain it`,
    )
    return { icon: undefined, asset: undefined }
  }
  if (!ICON_EXTENSIONS.has(extension)) {
    report(
      'icon-extension',
      `${name}: ${manifest.icon} is not an SVG/PNG/JPEG/WebP file — no icon is listed`,
    )
    return { icon: undefined, asset: undefined }
  }
  return {
    icon: `icons/${slug(name)}${extension}`,
    asset: { file: `icons/${slug(name)}${extension}`, bytes },
  }
}

/** The file-system-safe name for a package: scoped names lose their scope marker. */
function slug(name) {
  return name.replace(/^@/u, '').replace(/[/@]/gu, '-').toLowerCase()
}

/**
 * A cached degradation that is no longer necessary: the override exists because published metadata
 * was wrong, and it becomes dead weight the moment a release fixes the source. Nobody remembers to
 * delete it, so the build says so — comparing against the registry is the only way to notice.
 */
function reportRedundantOverrides(
  name,
  { explicit, packument, repository, homepage, author },
  report,
) {
  if (explicit.repository !== undefined) {
    const derived = repositoryOf(packument.repository, {})
    if (JSON.stringify(derived) === JSON.stringify(repository)) {
      report(
        'override-redundant',
        `${name}: config.json overrides "repository", but the registry already publishes the same value — delete the override`,
        { plugin: name, field: 'repository' },
      )
    }
  }
  if (
    typeof explicit.homepage === 'string' &&
    typeof packument.homepage === 'string' &&
    explicit.homepage === packument.homepage
  ) {
    report(
      'override-redundant',
      `${name}: config.json overrides "homepage", but the registry already publishes the same value — delete the override`,
      { plugin: name, field: 'homepage' },
    )
  }
  if (explicit.author !== undefined && authorOf(explicit.author) === authorOf(packument.author)) {
    report(
      'override-redundant',
      `${name}: config.json overrides "author", but the registry already publishes the same value — delete the override`,
      { plugin: name, field: 'author' },
    )
  }
}

/**
 * Everything that is true about the package, independent of how this market classifies it.
 *
 * `tarball` is `{ entries, bytes }` when the fetch succeeded and `{ unreadable }` when it did not —
 * the difference is carried as data, so nothing downstream has to infer "no locale" from a missing
 * map, which would turn one network failure into four data defects.
 */
export function deriveFacts({ name, explicit, settings, packument, tarball, report }) {
  const entries = tarball.entries
  const fetchFailed = tarball.unreadable !== undefined
  const { selected, deprecated } = selectVersions(name, packument, settings, report)
  const sourceConfig = explicit.source ?? { type: 'npm' }
  const newest = selected[0]
  const newestManifest = packument.versions[newest]

  if (fetchFailed) {
    report(
      'tarball-unreadable',
      `${name}: the ${newest} tarball is unreadable — falling back to registry text`,
      {
        plugin: name,
      },
    )
  }
  const manifest = entries?.has('package/package.json')
    ? JSON.parse(entries.get('package/package.json').toString('utf8'))
    : newestManifest

  const versions = []
  for (const version of selected) {
    const record = versionRecord(
      name,
      version,
      packument,
      packument.versions[version],
      sourceConfig,
      report,
    )
    if (record !== undefined) versions.push(record)
  }
  if (versions.length === 0) fail(`${name}: no listed version could be described`)

  // One unreadable tarball already says why the text and the icon are missing; reporting the
  // consequences separately would turn one cause into several codes and hide the cause in the noise.
  const locale = fetchFailed
    ? { titles: {}, descriptions: {}, languages: [] }
    : localeText(report, entries)
  const title = localizedText(report, explicit.title, locale.titles, undefined)
  const description = localizedText(
    report,
    explicit.description,
    locale.descriptions,
    packument.description,
  )
  if (title === undefined)
    report('title-missing', `${name}: no title in any language — the index shows the package name`)

  const { icon, asset } = iconOf(name, entries, manifest, fetchFailed, explicit, report)

  const repository = repositoryOf(explicit.repository ?? packument.repository, {})
  if (repository === undefined && packument.repository !== undefined) {
    report(
      'repository-invalid',
      `${name}: repository ${JSON.stringify(packument.repository)} is not an http(s) URL — it is omitted`,
      { plugin: name },
    )
  }

  const homepage = typeof explicit.homepage === 'string' ? explicit.homepage : packument.homepage
  const author = authorOf(explicit.author) ?? authorOf(packument.author)
  reportRedundantOverrides(name, { explicit, packument, repository, homepage, author }, report)

  return {
    name,
    newest,
    title,
    description,
    icon,
    asset,
    author,
    homepage,
    repository,
    versions,
    languages: locale.languages,
    // Not a degradation: the registry declared these unusable, so the market declines to offer them.
    // Recorded rather than reported, because a permanent, intended condition must not become alert
    // noise — but also not silently dropped, because a version vanishing from a list needs a reason.
    excluded: { deprecated },
    keywords: keywordsOf(settings, packument.keywords, explicit.keywords, [name]),
    fetchedBytes: tarball.bytes ?? 0,
    // What the package costs a consumer, and what makes it cost that. A number without its cause is
    // a number nobody acts on, so the largest file travels with the total.
    unpackedBytes: tarball.sizes?.unpacked ?? 0,
    fileCount: tarball.sizes?.fileCount ?? 0,
    largestFile: tarball.sizes?.largest,
  }
}
