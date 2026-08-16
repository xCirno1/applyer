import { useEffect, useState, type ReactElement } from 'react'
import type { JobRecord, JobStatus } from '@shared/types/job'
import { useJobsStore } from '../../state/jobsStore'
import KanbanColumn from './KanbanColumn'
import JobDetailModal from './JobDetailModal'
import BoardFilters from './BoardFilters'

const COLUMNS: JobStatus[] = ['queued', 'filled', 'submitted', 'failed']

export default function KanbanBoard(): ReactElement {
  const subscribeToUpdates = useJobsStore((s) => s.subscribeToUpdates)
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  // Re-derived from the store on every change so the modal always reflects
  // live state (e.g. the agent flagging this job as failed while it's open).
  const openJob = useJobsStore((s) =>
    openJobId
      ? (Object.values(s.columns)
          .flatMap((c) => c.jobs)
          .find((j) => j.id === openJobId) ?? null)
      : null
  )

  useEffect(() => subscribeToUpdates(), [subscribeToUpdates])

  return (
    <div className="flex h-full flex-col">
      <BoardFilters />
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {COLUMNS.map((status) => (
          <KanbanColumn key={status} status={status} onOpenJob={(job: JobRecord) => setOpenJobId(job.id)} />
        ))}
      </div>
      <JobDetailModal job={openJob} onClose={() => setOpenJobId(null)} />
    </div>
  )
}
