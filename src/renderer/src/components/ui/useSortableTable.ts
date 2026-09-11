import { useCallback, useMemo, useState } from 'react'
import { filterAndSort, nextSortDir, type CellAccessors, type SortDir } from './dataTable'

/**
 * The client-side half of `DataTable`: holds the sort and filter-box state
 * and applies them, so a panel with a list already in memory gets a working
 * table from one call instead of re-deriving a comparator each time.
 *
 * `DataTable` itself stays presentational, which is what lets a
 * server-filtered list (one that refetches on every keystroke) drive the exact
 * same controls without this hook in the way.
 *
 * Same plain-module/React split as `workspace/workspaceLayout.ts` vs
 * `useWorkspaceLayout.ts`: the rules live in `dataTable.ts` and are tested
 * there, this is only the state around them.
 */
export interface SortableTableConfig<T> {
  /** The comparable value behind each sortable column, keyed by column `key`. */
  values: CellAccessors<T>
  /** Column keys the filter box searches. Defaults to every key in `values`. */
  searchKeys?: string[]
  initialSortKey?: string | null
  initialSortDir?: SortDir
}

export interface SortableTable<T> {
  /** `rows` after the filter box and the current sort. Spread the rest onto `DataTable`. */
  rows: T[]
  sortKey: string | null
  sortDir: SortDir
  onSort: (key: string) => void
  filterValue: string
  onFilterChange: (value: string) => void
  /** Whether the filter box is currently narrowing the table. */
  filtered: boolean
}

export function useSortableTable<T>(rows: T[], config: SortableTableConfig<T>): SortableTable<T> {
  const { values, searchKeys, initialSortKey = null, initialSortDir = 'desc' } = config
  // Key and direction are one piece of state: the new direction is a function
  // of whether this column was already the sorted one, which two separate
  // setters could not both see.
  const [sort, setSort] = useState<{ key: string | null; dir: SortDir }>({
    key: initialSortKey,
    dir: initialSortDir
  })
  const [filterValue, setFilterValue] = useState('')

  const onSort = useCallback((key: string): void => {
    setSort((current) => ({ key, dir: nextSortDir(current.key === key, current.dir) }))
  }, [])

  const keys = useMemo(() => searchKeys ?? Object.keys(values), [searchKeys, values])

  const visible = useMemo(
    () => filterAndSort(rows, values, keys, filterValue, sort.key, sort.dir),
    [rows, values, keys, filterValue, sort]
  )

  return {
    rows: visible,
    sortKey: sort.key,
    sortDir: sort.dir,
    onSort,
    filterValue,
    onFilterChange: setFilterValue,
    filtered: filterValue.trim().length > 0
  }
}
