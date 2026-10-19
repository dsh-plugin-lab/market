import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  authorOf,
  keywordsOf,
  localeText,
  localizedText,
  repositoryOf,
  repositoryUrl,
  slugOf,
} from '../scripts/lib/normalize.mjs'

const recorder = () => {
  const seen = []
  const report = (code, message) => seen.push({ code, message })
  return { seen, report }
}

test('repositoryUrl normalises every shape npm publishes', () => {
  const cases = [
    ['git+https://github.com/o/r.git', 'https://github.com/o/r'],
    ['git+http://example.com/o/r.git', 'http://example.com/o/r'],
    ['https://github.com/o/r', 'https://github.com/o/r'],
    ['git@github.com:o/r.git', 'https://github.com/o/r'],
    ['github:o/r', 'https://github.com/o/r'],
    ['git://github.com/o/r.git', 'https://github.com/o/r'],
    ['ssh://git@github.com/o/r.git', 'https://github.com/o/r'],
    ['https://github.com/o/r#readme', 'https://github.com/o/r'],
    ['https://github.com/o/r?tab=1', 'https://github.com/o/r'],
    ['https://github.com/o/r/', 'https://github.com/o/r/'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(repositoryUrl(input), expected, input)
  }
})

test('repositoryUrl rejects what is not an http(s) URL', () => {
  for (const input of [undefined, null, '', '   ', 'ftp://example.com/o/r', 'not a url']) {
    assert.equal(repositoryUrl(input), undefined, String(input))
  }
})

test('repositoryOf keeps a package directory and strips its edges', () => {
  assert.deepEqual(
    repositoryOf({ url: 'git+https://github.com/o/r.git', directory: './packages/x/' }, {}),
    {
      url: 'https://github.com/o/r',
      directory: 'packages/x',
    },
  )
  assert.deepEqual(repositoryOf('https://github.com/o/r', { directory: 'sub' }), {
    url: 'https://github.com/o/r',
    directory: 'sub',
  })
  assert.equal(repositoryOf(undefined, {}), undefined)
})

test('authorOf accepts a string and an object', () => {
  assert.equal(authorOf('zlZayn'), 'zlZayn')
  assert.equal(authorOf({ name: 'zlZayn', email: 'x@y.z' }), 'zlZayn')
  assert.equal(authorOf({}), undefined)
  assert.equal(authorOf('  '), undefined)
})

test('localizedText prefers explicit overrides and requires en', () => {
  const { seen, report } = recorder()
  assert.deepEqual(localizedText(report, { en: 'Over' }, { en: 'Locale', zh: '中文' }), {
    en: 'Over',
    zh: '中文',
  })
  assert.equal(seen.length, 0)
})

test('localizedText falls back to the registry description for en', () => {
  const { report } = recorder()
  assert.deepEqual(localizedText(report, undefined, { zh: '只有中文' }, 'registry text'), {
    zh: '只有中文',
    en: 'registry text',
  })
})

test('localizedText reports a missing en instead of inventing one', () => {
  const { seen, report } = recorder()
  assert.equal(localizedText(report, undefined, { zh: '只有中文' }), undefined)
  assert.deepEqual(
    seen.map((item) => item.code),
    ['text-missing-en'],
  )
})

test('localizedText returns undefined when there is nothing at all', () => {
  const { seen, report } = recorder()
  assert.equal(localizedText(report, undefined, {}, undefined), undefined)
  assert.equal(seen.length, 0)
})

test('localeText reads meta.title and meta.description per language', () => {
  const { report } = recorder()
  const entries = new Map([
    [
      'package/locale/en.json',
      Buffer.from(JSON.stringify({ meta: { title: 'Zhihu Search', description: 'd' } })),
    ],
    ['package/locale/zh.json', Buffer.from(JSON.stringify({ meta: { title: '知乎检索' } }))],
    ['package/package.json', Buffer.from('{}')],
  ])
  const text = localeText(report, entries)
  assert.deepEqual(text.titles, { en: 'Zhihu Search', zh: '知乎检索' })
  assert.deepEqual(text.descriptions, { en: 'd' })
  assert.deepEqual(text.languages, ['en', 'zh'])
})

test('localeText reports a missing locale directory', () => {
  const { seen, report } = recorder()
  const text = localeText(report, new Map([['package/package.json', Buffer.from('{}')]]))
  assert.deepEqual(text.languages, [])
  assert.deepEqual(
    seen.map((item) => item.code),
    ['locale-missing'],
  )
})

test('localeText reports an unreadable locale file and keeps the rest', () => {
  const { seen, report } = recorder()
  const entries = new Map([
    ['package/locale/en.json', Buffer.from('{not json')],
    ['package/locale/zh.json', Buffer.from(JSON.stringify({ meta: { title: '中文' } }))],
  ])
  const text = localeText(report, entries)
  assert.deepEqual(text.titles, { zh: '中文' })
  assert.deepEqual(
    seen.map((item) => item.code),
    ['locale-invalid'],
  )
})

test('slugOf flattens a scoped name', () => {
  assert.equal(slugOf('dsh-zhihu-search'), 'dsh-zhihu-search')
  assert.equal(slugOf('@scope/name'), 'scope-name')
})

test('keywordsOf drops the blocklist, de-duplicates and caps', () => {
  const settings = {
    keywordBlocklist: new Set(['dsh', 'dsh-plugin']),
    maxKeywords: 3,
  }
  assert.deepEqual(keywordsOf(settings, ['dsh', 'zhihu', 'search', 'zhihu', 'tool', 'extra']), [
    'zhihu',
    'search',
    'tool',
  ])
})
