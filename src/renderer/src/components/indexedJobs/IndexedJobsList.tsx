import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { INDEXED_JOBS_PAGE_SIZE_OPTIONS, useIndexedJobsStore } from '../../state/indexedJobsStore'
import IndexedJobRow from './IndexedJobRow'
import Skeleton from '../ui/Skeleton'
import Pagination from '../ui/Pagination'
import Dropdown from '../ui/Dropdown'

// The "Indexed" tab's body: every job a `search_jobs` call has surfaced
// (matched or not — see `indexedJobsRepository.listIndexedJobs`), independent
// of the board's queued/filled/submitted/failed columns, which only ever hold
// jobs the agent chose to queue. Server-paged (`indexedJobsStore.page`/
// `setPage`), not "Load more" — the opposite tradeoff from the client-paged
// `CompanyBoardsPanel` table, since this list has no ceiling the way
// `MAX_COMPANY_BOARDS` bounds that one. Live-updated via `indexedJobs:changed`
// (`subscribeToChanges`), which re-fetches the current page in place and lands
// on the new last page if pruning shrank the total out from under it.
//
// A rows-per-page `Dropdown` sits beside `Pagination` in the footer
// (`indexedJobsStore.pageSize`/`setPageSize`, options from
// `INDEXED_JOBS_PAGE_SIZE_OPTIONS`, capped server-side at
// `LIST_INDEXED_JOBS_MAX_LIMIT`); changing it re-fetches at the new
// limit/offset and resets to page 1, the same shape as `CompanyBoardsPanel`'s
// own rows-per-page control. Matched rows are clickable and open the same
// `JobDetailModal` as the board, via `jobsStore.openJob(matchedJobId)` (inside
// `IndexedJobRow`).
export default function IndexedJobsList(): ReactElement {
  const { t } = useTranslation('indexedJobs')
  const items = useIndexedJobsStore((s) => s.items)
  const total = useIndexedJobsStore((s) => s.total)
  const page = useIndexedJobsStore((s) => s.page)
  const pageSize = useIndexedJobsStore((s) => s.pageSize)
  const loading = useIndexedJobsStore((s) => s.loading)
  const loadedOnce = useIndexedJobsStore((s) => s.loadedOnce)
  const compact = useIndexedJobsStore((s) => s.compact)
  const fetchItems = useIndexedJobsStore((s) => s.fetch)
  const setPage = useIndexedJobsStore((s) => s.setPage)
  const setPageSize = useIndexedJobsStore((s) => s.setPageSize)
  const subscribeToChanges = useIndexedJobsStore((s) => s.subscribeToChanges)

  useEffect(() => {
    fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => subscribeToChanges(), [subscribeToChanges])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const skeletonHeight = compact ? 'h-7' : 'h-24'
  // Compact stays a single column of thin table-like rows; the fuller card
  // view uses the width instead of stacking everything into one narrow,
  // mostly-empty column.
  const itemsClassName = compact
    ? 'flex flex-col gap-1.5'
    : 'grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!loadedOnce && (
          <div className={itemsClassName}>
            <Skeleton className={`${skeletonHeight} w-full`} />
            <Skeleton className={`${skeletonHeight} w-full`} />
            <Skeleton className={`${skeletonHeight} w-full`} />
          </div>
        )}
        {loadedOnce && items.length === 0 && (
          <p className="p-2 text-[12px] text-text-faint">
            {t('list.empty')}
          </p>
        )}
        <div className={itemsClassName}>
          {items.map((item) => (
            <IndexedJobRow key={item.id} item={item} compact={compact} />
          ))}
        </div>
      </div>
      {loadedOnce && total > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border-soft px-2 py-1.5">
          <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
            {t('list.count', { count: total })}
          </span>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={loading} />
          {/* Beside the page numbers rather than up in the filter strip: it
              changes how the pages are cut, not which rows qualify. */}
          <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-faint">
            {t('list.rowsPerPage')}
            <Dropdown
              size="sm"
              className="w-16"
              ariaLabel={t('list.rowsPerPage')}
              options={INDEXED_JOBS_PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: String(size) }))}
              value={String(pageSize)}
              onChange={(value) => setPageSize(Number(value))}
              disabled={loading}
            />
          </label>
        </div>
      )}
    </div>
  )
}
