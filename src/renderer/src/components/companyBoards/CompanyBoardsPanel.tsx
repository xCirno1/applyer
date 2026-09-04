import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import TextField from '../ui/TextField'
import ConfirmDialog from '../ui/ConfirmDialog'
import DataTable from '../ui/DataTable'
import Dropdown from '../ui/Dropdown'
import Pagination from '../ui/Pagination'
import Skeleton from '../ui/Skeleton'
import Tooltip from '../ui/Tooltip'
import { useSortableTable } from '../ui/useSortableTable'
import BoardBulkActionBar from './BoardBulkActionBar'
import BoardCsvImportModal from './BoardCsvImportModal'
import { BOARD_SEARCH_KEYS, BOARD_TABLE_VALUES, PROVIDER_LABELS, useBoardColumns } from './boardColumns'
import { boardFilterStatus, type BoardFilterStatus } from './boardStatus'
import { useToast } from '../ui/useToast'
import { EMPTY_SELECTION, nextRowSelection, type RowSelection, type SelectionModifiers } from '../ui/rowSelection'
import { useErrorMessage } from '../../i18n/formatError'
import { MAX_COMPANY_BOARDS } from '@shared/constants'
import { ATS_PROVIDERS, type BoardFetchOutcome, type CompanyBoardRecord } from '@shared/types/companyBoard'

/**
 * Rows per page, and what the footer offers. Display only: the whole
 * watchlist is already in memory, so this changes how much of it is on screen
 * and nothing else — which is why a large option is offered at all.
 */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const DEFAULT_PAGE_SIZE = 20

/** The "not filtering" option value for both dropdowns. */
const ALL = 'all'

/**
 * The companies whose own ATS board is searched.
 *
 * Greenhouse/Lever/Ashby/Workday have no cross-company search endpoint, so
 * this list *is* the coverage of those sources — which is why it lives on the
 * Job Discovery page next to the search history it feeds, rather than in
 * Settings. Adding one is a network round trip (the app probes the providers
 * to work out which board a company is on), so the add button spins and
 * disables rather than resolving silently.
 *
 * The list is a `DataTable`. Sorting and the filter box come from
 * `useSortableTable`; the provider and status dropdowns are applied here,
 * before the rows reach the hook, since `DataTable` itself owns no state.
 *
 * All of it runs over the *whole* watchlist, which is read in one call and
 * paginated here for display only. That is affordable because
 * `MAX_COMPANY_BOARDS` bounds this table by construction, and it is what
 * makes the table honest: a sort orders every tracked board rather than the
 * pages that happened to be loaded, a filter counts every match, and a page
 * number means the same thing twice in a row. The Indexed tab next door keeps
 * server-side paging for the opposite reason — its list has no ceiling.
 */
