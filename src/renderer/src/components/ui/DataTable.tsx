import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from './Tooltip'
import { isMacPlatform } from '../../shortcuts/keyCombo'
import { isNarrowedEmpty } from './dataTable'
import type { SortDir } from './dataTable'
import type { SelectionModifiers } from './rowSelection'

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
  /** Shown instead of emptyMessage when rows is empty and something is narrowing the list (see `narrowed`). */
  noMatchMessage?: ReactNode
  /**
   * Whether anything is currently narrowing `rows`, when the filter box is
   * not the whole story.
   *
   * Left unset, an empty table is read as "nothing matched" only if the
   * filter box has text in it, which is right for a table whose only filter
   * is that box and wrong for one with `toolbar` dropdowns the caller applies
   * itself: picking a provider with no boards on it would otherwise report
   * that nothing is tracked at all, which is a different and false statement.
   * Callers that narrow rows outside the box pass their own answer.
   */
  narrowed?: boolean
  /**
   * Makes the whole row clickable (drill-in, opening a detail modal, or
   * selecting it). Clicks that land on a link, button or form control inside
   * the row are ignored (see `isInteractiveTarget`), so a table can have both
   * a row action and cells that do something else without one swallowing the
   * other.
   *
   * Supplying this also makes rows keyboard-operable (Enter/Space). The
   * modifiers come through resolved, so a multi-select caller can hand them
   * straight to `rowSelection.ts` without knowing the platform.
   */
  onRowClick?: (row: T, modifiers: SelectionModifiers) => void
  /**
   * Marks the table as a multi-select list: every row reserves the gutter the
   * selected marker paints, and Shift+click extends the row selection instead
   * of the browser's text selection. Cell text stays selectable and copyable
   * either way.
   */
  selectable?: boolean
  /** Paints a row as selected. Only meaningful with `selectable`. */
  isRowSelected?: (row: T) => boolean
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

/**
 * Whether the click that just finished was the end of a drag across this
 * row's text.
 *
 * Rows in a selectable table stay selectable *text*, because copying a slug
 * or an error message out of a cell is a normal thing to want. The cost is
 * that finishing a text drag also fires a click, which would otherwise change
 * the row selection out from under the copy; a non-collapsed selection
 * anchored inside this row is what tells the two apart.
 */
function endedTextSelection(row: EventTarget | null): boolean {
  if (!(row instanceof Element)) return false
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.toString().trim() === '') return false
  return row.contains(selection.anchorNode)
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
  narrowed,
  onRowClick,
  selectable = false,
  isRowSelected,
  rowClassName
}: DataTableProps<T>): ReactElement {
  const { t } = useTranslation()
  const hasFilterBar = filterValue !== undefined && onFilterChange !== undefined
  const isNarrowed = isNarrowedEmpty(narrowed, hasFilterBar, filterValue)

  const modifiersOf = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): SelectionModifiers => ({
    shiftKey: event.shiftKey,
    modKey: isMacPlatform() ? event.metaKey : event.ctrlKey
  })

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
          {isNarrowed ? (noMatchMessage ?? emptyMessage) : emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full text-[12px]"
            aria-multiselectable={selectable || undefined}
            style={{ minWidth: minWidthPx }}
          >
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
              {rows.map((row) => {
                const selected = Boolean(selectable && isRowSelected?.(row))
                return (
                  <tr
                    key={getRowKey(row)}
                    aria-selected={selectable ? selected : undefined}
                    onMouseDown={
                      onRowClick && selectable
                        ? (e) => {
                            // Shift+click extends the *row* selection, so the
                            // browser's own "extend the text selection to
                            // here" is suppressed for that one gesture —
                            // rather than turning off text selection for the
                            // whole table, which would take copying with it.
                            // Focus is restored by hand, since preventing the
                            // default also prevents that.
                            if (!e.shiftKey || isInteractiveTarget(e.target)) return
                            e.preventDefault()
                            e.currentTarget.focus()
                          }
                        : undefined
                    }
                    onClick={
                      onRowClick
                        ? (e) => {
                            if (isInteractiveTarget(e.target)) return
                            if (endedTextSelection(e.currentTarget)) return
                            onRowClick(row, modifiersOf(e))
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
                            onRowClick(row, modifiersOf(e))
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    // The left border is on every row, not just the selected
                    // ones, so marking a row doesn't shift its cells sideways.
                    className={`border-b border-border-soft transition-colors last:border-0 hover:bg-canvas-raised ${
                      onRowClick ? 'cursor-pointer focus:outline-none focus-visible:bg-canvas-raised' : ''
                    } ${selectable ? 'border-l-2' : ''} ${
                      selected ? 'border-l-accent bg-canvas-soft' : selectable ? 'border-l-transparent' : ''
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
                )
              })}
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
