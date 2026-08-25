import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Tag from '../ui/Tag'
import { useToast } from '../ui/useToast'
import { useJobsStore } from '../../state/jobsStore'
import { useErrorMessage } from '../../i18n/formatError'
import { useFormatters } from '../../i18n/format'
import type { JobRecord } from '@shared/types/job'
import type { ActivityLogEntry } from '@shared/types/activity'

export default function JobDetailModal({ job, onClose }: { job: JobRecord | null; onClose: () => void }): ReactElement | null {
  const { t } = useTranslation('board')
  const errorMessage = useErrorMessage()
  const format = useFormatters()
  const applyUpdate = useJobsStore((s) => s.applyUpdate)
  const removeJobLocal = useJobsStore((s) => s.removeJobLocal)
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [excluding, setExcluding] = useState(false)
  const [unqueueing, setUnqueueing] = useState(false)
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false)
  const [confirmExcludeOpen, setConfirmExcludeOpen] = useState(false)
  const [confirmUnqueueOpen, setConfirmUnqueueOpen] = useState(false)
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
      toast.success(t('toast.markedSubmitted'))
      onClose()
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('toast.markSubmittedFailed'))
    }
  }

  const handleRetry = async (): Promise<void> => {
    setRetrying(true)
    const result = await window.api.jobs.retry(job.id)
    setRetrying(false)
    if (result.ok && result.job) {
      applyUpdate(result.job)
      toast.success(t('toast.movedToQueued'))
      onClose()
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('toast.retrySingleFailed'))
    }
  }

  const handleExclude = async (): Promise<void> => {
    setConfirmExcludeOpen(false)
    setExcluding(true)
    const result = await window.api.jobs.exclude(job.id)
    setExcluding(false)
    if (result.ok) {
      removeJobLocal(job.id)
      toast.success(t('toast.excludedSingle'))
      onClose()
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('toast.excludeSingleFailed'))
    }
  }

  const handleUnqueue = async (): Promise<void> => {
    setConfirmUnqueueOpen(false)
    setUnqueueing(true)
    const result = await window.api.jobs.unqueue(job.id)
    setUnqueueing(false)
    if (result.ok) {
      removeJobLocal(job.id)
      toast.success(t('toast.unqueuedSingle'))
      onClose()
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('toast.unqueueSingleFailed'))
    }
  }

  return (
    <Modal open={!!job} onClose={onClose} title={job.title} width="max-w-xl">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
          <span className="font-medium text-text">{job.company}</span>
          {job.location && <span>· {job.location}</span>}
          {job.salaryRange && <span>· {job.salaryRange}</span>}
          {job.matchScore !== null && <span>· {t('detail.match', { score: job.matchScore })}</span>}
        </div>

        {job.failureTag && (
          <div className="flex items-center gap-2">
            <Tag label={job.failureTag.replace(/_/g, ' ')} tone="danger" />
            {job.failureMessage && <span className="text-[12px] text-text-muted">{job.failureMessage}</span>}
          </div>
        )}

        {job.matchReasons && job.matchReasons.length > 0 && (
          <div>
            <p className="text-[12px] font-medium text-text-muted">{t('detail.whyMatched')}</p>
            <ul className="mt-1 list-disc pl-4 text-[12px] text-text-muted">
              {job.matchReasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        {job.screenshotPath && (
          <div>
            <p className="text-[12px] font-medium text-text-muted">{t('detail.screenshot')}</p>
            <img
              src={`applyer-file://screenshots/${job.id}.png`}
              alt={t('detail.screenshotAlt')}
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
            <p className="text-[12px] font-medium text-text-muted">{t('detail.activity')}</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {activity.map((entry) => (
                <li key={entry.id} className="flex gap-2 text-[11px]">
                  <span className="shrink-0 text-text-faint">{format.time(entry.createdAt)}</span>
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
            {t('detail.openListing')}
          </a>
          <div className="flex gap-2">
            {job.status === 'queued' && (
              <Button size="sm" variant="secondary" onClick={() => setConfirmUnqueueOpen(true)} loading={unqueueing}>
                {t('actions.unqueue')}
              </Button>
            )}
            {job.status !== 'submitted' && (
              <Button size="sm" variant="danger" onClick={() => setConfirmExcludeOpen(true)} loading={excluding}>
                {t('actions.exclude')}
              </Button>
            )}
            {job.status === 'failed' && (
              <Button size="sm" onClick={handleRetry} loading={retrying}>
                {t('actions.retry')}
              </Button>
            )}
            {job.status === 'filled' && (
              <Button size="sm" variant="primary" onClick={() => setConfirmSubmitOpen(true)} loading={submitting}>
                {t('actions.markSubmitted')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSubmitOpen}
        title={t('confirm.markSubmittedTitle')}
        message={t('confirm.markSubmittedMessage')}
        confirmLabel={t('confirm.markSubmittedConfirm')}
        onConfirm={handleMarkSubmitted}
        onCancel={() => setConfirmSubmitOpen(false)}
      />

      <ConfirmDialog
        open={confirmExcludeOpen}
        title={t('confirm.excludeTitle', { count: 1 })}
        message={t('confirm.excludeMessage', { count: 1 })}
        confirmLabel={t('actions.exclude')}
        danger
        onConfirm={handleExclude}
        onCancel={() => setConfirmExcludeOpen(false)}
      />

      <ConfirmDialog
        open={confirmUnqueueOpen}
        title={t('confirm.unqueueTitle', { count: 1 })}
        message={t('confirm.unqueueMessage', { count: 1 })}
        confirmLabel={t('actions.unqueue')}
        onConfirm={handleUnqueue}
        onCancel={() => setConfirmUnqueueOpen(false)}
      />
    </Modal>
  )
}