export default function CompanyBoardsPanel(): ReactElement {
  const [boards, setBoards] = useState<CompanyBoardRecord[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [query, setQuery] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adding, setAdding] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<CompanyBoardRecord | null>(null)
  const [removing, setRemoving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  // Boards with a manual fetch in flight. A set, not one id: a bulk fetch has
  // every selected row spinning at once.
  const [fetchingIds, setFetchingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [selection, setSelection] = useState<RowSelection>(EMPTY_SELECTION)
  const [provider, setProvider] = useState<string>(ALL)
  const [status, setStatus] = useState<string>(ALL)
  const { t } = useTranslation('indexedJobs')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  /**
   * The whole watchlist in one read, which is what makes the sort, both
   * filters and the page numbers below describe the real list rather than
   * whichever pages had been fetched so far. Affordable here and nowhere else
   * on this page: `MAX_COMPANY_BOARDS` bounds this table at a few hundred
   * short rows by construction, where indexed jobs grows without limit and so
   * stays server-paginated.
   */
  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.companyBoards.list({ limit: MAX_COMPANY_BOARDS, offset: 0 })
      setBoards(result.boards)
      setLoadFailed(false)
    } catch (err) {
      // The read can fail for real — an unavailable or corrupted database —
      // and an unhandled rejection here used to leave the panel on its
      // skeleton forever with nothing said. The list is left as it was and
      // the failure is shown with a way out.
      console.error('Failed to load company boards', err)
      setLoadFailed(true)
    } finally {
      setLoadedOnce(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.companyBoards
      .list({ limit: MAX_COMPANY_BOARDS, offset: 0 })
      .then((result) => {
        if (cancelled) return
        setBoards(result.boards)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('Failed to load company boards', err)
        setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoadedOnce(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // This panel stays mounted-but-hidden while another tab is showing, so
  // without this a board the agent added via `add_company_board` would never
  // appear here.
  useEffect(() => window.api.companyBoards.onChanged(() => load()), [load])

  // A fetch of many boards runs several at a time and reports each one as it
  // lands, so a row stops spinning and shows its new count the moment that
  // board answers — rather than the whole selection waiting on the slowest
  // member. One row is replaced in place, since the whole list is already
  // here; re-reading it per board would be a query each time.
  useEffect(
    () =>
      window.api.companyBoards.onFetched(({ board }) => {
        if (!board) return
        setBoards((prev) => prev.map((existing) => (existing.id === board.id ? board : existing)))
        setFetchingIds((prev) => {
          if (!prev.has(board.id)) return prev
          const next = new Set(prev)
          next.delete(board.id)
          return next
        })
      }),
    []
  )

  const handleAdd = async (): Promise<void> => {
    const trimmed = query.trim()
    if (!trimmed || adding) return

    setAdding(true)
    try {
      const result = await window.api.companyBoards.add(trimmed, displayName.trim() || undefined)
      if (!result.ok) {
        toast.error(errorMessage(result.error))
        return
      }

      setQuery('')
      setDisplayName('')

      if (result.status === 'already_tracked') {
        toast.info(t('boards.alreadyTracked', { company: result.board.companyName }))
      } else if (!result.verified) {
        // Stored, but nobody has confirmed it exists yet — saying "added"
        // flat out would be claiming more than we know.
        toast.info(t('boards.addedUnverified', { company: result.board.companyName }))
      } else if (result.jobCount === 0) {
        // A live board with nothing open answers exactly like this, so it is
        // reported as an empty board rather than as a failure.
        toast.success(t('boards.addedEmpty', { company: result.board.companyName }))
      } else {
        toast.success(t('boards.added', { company: result.board.companyName, count: result.jobCount }))
      }

      // A company answering on two ATS providers at once is a migration in
      // progress; the busier board was kept, and the user is told rather than
      // left wondering why the other one isn't listed.
      if (result.ambiguous) {
        const others = result.candidates
          .filter((c) => c.jobCount > 0 && c.provider !== result.board.provider)
          .map((c) => `${c.provider} (${c.jobCount})`)
          .join(', ')
        if (others) toast.info(t('boards.ambiguous', { provider: result.board.provider, others }))
      }

      load()
    } finally {
      setAdding(false)
    }
  }

  // Stable identities: the column definitions are memoised on these, so a
  // handler rebuilt every render would rebuild every cell renderer with it.
  const handleToggle = useCallback(
    async (board: CompanyBoardRecord): Promise<void> => {
      setTogglingId(board.id)
      try {
        const result = await window.api.companyBoards.setEnabled(board.id, !board.enabled)
        if (result.ok && result.board) {
          const updated = result.board
          setBoards((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
        } else {
          toast.error(result.error ? errorMessage(result.error) : t('boards.toggleFailed'))
        }
      } finally {
        setTogglingId(null)
      }
    },
    [toast, errorMessage, t]
  )

  const handleRemove = async (): Promise<void> => {
    if (!pendingRemove) return
    setRemoving(true)
    try {
      const result = await window.api.companyBoards.remove(pendingRemove.id)
      if (!result.ok) {
        toast.error(t('boards.removeFailed'))
        return
      }
      setBoards((prev) => prev.filter((b) => b.id !== pendingRemove.id))
      toast.success(t('boards.removed', { company: pendingRemove.companyName }))
    } finally {
      setRemoving(false)
      setPendingRemove(null)
    }
  }

  /**
   * Says what a fetch came back with, at whichever scale it ran.
   *
   * One board gets the same three-way answer adding one does — roles, a live
   * board with nothing open, or a failure — because that distinction is the
   * whole point of checking. A batch gets a total plus, separately, how many
   * boards could not be reached: burying "12 failed" inside a success line is
   * how a watchlist quietly rots.
   */
  const reportFetch = useCallback(
    (results: BoardFetchOutcome[]): void => {
      if (results.length === 0) return

      const [only] = results
      if (results.length === 1 && only) {
        if (only.status === 'not_found') {
          toast.error(t('boards.fetchNotFound', { company: only.companyName }))
        } else if (only.status === 'error') {
          toast.error(t('boards.fetchFailed', { company: only.companyName, message: only.message ?? '' }))
        } else if (only.jobCount === 0) {
          toast.info(t('boards.fetchedEmpty', { company: only.companyName }))
        } else {
          toast.success(t('boards.fetchedOne', { company: only.companyName, count: only.jobCount }))
        }
        return
      }

      const failed = results.filter((result) => result.status !== 'ok')
      const checked = results.length - failed.length
      const roles = results.reduce((total, result) => total + result.jobCount, 0)

      if (checked === 0) {
        toast.error(t('boards.fetchedAllFailed', { count: failed.length }))
        return
      }
      const summary = t('boards.fetchedMany', { count: checked, roles })
      if (failed.length > 0) toast.info(`${summary} ${t('boards.fetchedSomeFailed', { count: failed.length })}`)
      else toast.success(summary)
    },
    [toast, t]
  )

  const handleFetch = useCallback(
    async (ids: string[]): Promise<void> => {
      if (ids.length === 0) return
      setFetchingIds((prev) => new Set([...prev, ...ids]))
      try {
        const result = await window.api.companyBoards.fetch(ids)
        if (!result.ok) {
          toast.error(errorMessage(result.error))
          return
        }
        // The rows themselves refresh through `companyBoards:changed`, which
        // the fetch broadcasts — the same path a search's updates arrive on.
        reportFetch(result.results)
      } finally {
        setFetchingIds((prev) => {
          const next = new Set(prev)
          for (const id of ids) next.delete(id)
          return next
        })
      }
    },
    [toast, errorMessage, reportFetch]
  )

  const handleFetchRow = useCallback(
    (board: CompanyBoardRecord): void => {
      void handleFetch([board.id])
    },
    [handleFetch]
  )

  const handleSetEnabledMany = useCallback(
    async (ids: string[], enabled: boolean): Promise<void> => {
      if (ids.length === 0) return
      const result = await window.api.companyBoards.setEnabledMany(ids, enabled)
      if (!result.ok) {
        toast.error(result.error ? errorMessage(result.error) : t('boards.toggleFailed'))
        return
      }
      toast.success(
        enabled
          ? t('boards.selection.resumed', { count: result.updated ?? ids.length })
          : t('boards.selection.paused', { count: result.updated ?? ids.length })
      )
    },
    [toast, errorMessage, t]
  )

  const handleRemoveMany = useCallback(
    async (ids: string[]): Promise<void> => {
      if (ids.length === 0) return
      const result = await window.api.companyBoards.removeMany(ids)
      if (!result.ok) {
        toast.error(result.error ? errorMessage(result.error) : t('boards.removeFailed'))
        return
      }
      toast.success(t('boards.selection.removed', { count: result.removed ?? ids.length }))
    },
    [toast, errorMessage, t]
  )

  const columns = useBoardColumns({
    togglingId,
    fetchingIds,
    onToggle: handleToggle,
    onFetch: handleFetchRow,
    onRemove: setPendingRemove
  })

  // The two dropdowns narrow the rows before the table's own filter box and
  // sort see them, which is the split `DataTable` asks for: it renders
  // controls, the caller decides what a row has to satisfy.
  const selected = useMemo(
    () =>
      boards.filter(
        (board) =>
          (provider === ALL || board.provider === provider) &&
          (status === ALL || boardFilterStatus(board) === status)
      ),
    [boards, provider, status]
  )

  const table = useSortableTable(selected, { values: BOARD_TABLE_VALUES, searchKeys: BOARD_SEARCH_KEYS })
  const narrowed = table.filtered || provider !== ALL || status !== ALL

  // Page numbers are derived, never stored past the row count they were
  // valid for: deleting the last row of the last page has to land somewhere
  // real, and clamping here does that without an effect writing state back.
  const totalPages = Math.max(1, Math.ceil(table.rows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => table.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [table.rows, currentPage, pageSize]
  )

  // Ranges span the whole filtered list, not the current page. Paging is a
  // window onto one list, so anchoring on page 1 and Shift-clicking on page 2
  // has to select everything between — scoping the range to the page instead
  // silently threw the anchor away the moment the page changed, which is not
  // something the person did.
  const visibleOrder = useMemo(() => table.rows.map((board) => board.id), [table.rows])
  // Selected rows are kept as ids and intersected with the filtered ones here
  // rather than pruned on every filter change, so narrowing the list and
  // widening it again doesn't silently drop rows — while a bulk action can
  // still only ever touch a board the current filters admit.
  const selectedBoards = useMemo(
    () => table.rows.filter((board) => selection.selected.has(board.id)),
    [table.rows, selection]
  )

  // Any narrowing resets to the first page: page 4 of a list that now has one
  // page would otherwise show an empty table.
  const onFilterChange = table.onFilterChange
  const handleFilterChange = useCallback(
    (value: string): void => {
      setPage(1)
      onFilterChange(value)
    },
    [onFilterChange]
  )

  const handleProviderChange = useCallback((value: string): void => {
    setPage(1)
    setProvider(value)
  }, [])

  const handleStatusChange = useCallback((value: string): void => {
    setPage(1)
    setStatus(value)
  }, [])

  // Back to the first page, since the row that was at the top of page 3 of 20
  // is somewhere else entirely once pages hold 100.
  const handlePageSizeChange = useCallback((value: string): void => {
    const parsed = Number(value)
    setPageSize(PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number]) ? parsed : DEFAULT_PAGE_SIZE)
    setPage(1)
  }, [])

  const handleRowClick = useCallback(
    (board: CompanyBoardRecord, modifiers: SelectionModifiers): void => {
      setSelection((prev) => nextRowSelection(visibleOrder, prev, board.id, modifiers))
    },
    [visibleOrder]
  )

  const clearSelection = useCallback(() => setSelection(EMPTY_SELECTION), [])

  const statusOptions: { value: BoardFilterStatus | typeof ALL; label: string }[] = [
    { value: ALL, label: t('boards.filterAllStatuses') },
    { value: 'open', label: t('boards.statusOpen') },
    { value: 'empty', label: t('boards.statusEmpty') },
    { value: 'error', label: t('boards.statusError') },
    // Covers both boards with nothing to show: never searched, and searched
    // by a query that could not count the board (see `boardStatus`).
    { value: 'unchecked', label: t('boards.statusNoResult') },
    { value: 'paused', label: t('boards.statusPaused') }
  ]

  return (
    <div className="flex flex-col gap-4 p-3">
      <p className="text-[13px] text-text-muted">
        <Tooltip label={t('boards.atsTooltip')}>
          <span className="cursor-help underline decoration-dotted underline-offset-2">{t('boards.ats')}</span>
        </Tooltip>{' '}
        {t('boards.intro')}
      </p>

      {/* No field carries a hint of its own: a hint under one of them makes
          that field taller than its neighbours, and `items-end` then hangs
          the shorter ones off its bottom edge instead of lining the inputs
          up. The guidance is about the whole form anyway, so it sits under
          the whole row. */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <TextField
              label={t('boards.queryLabel')}
              placeholder={t('boards.queryPlaceholder')}
              value={query}
              disabled={adding}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
              }}
            />
          </div>
          <div className="w-48">
            <TextField
              label={t('boards.nameLabel')}
              placeholder={t('boards.namePlaceholder')}
              value={displayName}
              disabled={adding}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
              }}
            />
          </div>
          <Button onClick={handleAdd} loading={adding} disabled={!query.trim()}>
            {t('boards.add')}
          </Button>
          {/* Bulk-add sits beside the single-company form rather than in
              Settings: it fills the same list, and the list is this page. */}
          <Tooltip label={t('boards.csv.openTooltip')}>
            <Button variant="secondary" onClick={() => setCsvOpen(true)} disabled={adding}>
              {t('boards.csv.open')}
            </Button>
          </Tooltip>
        </div>
        <p className="text-[11px] text-text-faint">{t('boards.queryHint')}</p>
      </div>

      <BoardBulkActionBar
        boards={selectedBoards}
        onClear={clearSelection}
        onFetch={handleFetch}
        onSetEnabled={handleSetEnabledMany}
        onRemove={handleRemoveMany}
      />

      {/* A refresh that failed while rows are already on screen: they are
          still the last thing we truly read, so they stay, labelled as
          possibly stale rather than silently presented as current. */}
      {loadFailed && boards.length > 0 && (
        <div className="flex items-center justify-between gap-2 border border-danger px-3 py-1.5">
          <span className="text-[11px] text-danger">{t('boards.refreshFailed')}</span>
          <Button size="sm" variant="ghost" onClick={() => load()}>
            {t('actions.retry', { ns: 'common' })}
          </Button>
        </div>
      )}

      <div className="border border-border">
        {!loadedOnce ? (
          <div className="flex flex-col gap-1.5 p-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : loadFailed && boards.length === 0 ? (
          // A failed read with nothing to fall back on: the table would be an
          // empty list claiming nothing is tracked, which is a different
          // statement from "we could not find out".
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <p className="text-[12px] text-danger">{t('boards.loadFailed')}</p>
            <Button size="sm" variant="secondary" onClick={() => load()}>
              {t('actions.retry', { ns: 'common' })}
            </Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(board) => board.id}
            emptyMessage={t('boards.empty')}
            noMatchMessage={t('boards.noMatches')}
            // Two of the three filters live in the toolbar and are applied
            // here, so the filter box alone cannot tell an empty table
            // "nothing is tracked" from "nothing is on Ashby".
            narrowed={narrowed}
            minWidthPx={860}
            selectable
            isRowSelected={(board) => selection.selected.has(board.id)}
            onRowClick={handleRowClick}
            sortKey={table.sortKey}
            sortDir={table.sortDir}
            onSort={table.onSort}
            filterValue={table.filterValue}
            onFilterChange={handleFilterChange}
            filterPlaceholder={t('boards.filterPlaceholder')}
            rowClassName={(board) => (board.enabled ? '' : 'opacity-60')}
            toolbar={
              <>
                <Dropdown
                  size="sm"
                  className="w-32"
                  ariaLabel={t('boards.filterProvider')}
                  options={[
                    { value: ALL, label: t('boards.filterAllProviders') },
                    ...ATS_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))
                  ]}
                  value={provider}
                  onChange={handleProviderChange}
                />
                <Dropdown
                  size="sm"
                  className="w-44"
                  ariaLabel={t('boards.filterStatus')}
                  options={statusOptions}
                  value={status}
                  onChange={handleStatusChange}
                />
              </>
            }
          />
        )}

        {loadedOnce && boards.length > 0 && (
          // The count is the whole watchlist, not "what has been loaded so
          // far": every board is already here, so the filters and the page
          // numbers beside it describe the real list.
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft px-3 py-1.5">
            <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
              {narrowed
                ? t('boards.countFiltered', { visible: table.rows.length, total: boards.length })
                : t('boards.countAll', { count: boards.length })}
            </span>
            <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
            {/* Beside the page numbers rather than up in the filter strip:
                it changes how the pages are cut, not which rows qualify. */}
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-faint">
              {t('boards.rowsPerPage')}
              <Dropdown
                size="sm"
                className="w-16"
                ariaLabel={t('boards.rowsPerPage')}
                options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: String(size) }))}
                value={String(pageSize)}
                onChange={handlePageSizeChange}
              />
            </label>
          </div>
        )}
      </div>

      {/* The import broadcasts `companyBoards:changed`, so the list above
          refreshes through the same path an agent's add does. */}
      <BoardCsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />

      <ConfirmDialog
        open={pendingRemove !== null}
        title={t('boards.removeTitle')}
        message={t('boards.removeMessage', { company: pendingRemove?.companyName ?? '' })}
        confirmLabel={t('boards.remove')}
        danger
        loading={removing}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  )
}
