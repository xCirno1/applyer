import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useJobsStore } from '../../state/jobsStore'
import { useJobActions } from './useJobActions'

/**
 * Appears above the board whenever one or more job cards are checked
 * (`jobsStore.selectedJobIds`) — the always-visible equivalent of the
 * Retry/Exclude actions each `JobCard`'s right-click menu also offers once
 * a selection exists (see `useJobContextMenu`). Retry only confirms when it
 * would touch more than one job at once, matching that menu's rule and
 * `JobDetailModal`'s existing single-job behavior; Exclude always confirms.
 */
export default function BulkActionBar(): ReactElement | null {
  const { t } = useTranslation('board')
  const selectedJobIds = useJobsStore((s) => s.selectedJobIds)
  const clearSelection = useJobsStore((s) => s.clearSelection)
  // Derived in the render body rather than inside the store selector — a
  // selector returning a fresh array/filter result on every call never
  // stabilizes for useSyncExternalStore's snapshot check, which crashes
  // React with "Maximum update depth exceeded" (error #185). `columns` and
  // `selectedJobIds` themselves are stable references, so recomputing this
  // per render is cheap and safe.
  const columns = useJobsStore((s) => s.columns)
  const selectedJobs = Object.values(columns)
    .flatMap((c) => c.jobs)
    .filter((j) => selectedJobIds.has(j.id))
  const { retryMany, excludeMany, unqueueMany } = useJobActions()

  const [confirmRetryOpen, setConfirmRetryOpen] = useState(false)
  const [confirmExcludeOpen, setConfirmExcludeOpen] = useState(false)
  const [confirmUnqueueOpen, setConfirmUnqueueOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [excluding, setExcluding] = useState(false)
  const [unqueueing, setUnqueueing] = useState(false)

  if (selectedJobIds.size === 0) return null

  const retryableIds = selectedJobs.filter((j) => j.status === 'failed').map((j) => j.id)
  const excludableIds = selectedJobs.filter((j) => j.status !== 'submitted').map((j) => j.id)
  const unqueueableIds = selectedJobs.filter((j) => j.status === 'queued').map((j) => j.id)

  const handleRetry = async (): Promise<void> => {
    setConfirmRetryOpen(false)
    setRetrying(true)
    await retryMany(retryableIds)
    setRetrying(false)
    clearSelection()
  }

  const handleExclude = async (): Promise<void> => {
    setConfirmExcludeOpen(false)
    setExcluding(true)
    await excludeMany(excludableIds)
    setExcluding(false)
    clearSelection()
  }

  const handleUnqueue = async (): Promise<void> => {
    setConfirmUnqueueOpen(false)
    setUnqueueing(true)
    await unqueueMany(unqueueableIds)
    setUnqueueing(false)
    clearSelection()
  }

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-soft bg-canvas-soft px-2">
      <span className="text-[12px] font-medium text-text">{t('selection.count', { count: selectedJobIds.size })}</span>
      <Button size="sm" variant="ghost" onClick={clearSelection}>
        {t('selection.clear')}
      </Button>
      <div className="ml-auto flex gap-2">
        <Button
          size="sm"
          disabled={retryableIds.length === 0}
          loading={retrying}
          onClick={() => (retryableIds.length > 1 ? setConfirmRetryOpen(true) : void handleRetry())}
        >
          {retryableIds.length > 0 ? t('actions.retryCount', { count: retryableIds.length }) : t('actions.retry')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={unqueueableIds.length === 0}
          loading={unqueueing}
          onClick={() => setConfirmUnqueueOpen(true)}
        >
          {unqueueableIds.length > 0 ? t('actions.unqueueCount', { count: unqueueableIds.length }) : t('actions.unqueue')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={excludableIds.length === 0}
          loading={excluding}
          onClick={() => setConfirmExcludeOpen(true)}
        >
          {excludableIds.length > 0 ? t('actions.excludeCount', { count: excludableIds.length }) : t('actions.exclude')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRetryOpen}
        title={t('confirm.retryTitle')}
        message={t('confirm.retryMessage', { count: retryableIds.length })}
        confirmLabel={t('actions.retryAll')}
        loading={retrying}
        onConfirm={handleRetry}
        onCancel={() => setConfirmRetryOpen(false)}
      />
      <ConfirmDialog
        open={confirmExcludeOpen}
        title={t('confirm.excludeTitle', { count: excludableIds.length })}
        message={t('confirm.excludeMessage', { count: excludableIds.length })}
        confirmLabel={t('actions.exclude')}
        danger
        loading={excluding}
        onConfirm={handleExclude}
        onCancel={() => setConfirmExcludeOpen(false)}
      />
      <ConfirmDialog
        open={confirmUnqueueOpen}
        title={t('confirm.unqueueTitle', { count: unqueueableIds.length })}
        message={t('confirm.unqueueMessage', { count: unqueueableIds.length })}
        confirmLabel={t('actions.unqueue')}
        loading={unqueueing}
        onConfirm={handleUnqueue}
        onCancel={() => setConfirmUnqueueOpen(false)}
      />
    </div>
  )
}
