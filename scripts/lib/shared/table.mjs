/**
 * A table, measured rather than guessed.
 *
 * Both commands print one. Column widths follow the content: a declared `engines.dsh` range grows
 * every time upstream opens a prerelease line, and a hard-coded width turns that into a misaligned
 * table nobody trusts. Alignment is per column because a count belongs on the right and a name does
 * not.
 *
 * Returns the lines rather than printing them, so a caller can put the table in a summary, a file, or
 * stdout without this module knowing which.
 */

/** `columns` are ids; `rows` are objects keyed by them; every value is a string. */
export function renderTable(columns, rows, { indent = '  ', gap = '  ', align = {} } = {}) {
  const width = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length)),
    ]),
  )
  const cell = (column, value) => {
    const text = String(value ?? '')
    return align[column] === 'right' ? text.padStart(width[column]) : text.padEnd(width[column])
  }
  const line = (values) =>
    `${indent}${columns.map((column, index) => cell(column, values[index])).join(gap)}`
  return [
    line(columns),
    `${indent}${columns.map((column) => '-'.repeat(width[column])).join(gap)}`,
    ...rows.map((row) => line(columns.map((column) => row[column]))),
  ]
}
