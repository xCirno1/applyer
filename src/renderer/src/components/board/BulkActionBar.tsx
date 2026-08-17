import { useState, type ReactElement } from 'react'
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
  const { retryMany, excludeMany } = useJobActions()

  const [confirmRetryOpen, setConfirmRetryOpen] = useState(false)
  const [confirmExcludeOpen, setConfirmExcludeOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [excluding, setExcluding] = useState(false)

  if (selectedJobIds.size === 0) return null

  const retryableIds = selectedJobs.filter((j) => j.status === 'failed').map((j) => j.id)
  const excludableIds = selectedJobs.filter((j) => j.status !== 'submitted').map((j) => j.id)

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

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-soft bg-canvas-soft px-2">
      <span className="text-[12px] font-medium text-text">{selectedJobIds.size} selected</span>
      <Button size="sm" variant="ghost" onClick={clearSelection}>
        Clear
      </Button>
      <div className="ml-auto flex gap-2">
        <Button
          size="sm"
          disabled={retryableIds.length === 0}
          loading={retrying}
          onClick={() => (retryableIds.length > 1 ? setConfirmRetryOpen(true) : void handleRetry())}
        >
          Retry{retryableIds.length > 0 ? ` (${retryableIds.length})` : ''}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={excludableIds.length === 0}
          loading={excluding}
          onClick={() => setConfirmExcludeOpen(true)}
        >
          Exclude{excludableIds.length > 0 ? ` (${excludableIds.length})` : ''}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRetryOpen}
        title="Retry selected jobs?"
        message={`This moves ${retryableIds.length} failed job${retryableIds.length === 1 ? '' : 's'} back to Queued so they're attempted again.`}
        confirmLabel="Retry all"
        loading={retrying}
        onConfirm={handleRetry}
        onCancel={() => setConfirmRetryOpen(false)}
      />
      <ConfirmDialog
        open={confirmExcludeOpen}
        title="Exclude selected jobs?"
        message={`This removes ${excludableIds.length} job${excludableIds.length === 1 ? '' : 's'} from the board and permanently blacklists ${
          excludableIds.length === 1 ? 'its URL' : 'their URLs'
        } — they'll never be returned by a search or be re-queueable again, by you or the agent. You can undo this later from Settings > Exclusions.`}
        confirmLabel="Exclude"
        danger
        loading={excluding}
        onConfirm={handleExclude}
        onCancel={() => setConfirmExcludeOpen(false)}
      />
    </div>
  )
}
