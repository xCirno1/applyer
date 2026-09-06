import { useEffect, type ReactElement } from 'react'
import type { JobRecord, JobStatus } from '@shared/types/job'
import { useJobsStore } from '../../state/jobsStore'
import KanbanColumn from './KanbanColumn'
import BoardFilters from './BoardFilters'
import BulkActionBar from './BulkActionBar'

// The four-column board (Queued/Filled/Submitted/Failed), horizontally
// scrolling. Which job's detail modal is open lives in `jobsStore`
// (`openJobId`/`activeJob`/`openJob`/`closeJob`) rather than local state, so
// `PipelineOverview` and Indexed Jobs rows can open the same modal too —
// this component no longer mounts `JobDetailModal` itself (see `App.tsx`'s
// `MainShell`, which mounts it once at the top level instead).

const COLUMNS: JobStatus[] = ['queued', 'filled', 'submitted', 'failed']

export default function KanbanBoard(): ReactElement {
  const subscribeToUpdates = useJobsStore((s) => s.subscribeToUpdates)
  const openJob = useJobsStore((s) => s.openJob)

  useEffect(() => subscribeToUpdates(), [subscribeToUpdates])

  return (
    <div className="flex h-full flex-col">
      <BoardFilters />
      <BulkActionBar />
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {COLUMNS.map((status) => (
          <KanbanColumn key={status} status={status} onOpenJob={(job: JobRecord) => openJob(job.id)} />
        ))}
      </div>
    </div>
  )
}
