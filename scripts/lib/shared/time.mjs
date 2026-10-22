/**
 * One instant, written the way people in several places would write it.
 *
 * `status.json` already carries `startedAt` / `finishedAt` as ISO-8601 in UTC, because that is the one
 * form that is unambiguous, sortable and machine-readable. It is also the form a human has to do
 * arithmetic on: a maintainer in UTC+8 reading `2026-10-22T06:05:41Z` has to add eight hours before the
 * number means anything.
 *
 * So the same instant is rendered again per zone, and both are published. Nothing here replaces the UTC
 * form — it is derived from it, and it stays a rendering rather than a second source of truth.
 *
 * Two decisions that look like details and are not:
 *
 *   - **Zone identifiers are IANA names.** `Asia/Shanghai`, not `CST` (which `Intl` resolves to US
 *     Central, −05:00), not `+08:00` (a fixed offset has no DST rule, so London and Los Angeles would
 *     be wrong for half the year), and not `China Standard Time` (a Windows name `Intl` rejects).
 *     The city in the name is how the database identifies which set of historical rules applies.
 *   - **Offsets are computed for this instant, never stored.** London is +01:00 in July and +00:00 in
 *     January; a hardcoded table is a bug that sleeps for six months.
 *
 * Pure: the caller passes the `Date`. No clock is read here, so a test pins one instant and asserts the
 * exact strings.
 */

/** Rendered when `config.json` says nothing. UTC is not in this list: it is always added. */
export const DEFAULT_ZONES = ['Asia/Shanghai', 'Europe/London', 'America/Los_Angeles']

const pad = (value, width = 2) => String(value).padStart(width, '0')

/**
 * The offset `Intl` reports for a zone, as `+08:00`.
 *
 * `longOffset` is the direct answer ("GMT+08:00"), but it is a newer addition to the format; the
 * fallback derives the same number from the zone's wall clock, which works anywhere `Intl` has the zone
 * at all. Both paths end in the same string, so the output does not depend on the ICU build.
 */
function offsetOf(date, zone, parts) {
  const named = parts.find((part) => part.type === 'timeZoneName')?.value
  const direct = /^GMT([+-]\d{2}:\d{2})$/u.exec(named ?? '')
  if (direct) return direct[1]
  if (named === 'GMT' || named === 'UTC') return '+00:00'
  const asUtc = Date.UTC(
    Number(parts.find((part) => part.type === 'year').value),
    Number(parts.find((part) => part.type === 'month').value) - 1,
    Number(parts.find((part) => part.type === 'day').value),
    Number(parts.find((part) => part.type === 'hour').value),
    Number(parts.find((part) => part.type === 'minute').value),
    Number(parts.find((part) => part.type === 'second').value),
  )
  const minutes = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000)
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

/** `2026-10-22T14:05:41.291+08:00` — the same instant as an ISO string, in the zone's own terms. */
function render(date, zone) {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      // `h23` rather than `hour12: false`: the latter leaves ICU free to render midnight as 24.
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }).formatToParts(date)
  } catch {
    throw new Error(`config.json: "build.localTimeZones" names an unknown time zone: ${zone}`)
  }
  const get = (type) => parts.find((part) => part.type === type)?.value
  return (
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}` +
    `.${pad(date.getUTCMilliseconds(), 3)}${offsetOf(date, zone, parts)}`
  )
}

/**
 * The instant rendered per zone, `UTC` first.
 *
 * Keys are the IANA identifiers themselves rather than made-up labels: the string is the thing a reader
 * would search for, and a second naming scheme would be one more thing to keep in agreement. Duplicates
 * and a configured `UTC` collapse, so the caller can be careless about the list.
 */
export function zonedTimes(date, zones = DEFAULT_ZONES) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()))
    throw new Error('zonedTimes needs a valid Date')
  const times = { UTC: render(date, 'UTC') }
  for (const zone of zones) {
    if (zone === 'UTC' || zone in times) continue
    times[zone] = render(date, zone)
  }
  return times
}
