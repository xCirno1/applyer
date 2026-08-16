import type { ReactElement } from 'react'
import type { JobRecord, JobStatus } from '@shared/types/job'
import Tag from '../ui/Tag'
import { useBlockedJobIds } from '../../providers/CaptchaAlertContext'

const STATUS_ACCENT: Record<JobStatus, string> = {
  queued: 'border-l-accent',
  filled: 'border-l-warning',
  submitted: 'border-l-success',
  failed: 'border-l-danger'
}

export default function JobCard({ job, onOpen }: { job: JobRecord; onOpen: () => void }): ReactElement {
  const blockedJobIds = useBlockedJobIds()
  const blocked = blockedJobIds.has(job.id)

  return (
    <button
      onClick={onOpen}
      className={`flex w-full cursor-pointer flex-col gap-1 border border-border-soft border-l-2 bg-canvas-raised px-2 py-1.5 text-left hover:border-border ${STATUS_ACCENT[job.status]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium leading-tight text-text">{job.title}</span>
        {job.matchScore !== null && (
          <span className="shrink-0 text-[11px] tabular-nums text-text-faint">{job.matchScore}%</span>
        )}
      </div>
      <span className="text-[11px] text-text-muted">{job.company}</span>
      {job.location && <span className="text-[11px] text-text-faint">{job.location}</span>}
      {blocked && (
        <div className="mt-0.5">
          <Tag label="needs verification" tone="warning" />
        </div>
      )}
      {job.failureTag && (
        <div className="mt-0.5">
          <Tag label={job.failureTag.replace(/_/g, ' ')} tone="danger" />
        </div>
      )}
    </button>
  )
}
