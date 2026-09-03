import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from './Tooltip'
import type { SortDir } from './dataTable'

// Shared table shell for every data grid in the app (company boards, indexed
// jobs, exclusions, the activity log, …) so they all share one
// filter-bar/sortable-header/row-hover visual language instead of each
// hand-rolling its own <table>. Purely presentational: sort/filter STATE is
// owned by the caller (see useSortableTable for the common client-side case),
// which also keeps a server-filtered table honest, since it can hand this
// component the rows it already fetched and drive the same controls.
//
// There is no URL-driven variant here: this is a single-window Electron
// renderer with no router, so a sort header is always a button, never a link.

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  /** Wraps the header label in a Tooltip, for a column whose name is jargon. */
  headerTip?: string
  className?: string
  render: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  emptyMessage: ReactNode
  minWidthPx?: number
  sortKey?: string | null
  sortDir?: SortDir
  /** DataTable calls this on header click; the caller owns the toggle logic (see `nextSortDir`). */
  onSort?: (key: string) => void
  filterValue?: string
  onFilterChange?: (value: string) => void
  filterPlaceholder?: string
  /** Extra controls in the filter strip, e.g. dropdowns the caller narrows `rows` with itself. */
  toolbar?: ReactNode
  /** Shown instead of emptyMessage when rows is empty AND filterValue is non-empty. */
  noMatchMessage?: ReactNode
  /**
   * Makes the whole row clickable (drill-in, opening a detail modal, …).
   * Clicks that land on a link, button or form control inside the row are
   * ignored (see `isInteractiveTarget`), so a table can have both a row action
   * and cells that do something else without one swallowing the other.
   *
   * Supplying this also makes rows keyboard-operable (Enter/Space).
   */
  onRowClick?: (row: T) => void
  /** Extra classes per row, for painting a selected/paused/highlighted state. */
  rowClassName?: (row: T) => string
}

/**
 * Whether a click landed on something that handles its own activation.
 *
 * `closest` rather than a check on the event target itself, because the click
 * usually lands on a text node's parent (the `<span>` inside a `<button>`, the
 * icon `<svg>` inside a link) rather than on the control element.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('a,button,input,select,textarea,label,[role="button"]'))
}

const ALIGN_CLASS: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center'
}

export default function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage,
  minWidthPx = 720,
  sortKey = null,
  sortDir = 'desc',
  onSort,
  filterValue,
  onFilterChange,
  filterPlaceholder,
  toolbar,
  noMatchMessage,
  onRowClick,
  rowClassName
}: DataTableProps<T>): ReactElement {
  const { t } = useTranslation()
  const hasFilterBar = filterValue !== undefined && onFilterChange !== undefined

  return (
    <div>
      {/* Filter strip reads as a recessed toolbar band above the grid
          (bg-canvas-inset), the same treatment the header row gets, so the
          table's chrome is one continuous sunken region and the rows below
          are unambiguously the content. */}
      {(hasFilterBar || toolbar) && (
        <div className="flex items-center gap-2 border-b border-border bg-canvas-inset px-3 py-1.5">
          {hasFilterBar && (
            <>
              <FilterIcon />
              <input
                value={filterValue}
                onChange={(e) => onFilterChange?.(e.target.value)}
                placeholder={filterPlaceholder}
                aria-label={t('table.filter')}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-text placeholder:text-text-faint focus:outline-none"
              />
            </>
          )}
          {toolbar && <div className="ml-auto flex shrink-0 items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-text-faint">
          {hasFilterBar && filterValue ? (noMatchMessage ?? emptyMessage) : emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ minWidth: minWidthPx }}>
            {/* Column labels as recessed 10px all-caps micro-type on the
                sunken band, not 12px sentence case in the content plane: a
                header row should read as a ruler over the data, not as
                another row of it. */}
            <thead>
              <tr className="border-b border-border bg-canvas-inset text-[10px] uppercase tracking-[0.08em] text-text-faint">
                {columns.map((col) => {
                  const active = Boolean(col.sortable) && sortKey === col.key
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={`h-7 whitespace-nowrap px-3 font-semibold ${ALIGN_CLASS[col.align ?? 'left']}`}
                    >
                      <HeaderCell column={col} active={active} sortDir={sortDir} onSort={onSort} />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  onClick={
                    onRowClick
                      ? (e) => {
                          if (isInteractiveTarget(e.target)) return
                          onRowClick(row)
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          if (isInteractiveTarget(e.target)) return
                          // Space scrolls the page by default, which is the
                          // opposite of what activating a row should do.
                          e.preventDefault()
                          onRowClick(row)
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={`border-b border-border-soft transition-colors last:border-0 hover:bg-canvas-raised ${
                    onRowClick ? 'cursor-pointer focus:outline-none focus-visible:bg-canvas-raised' : ''
                  } ${rowClassName?.(row) ?? ''}`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-1.5 ${ALIGN_CLASS[col.align ?? 'left']} ${col.className ?? ''}`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function HeaderCell<T>({
  column,
  active,
  sortDir,
  onSort
}: {
  column: DataTableColumn<T>
  active: boolean
  sortDir: SortDir
  onSort?: (key: string) => void
}): ReactElement {
  const { t } = useTranslation()

  if (!column.sortable || !onSort) {
    return column.headerTip ? (
      <Tooltip label={column.headerTip}>
        <span className="cursor-help underline decoration-dotted underline-offset-2">{column.header}</span>
      </Tooltip>
    ) : (
      <>{column.header}</>
    )
  }

  const trigger = (
    <button
      type="button"
      onClick={() => onSort(column.key)}
      title={t('table.sortBy')}
      className={`cursor-pointer transition-colors hover:text-text ${active ? 'text-text' : ''}`}
    >
      <span className="inline-flex items-center gap-1">
        {column.header}
        <SortArrow active={active} dir={sortDir} />
      </span>
    </button>
  )

  return column.headerTip ? <Tooltip label={column.headerTip}>{trigger}</Tooltip> : trigger
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }): ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${active ? 'opacity-100' : 'opacity-30'} ${
        active && dir === 'asc' ? 'rotate-180' : ''
      }`}
    >
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FilterIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-text-faint">
      <path d="M2 3h12M4.5 8h7M6.5 13h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
