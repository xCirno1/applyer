/**
 * Sorting and text-filtering rules for `DataTable`, kept as a plain module
 * (no React, no DOM) for the same reason as `workspace/workspaceLayout.ts`:
 * these are the parts worth pinning down in a test, and `DataTable` itself is
 * presentational, so they are not tangled up in it.
 *
 * `useSortableTable` is the React half that holds the state and calls these.
 *
 * Everything here runs over rows that came from a database, an ATS provider's
 * API, or an imported bundle, so no value is assumed to be the type its column
 * declares: an accessor that throws or a `NaN` count must degrade to "this row
 * has no value here" plus a log line, never to a crash or an empty table.
 */

/** What a column can be sorted and filtered by. Anything else is a bug in the caller. */
export type CellValue = string | number | boolean | null | undefined

export type SortDir = 'asc' | 'desc'

/** The comparable value behind a rendered cell, keyed by the column's `key`. */
export type CellAccessor<T> = (row: T) => CellValue

export type CellAccessors<T> = Record<string, CellAccessor<T>>

/**
 * Read one cell, defensively. An accessor reaching into a row shape the data
 * does not actually have (an older export, a provider that changed its
 * payload) throws here rather than three frames up inside React's render.
 */
export function readValue<T>(accessor: CellAccessor<T>, row: T, key: string): CellValue {
  try {
    return accessor(row)
  } catch (err) {
    console.error(`DataTable: column "${key}" could not read a row: ${String(err)}`)
    return null
  }
}

/** A value that sorts and filters as "absent": no text, and no place on a number line. */
function isMissing(value: CellValue): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'number') return !Number.isFinite(value)
  return value === ''
}

function toText(value: CellValue): string {
  return isMissing(value) ? '' : String(value).toLowerCase()
}

/**
 * Order two cells. Missing values always sink to the bottom, in both
 * directions: a descending sort is a request to see the largest values first,
 * not to fill the top of the table with rows that have no value at all.
 *
 * Same-typed values compare natively; anything mixed falls back to a
 * locale-aware string compare with `numeric` collation, so `run-2` precedes
 * `run-10` instead of following it.
 */
export function compareCells(a: CellValue, b: CellValue): number {
  const aMissing = isMissing(a)
  const bMissing = isMissing(b)
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1

  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Which direction a header click asks for: a column you are already sorting
 * descending flips to ascending, anything else starts descending. Tables lead
 * with their largest, newest or worst rows far more often than the reverse, so
 * that is the first click's answer.
 */
export function nextSortDir(isActive: boolean, current: SortDir): SortDir {
  return isActive && current === 'desc' ? 'asc' : 'desc'
}

/**
 * Sort a copy of `rows`. A key with no accessor behind it (a stale persisted
 * sort, a column dropped in an update) leaves the order untouched: the
 * caller's own ordering is a better answer than an arbitrary one.
 */
export function sortRows<T>(rows: T[], accessors: CellAccessors<T>, key: string | null, dir: SortDir): T[] {
  if (!key) return rows
  const accessor = accessors[key]
  if (!accessor) {
    console.warn(`DataTable: ignoring a sort on "${key}", which has no value accessor.`)
    return rows
  }

  const sign = dir === 'asc' ? 1 : -1
  // Read every cell once up front: an accessor can be doing real work (parsing
  // a date, deriving a status), and a comparison sort would otherwise call it
  // O(n log n) times per row.
  const keyed = rows.map((row) => ({ row, value: readValue(accessor, row, key) }))
  // Array.prototype.sort is stable, so rows that tie keep the order they
  // arrived in rather than shuffling on every re-render.
  keyed.sort((a, b) => {
    const order = compareCells(a.value, b.value)
    // Missing values stay at the bottom in both directions, so the direction
    // sign is not applied to them.
    return isMissing(a.value) || isMissing(b.value) ? order : order * sign
  })
  return keyed.map((entry) => entry.row)
}

/**
 * Whether a row matches the filter box. The query is split on whitespace and
 * every token has to appear in some searched column, so typing "acme green"
 * narrows rather than finding nothing: two words are almost never adjacent in
 * one cell.
 */
export function matchesQuery<T>(row: T, accessors: CellAccessors<T>, keys: string[], query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true

  const haystack = keys
    .map((key) => {
      const accessor = accessors[key]
      return accessor ? toText(readValue(accessor, row, key)) : ''
    })
    .filter(Boolean)

  if (haystack.length === 0) return false
  return tokens.every((token) => haystack.some((text) => text.includes(token)))
}

/** Filter, then sort. Returns `rows` itself when the query is blank and nothing is sorted. */
export function filterAndSort<T>(
  rows: T[],
  accessors: CellAccessors<T>,
  searchKeys: string[],
  query: string,
  sortKey: string | null,
  sortDir: SortDir
): T[] {
  const narrowed =
    query.trim().length > 0 ? rows.filter((row) => matchesQuery(row, accessors, searchKeys, query)) : rows
  return sortRows(narrowed, accessors, sortKey, sortDir)
}

/**
 * Which of the two empty states an empty table is in: "nothing is here" or
 * "nothing matched".
 *
 * They are different statements and only one can be true, so guessing costs
 * something: telling a person that no boards are tracked, when in fact they
 * have two hundred and none of them is on the provider they just picked, is
 * simply false. The filter box answers this on its own only for a table whose
 * every filter is that box; a table that also narrows rows behind a toolbar
 * control (`DataTable`'s `narrowed` prop) has to say so itself.
 */
export function isNarrowedEmpty(
  narrowed: boolean | undefined,
  hasFilterBar: boolean,
  filterValue: string | undefined
): boolean {
  if (narrowed !== undefined) return narrowed
  return hasFilterBar && (filterValue ?? '').length > 0
}
