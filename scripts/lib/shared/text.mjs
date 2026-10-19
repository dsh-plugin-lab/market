/**
 * Turning registry and manifest values into format-1 values.
 *
 * Pure functions: no I/O, no clock, no globals. The two that can degrade (`localizedText`,
 * `localeText`) take the diagnostics reporter as an argument instead of importing one, so a test can
 * pass a spy and assert the code without stubbing a module.
 */

/** `locale/<language>.json` inside a published package; the language id is the file name. */
export const LANGUAGE_FILE = /^package\/locale\/([a-z]{2,8}(?:-[a-z0-9]{1,8})*)\.json$/u

/** `git+https://github.com/o/r.git`, `git@github.com:o/r.git` and `github:o/r` all become a page URL. */
export function repositoryUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  let url = raw.trim()
  url = url.replace(/^git\+/u, '')
  const scp = /^git@([^:]+):(.+)$/u.exec(url)
  if (scp) url = `https://${scp[1]}/${scp[2]}`
  const shorthand = /^github:(.+)$/u.exec(url)
  if (shorthand) url = `https://github.com/${shorthand[1]}`
  url = url.replace(/^git:\/\//u, 'https://')
  url = url.replace(/^ssh:\/\/git@/u, 'https://')
  url = url.replace(/[?#].*$/u, '')
  url = url.replace(/\.git$/u, '')
  if (!/^https?:\/\//u.test(url)) return undefined
  try {
    if (!URL.canParse(url)) return undefined
  } catch {
    return undefined
  }
  return url
}

export function repositoryOf(source, layout) {
  if (source === undefined || source === null) return undefined
  const raw = typeof source === 'string' ? { url: source } : source
  const url = repositoryUrl(raw.url)
  if (url === undefined) return undefined
  const repository = { url }
  const directory = raw.directory ?? layout.directory
  if (typeof directory === 'string' && directory !== '') {
    repository.directory = directory.replace(/^\.\//u, '').replace(/\/$/u, '')
  }
  return repository
}

export function authorOf(raw) {
  if (typeof raw === 'string') return raw.trim() === '' ? undefined : raw.trim()
  if (raw && typeof raw.name === 'string' && raw.name.trim() !== '') return raw.name.trim()
  return undefined
}

/** `LocalizedText`: a string, or a record of lowercase language ids that must include `en`. */
export function localizedText(report, over, fromLocale, fallback) {
  const text = {}
  for (const [language, value] of Object.entries(fromLocale ?? {})) {
    if (typeof value === 'string' && value.trim() !== '') text[language] = value.trim()
  }
  if (typeof fallback === 'string' && fallback.trim() !== '' && text.en === undefined) {
    text.en = fallback.trim()
  }
  for (const [language, value] of Object.entries(over ?? {})) {
    if (typeof value === 'string' && value.trim() !== '') text[language] = value.trim()
  }
  if (Object.keys(text).length === 0) return undefined
  if (text.en === undefined) {
    report(
      'text-missing-en',
      `no English text (languages: ${Object.keys(text).join(', ')}) — the index requires "en"`,
    )
    return undefined
  }
  return text
}

/** The `meta.title` / `meta.description` pairs of `locale/*.json`, keyed by the file's language id. */
export function localeText(report, entries) {
  const titles = {}
  const descriptions = {}
  const found = []
  for (const [path, bytes] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    const match = LANGUAGE_FILE.exec(path)
    if (match === null) continue
    let parsed
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      report('locale-invalid', `${path}: not valid JSON (${error.message})`)
      continue
    }
    const language = match[1]
    const title = parsed?.meta?.title ?? parsed?.title
    const description = parsed?.meta?.description ?? parsed?.description
    if (typeof title === 'string') titles[language] = title
    if (typeof description === 'string') descriptions[language] = description
    found.push(language)
  }
  if (found.length === 0) {
    report('locale-missing', 'no locale/<language>.json in the published package')
  }
  return { titles, descriptions, languages: found }
}

export function slugOf(name) {
  return name.replace(/^@/u, '').replace(/\//gu, '-')
}

export function keywordsOf(settings, ...lists) {
  const words = []
  for (const list of lists) {
    for (const word of list ?? []) {
      if (typeof word !== 'string') continue
      const trimmed = word.trim()
      if (trimmed === '') continue
      if (settings.keywordBlocklist.has(trimmed.toLowerCase())) continue
      if (!words.includes(trimmed)) words.push(trimmed)
    }
  }
  return words.slice(0, settings.maxKeywords)
}
