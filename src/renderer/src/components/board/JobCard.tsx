import type { ReactElement } from 'react'
import type { JobRecord, JobStatus } from '@shared/types/job'
import Tag from '../ui/Tag'
import { useBlockedJobIds } from '../../providers/CaptchaAlertContext'
import { useJobsStore } from '../../state/jobsStore'
import { useJobContextMenu } from './useJobContextMenu'

const STATUS_ACCENT: Record<JobStatus, string> = {
  queued: 'border-l-accent',
  filled: 'border-l-warning',
  submitted: 'border-l-success',
  failed: 'border-l-danger'
}

export default function JobCard({ job, onOpen }: { job: JobRecord; onOpen: () => void }): ReactElement {
  const blockedJobIds = useBlockedJobIds()
  const blocked = blockedJobIds.has(job.id)
  const selected = useJobsStore((s) => s.selectedJobIds.has(job.id))
  const hasSelection = useJobsStore((s) => s.selectedJobIds.size > 0)
  const toggleSelected = useJobsStore((s) => s.toggleSelected)
  const { openContextMenu, menuNode } = useJobContextMenu()

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      onContextMenu={(e) => openContextMenu(e, job, onOpen)}
      className={`group flex w-full cursor-pointer items-start gap-2 border border-border-soft border-l-2 px-2 py-1.5 text-left outline-none hover:border-border focus-visible:border-accent ${STATUS_ACCENT[job.status]} ${selected ? 'bg-canvas-soft' : 'bg-canvas-raised'}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggleSelected(job.id)
        }}
        aria-pressed={selected}
        aria-label={selected ? 'Deselect job' : 'Select job'}
        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center border ${
          selected ? 'border-accent bg-accent' : 'border-border bg-canvas-raised'
        } ${hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
      >
        {selected && <CheckIcon />}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
      </div>

      {menuNode}
    </div>
  )
}

function CheckIcon(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="text-accent-fg">
      <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
