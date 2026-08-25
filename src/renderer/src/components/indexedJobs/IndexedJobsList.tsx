import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useIndexedJobsStore } from '../../state/indexedJobsStore'
import IndexedJobRow from './IndexedJobRow'
import Skeleton from '../ui/Skeleton'
import Pagination from '../ui/Pagination'
import { LIST_INDEXED_JOBS_DEFAULT_LIMIT } from '@shared/constants'

export default function IndexedJobsList(): ReactElement {
  const { t } = useTranslation('indexedJobs')
  const items = useIndexedJobsStore((s) => s.items)
  const total = useIndexedJobsStore((s) => s.total)
  const page = useIndexedJobsStore((s) => s.page)
  const loading = useIndexedJobsStore((s) => s.loading)
  const loadedOnce = useIndexedJobsStore((s) => s.loadedOnce)
  const compact = useIndexedJobsStore((s) => s.compact)
  const fetchItems = useIndexedJobsStore((s) => s.fetch)
  const setPage = useIndexedJobsStore((s) => s.setPage)
  const subscribeToChanges = useIndexedJobsStore((s) => s.subscribeToChanges)

  useEffect(() => {
    fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => subscribeToChanges(), [subscribeToChanges])

  const totalPages = Math.max(1, Math.ceil(total / LIST_INDEXED_JOBS_DEFAULT_LIMIT))
  const skeletonHeight = compact ? 'h-7' : 'h-16'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!loadedOnce && (
          <div className="flex flex-col gap-1.5">
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
        <div className="flex flex-col gap-1.5">
          {items.map((item) => (
            <IndexedJobRow key={item.id} item={item} compact={compact} />
          ))}
        </div>
      </div>
      {loadedOnce && totalPages > 1 && (
        <div className="flex shrink-0 justify-center border-t border-border-soft py-2">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={loading} />
        </div>
      )}
    </div>
  )
}
