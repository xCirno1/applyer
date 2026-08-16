import { useEffect, useState, type ReactElement } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Tag from '../ui/Tag'
import { useToast } from '../ui/useToast'
import { useJobsStore } from '../../state/jobsStore'
import type { JobRecord } from '@shared/types/job'
import type { ActivityLogEntry } from '@shared/types/activity'

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString()
}

export default function JobDetailModal({ job, onClose }: { job: JobRecord | null; onClose: () => void }): ReactElement | null {
  const applyUpdate = useJobsStore((s) => s.applyUpdate)
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false)
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])

  useEffect(() => {
    if (!job) return
    let cancelled = false
    window.api.logs.list({ jobId: job.id, limit: 20 }).then((result) => {
      if (!cancelled) setActivity(result.entries)
    })
    return () => {
      cancelled = true
    }
    // Intentionally keyed on job?.id only — job is re-derived live from the
    // store on every update, and re-fetching activity on every field change
    // (not just when a different job opens) would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id])

  if (!job) return null

  const handleMarkSubmitted = async (): Promise<void> => {
    setConfirmSubmitOpen(false)
    setSubmitting(true)
    const result = await window.api.jobs.markSubmitted(job.id)
    setSubmitting(false)
    if (result.ok && result.job) {
      applyUpdate(result.job)
      toast.success('Marked as submitted.')
      onClose()
    } else {
      toast.error(result.error ?? 'Failed to mark as submitted.')
    }
  }

  const handleRetry = async (): Promise<void> => {
    setRetrying(true)
    const result = await window.api.jobs.retry(job.id)
    setRetrying(false)
    if (result.ok && result.job) {
      applyUpdate(result.job)
      toast.success('Moved back to Queued.')
      onClose()
    } else {
      toast.error(result.error ?? 'Failed to retry.')
    }
  }

  return (
    <Modal open={!!job} onClose={onClose} title={job.title} width="max-w-xl">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
          <span className="font-medium text-text">{job.company}</span>
          {job.location && <span>· {job.location}</span>}
          {job.salaryRange && <span>· {job.salaryRange}</span>}
          {job.matchScore !== null && <span>· {job.matchScore}% match</span>}
        </div>

        {job.failureTag && (
          <div className="flex items-center gap-2">
            <Tag label={job.failureTag.replace(/_/g, ' ')} tone="danger" />
            {job.failureMessage && <span className="text-[12px] text-text-muted">{job.failureMessage}</span>}
          </div>
        )}

        {job.matchReasons && job.matchReasons.length > 0 && (
          <div>
            <p className="text-[12px] font-medium text-text-muted">Why it matched</p>
            <ul className="mt-1 list-disc pl-4 text-[12px] text-text-muted">
              {job.matchReasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        {job.screenshotPath && (
          <div>
            <p className="text-[12px] font-medium text-text-muted">Filled application (screenshot)</p>
            <img
              src={`applyer-file://screenshots/${job.id}.png`}
              alt="Screenshot of the filled application form"
              className="mt-1 max-h-64 w-full border border-border-soft object-contain object-top"
            />
          </div>
        )}

        {job.description && (
          <div
            className="max-h-64 overflow-y-auto border border-border-soft bg-canvas-soft p-2 text-[12px] text-text-muted [&_a]:text-accent [&_ul]:list-disc [&_ul]:pl-4"
            dangerouslySetInnerHTML={{ __html: job.description }}
          />
        )}

        {activity.length > 0 && (
          <div>
            <p className="text-[12px] font-medium text-text-muted">Activity</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {activity.map((entry) => (
                <li key={entry.id} className="flex gap-2 text-[11px]">
                  <span className="shrink-0 text-text-faint">{formatTime(entry.createdAt)}</span>
                  <span className={entry.level === 'error' ? 'text-danger' : entry.level === 'warn' ? 'text-warning' : 'text-text-muted'}>
                    {entry.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border-soft pt-3">
          <a
            href={job.applicationUrl ?? job.url}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-accent hover:underline"
          >
            Open original listing ↗
          </a>
          <div className="flex gap-2">
            {job.status === 'failed' && (
              <Button size="sm" onClick={handleRetry} loading={retrying}>
                Retry
              </Button>
            )}
            {job.status === 'filled' && (
              <Button size="sm" variant="primary" onClick={() => setConfirmSubmitOpen(true)} loading={submitting}>
                Mark Submitted
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSubmitOpen}
        title="Mark as submitted"
        message="Confirm you've actually submitted this application yourself — this action doesn't submit anything on your behalf, it just records that you did."
        confirmLabel="Mark submitted"
        onConfirm={handleMarkSubmitted}
        onCancel={() => setConfirmSubmitOpen(false)}
      />
    </Modal>
  )
}
