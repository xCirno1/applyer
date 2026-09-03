import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import TextField from '../ui/TextField'
import ConfirmDialog from '../ui/ConfirmDialog'
import DataTable from '../ui/DataTable'
import Dropdown from '../ui/Dropdown'
import Skeleton from '../ui/Skeleton'
import Tooltip from '../ui/Tooltip'
import { useSortableTable } from '../ui/useSortableTable'
import { BOARD_SEARCH_KEYS, BOARD_TABLE_VALUES, PROVIDER_LABELS, useBoardColumns } from './boardColumns'
import { boardFilterStatus, type BoardFilterStatus } from './boardStatus'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { ATS_PROVIDERS, type CompanyBoardRecord } from '@shared/types/companyBoard'

const PAGE_SIZE = 20

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
 * before the rows reach the hook, since `DataTable` itself owns no state. All
 * of it runs over the pages fetched so far, which is why the footer says how
 * many of how many are on screen next to "Load more".
 */
export default function CompanyBoardsPanel(): ReactElement {
  const [boards, setBoards] = useState<CompanyBoardRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [query, setQuery] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adding, setAdding] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<CompanyBoardRecord | null>(null)
  const [removing, setRemoving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [provider, setProvider] = useState<string>(ALL)
  const [status, setStatus] = useState<string>(ALL)
  const { t } = useTranslation('indexedJobs')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  const load = useCallback(async (offset: number): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.api.companyBoards.list({ limit: PAGE_SIZE, offset })
      setBoards((prev) => (offset === 0 ? result.boards : [...prev, ...result.boards]))
      setTotal(result.total)
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
  }, [])

  // The first fetch is inlined rather than going through `load`, whose
  // synchronous `setLoading(true)` inside an effect body would cascade a
  // render — same shape as ExclusionsPanel's mount effect.
  useEffect(() => {
    let cancelled = false
    window.api.companyBoards.list({ limit: PAGE_SIZE, offset: 0 }).then((result) => {
      if (cancelled) return
      setBoards(result.boards)
      setTotal(result.total)
      setLoadedOnce(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // This panel stays mounted-but-hidden while another tab is showing, so
  // without this a board the agent added via `add_company_board` would never
  // appear here.
  useEffect(() => window.api.companyBoards.onChanged(() => load(0)), [load])

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

      load(0)
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
      setTotal((prev) => Math.max(0, prev - 1))
      toast.success(t('boards.removed', { company: pendingRemove.companyName }))
    } finally {
      setRemoving(false)
      setPendingRemove(null)
    }
  }

  const columns = useBoardColumns({ togglingId, onToggle: handleToggle, onRemove: setPendingRemove })

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

  const statusOptions: { value: BoardFilterStatus | typeof ALL; label: string }[] = [
    { value: ALL, label: t('boards.filterAllStatuses') },
    { value: 'open', label: t('boards.statusOpen') },
    { value: 'empty', label: t('boards.statusEmpty') },
    { value: 'error', label: t('boards.statusError') },
    { value: 'unchecked', label: t('boards.notCheckedYet') },
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

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label={t('boards.queryLabel')}
            placeholder={t('boards.queryPlaceholder')}
            hint={t('boards.queryHint')}
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
      </div>

      <div className="border border-border">
        {!loadedOnce ? (
          <div className="flex flex-col gap-1.5 p-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={table.rows}
            getRowKey={(board) => board.id}
            emptyMessage={t('boards.empty')}
            noMatchMessage={t('boards.noMatches')}
            minWidthPx={736}
            sortKey={table.sortKey}
            sortDir={table.sortDir}
            onSort={table.onSort}
            filterValue={table.filterValue}
            onFilterChange={table.onFilterChange}
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
                  onChange={setProvider}
                />
                <Dropdown
                  size="sm"
                  className="w-44"
                  ariaLabel={t('boards.filterStatus')}
                  options={statusOptions}
                  value={status}
                  onChange={setStatus}
                />
              </>
            }
          />
        )}

        {loadedOnce && boards.length > 0 && (
          // Search, filters and sort only ever see the pages fetched so far,
          // so the count is the honest scope of what was searched and sits
          // next to the button that widens it.
          <div className="flex items-center justify-between gap-2 border-t border-border-soft px-3 py-1.5">
            <span className="text-[11px] tabular-nums text-text-faint">
              {narrowed
                ? t('boards.showingFiltered', { visible: table.rows.length, loaded: boards.length, total })
                : t('boards.showingAll', { loaded: boards.length, total })}
            </span>
            {boards.length < total && (
              <Button size="sm" variant="ghost" loading={loading} onClick={() => load(boards.length)}>
                {t('actions.loadMore', { ns: 'common' })}
              </Button>
            )}
          </div>
        )}
      </div>

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
