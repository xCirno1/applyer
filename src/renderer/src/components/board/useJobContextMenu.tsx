import { useState, type MouseEvent, type ReactElement } from 'react'
import type { JobRecord } from '@shared/types/job'
import ContextMenu, { type ContextMenuState } from '../ui/ContextMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import type { MenuEntry } from '../ui/Menu'
import { useJobsStore } from '../../state/jobsStore'
import { useJobActions } from './useJobActions'

interface BulkConfirmState {
  ids: string[]
}

/**
 * Builds and renders the right-click menu for one `JobCard`. One hook
 * instance per card — cheap, since all its state stays null until that
 * specific card is actually right-clicked.
 *
 * Right-clicking a card outside the current selection replaces the
 * selection with just that card (standard file-manager convention);
 * right-clicking a card that's already part of a multi-selection scopes
 * Retry/Exclude to the whole selection instead of just the one card. Retry
 * only confirms when it would touch more than one job (single-job retry
 * matches `JobDetailModal`'s immediate behavior); Exclude always confirms,
 * matching its existing single-job dialog — it's a permanent blacklist.
 */
export function useJobContextMenu(): {
  openContextMenu: (e: MouseEvent, job: JobRecord, onOpen: () => void) => void
  menuNode: ReactElement
} {
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null)
  const [confirmRetry, setConfirmRetry] = useState<BulkConfirmState | null>(null)
  const [confirmExclude, setConfirmExclude] = useState<BulkConfirmState | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [excluding, setExcluding] = useState(false)
  const { retryMany, excludeMany } = useJobActions()

  const openContextMenu = (e: MouseEvent, job: JobRecord, onOpen: () => void): void => {
    e.preventDefault()
    const store = useJobsStore.getState()
    const priorSelection = store.selectedJobIds
    const included = priorSelection.has(job.id)
    if (!included) store.selectOnly(job.id)

    const targetIds = included && priorSelection.size > 1 ? Array.from(priorSelection) : [job.id]
    const isBulk = targetIds.length > 1
    const targetJobs = isBulk
      ? Object.values(store.columns)
          .flatMap((c) => c.jobs)
          .filter((j) => targetIds.includes(j.id))
      : [job]

    const retryableIds = targetJobs.filter((j) => j.status === 'failed').map((j) => j.id)
    const excludableIds = targetJobs.filter((j) => j.status !== 'submitted').map((j) => j.id)

    const items: MenuEntry[] = []
    if (!isBulk) {
      items.push({ type: 'action', key: 'open', label: 'Open', onSelect: onOpen })
    }
    if (retryableIds.length > 0) {
      items.push({
        type: 'action',
        key: 'retry',
        label: isBulk ? `Retry (${retryableIds.length})` : 'Retry',
        onSelect: () => {
          if (retryableIds.length > 1) setConfirmRetry({ ids: retryableIds })
          else void retryMany(retryableIds)
        }
      })
    }
    if (excludableIds.length > 0) {
      items.push({
        type: 'action',
        key: 'exclude',
        label: isBulk ? `Exclude (${excludableIds.length})` : 'Exclude',
        onSelect: () => setConfirmExclude({ ids: excludableIds })
      })
    }
    items.push({ type: 'separator', key: 'sep' })
    items.push(
      isBulk
        ? { type: 'action', key: 'clear', label: 'Clear Selection', onSelect: store.clearSelection }
        : { type: 'action', key: 'deselect', label: 'Deselect', onSelect: store.clearSelection }
    )

    setMenuState({ x: e.clientX, y: e.clientY, items })
  }

  const menuNode = (
    <>
      <ContextMenu state={menuState} onClose={() => setMenuState(null)} />

      <ConfirmDialog
        open={confirmRetry !== null}
        title="Retry these jobs?"
        message={`This moves ${confirmRetry?.ids.length ?? 0} failed job${confirmRetry?.ids.length === 1 ? '' : 's'} back to Queued so they're attempted again.`}
        confirmLabel="Retry all"
        loading={retrying}
        onConfirm={async () => {
          if (!confirmRetry) return
          setRetrying(true)
          await retryMany(confirmRetry.ids)
          setRetrying(false)
          setConfirmRetry(null)
        }}
        onCancel={() => setConfirmRetry(null)}
      />

      <ConfirmDialog
        open={confirmExclude !== null}
        title={confirmExclude && confirmExclude.ids.length > 1 ? 'Exclude these job postings' : 'Exclude this job posting'}
        message="This removes the job(s) from the board and permanently blacklists their URLs — they'll never be returned by a search or be re-queueable again, by you or the agent. You can undo this later from Settings > Exclusions."
        confirmLabel="Exclude"
        danger
        loading={excluding}
        onConfirm={async () => {
          if (!confirmExclude) return
          setExcluding(true)
          await excludeMany(confirmExclude.ids)
          setExcluding(false)
          setConfirmExclude(null)
        }}
        onCancel={() => setConfirmExclude(null)}
      />
    </>
  )

  return { openContextMenu, menuNode }
}
