import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_ZONES, zonedTimes } from '../scripts/lib/shared/time.mjs'

/**
 * The clock is passed in, so these are exact strings rather than "roughly now".
 *
 * The two instants are chosen for daylight saving: in January London is on GMT and Los Angeles on
 * standard time, in July both have moved an hour. A stored offset table would pass one test and fail
 * the other, which is the whole reason the offset is computed per build.
 */
const WINTER = new Date('2026-01-15T00:00:00.000Z')
const SUMMER = new Date('2026-07-15T00:00:00.000Z')

test('renders one instant in every zone, UTC first', () => {
  const times = zonedTimes(WINTER, ['Asia/Shanghai', 'Europe/London'])
  assert.deepEqual(Object.keys(times), ['UTC', 'Asia/Shanghai', 'Europe/London'])
  assert.equal(times.UTC, '2026-01-15T00:00:00.000+00:00')
  assert.equal(times['Asia/Shanghai'], '2026-01-15T08:00:00.000+08:00')
  assert.equal(times['Europe/London'], '2026-01-15T00:00:00.000+00:00')
})

test('daylight saving is applied for the instant, not for the zone', () => {
  const times = zonedTimes(SUMMER, ['Europe/London', 'America/Los_Angeles'])
  assert.equal(times['Europe/London'], '2026-07-15T01:00:00.000+01:00')
  assert.equal(times['America/Los_Angeles'], '2026-07-14T17:00:00.000-07:00')
})

test('a fixed-offset zone keeps its offset in both seasons', () => {
  assert.equal(zonedTimes(WINTER, ['Asia/Shanghai'])['Asia/Shanghai'].slice(-6), '+08:00')
  assert.equal(zonedTimes(SUMMER, ['Asia/Shanghai'])['Asia/Shanghai'].slice(-6), '+08:00')
})

test('the default zones are the ones a maintainer reads', () => {
  assert.equal(Object.keys(zonedTimes(WINTER)).length, DEFAULT_ZONES.length + 1)
})

test('the same instant reads differently, but means the same moment', () => {
  const times = zonedTimes(WINTER, ['Asia/Shanghai'])
  for (const value of Object.values(times))
    assert.equal(new Date(value).getTime(), WINTER.getTime())
})

test('midnight renders as 00, not 24', () => {
  // `hour12: false` lets ICU pick 24 for midnight in some builds; `hourCycle: 'h23'` pins it.
  const times = zonedTimes(new Date('2026-10-22T16:00:00.000Z'), ['Asia/Shanghai'])
  assert.equal(times['Asia/Shanghai'], '2026-10-23T00:00:00.000+08:00')
})

test('a duplicate or explicit UTC collapses instead of repeating', () => {
  assert.deepEqual(Object.keys(zonedTimes(WINTER, ['UTC', 'UTC', 'Asia/Shanghai'])), [
    'UTC',
    'Asia/Shanghai',
  ])
})

test('an unknown zone names the config key that carries it', () => {
  assert.throws(
    () => zonedTimes(WINTER, ['China Standard Time']),
    /build\.localTimeZones.*China Standard Time/u,
  )
})

test('a missing or invalid instant is refused', () => {
  assert.throws(() => zonedTimes(new Date('nope'), ['UTC']), /valid Date/u)
})
