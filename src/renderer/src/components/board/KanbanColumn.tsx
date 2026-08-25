import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobRecord, JobStatus } from '@shared/types/job'
import { useJobsStore } from '../../state/jobsStore'
import JobCard from './JobCard'
import Skeleton from '../ui/Skeleton'
import Button from '../ui/Button'

export default function KanbanColumn({
  status,
  onOpenJob
}: {
  status: JobStatus
  onOpenJob: (job: JobRecord) => void
}): ReactElement {
  const { t } = useTranslation('board')
  const column = useJobsStore((s) => s.columns[status])
  const fetchColumn = useJobsStore((s) => s.fetchColumn)
  const loadMore = useJobsStore((s) => s.loadMore)

  useEffect(() => {
    fetchColumn(status)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-border-soft">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border-soft px-2">
        <span className="text-[12px] font-medium text-text">{t(`status.${status}`)}</span>
        <span className="text-[11px] text-text-faint">{column.total}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {!column.loadedOnce && (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}
        {column.loadedOnce && column.jobs.length === 0 && (
          <p className="p-2 text-[11px] text-text-faint">{t('column.empty')}</p>
        )}
        <div className="flex flex-col gap-1.5">
          {column.jobs.map((job) => (
            <JobCard key={job.id} job={job} onOpen={() => onOpenJob(job)} />
          ))}
        </div>
        {column.loadedOnce && column.jobs.length < column.total && (
          <div className="mt-1.5 flex justify-center">
            <Button size="sm" variant="ghost" loading={column.loading} onClick={() => loadMore(status)}>
              {t('actions.loadMore', { ns: 'common' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
