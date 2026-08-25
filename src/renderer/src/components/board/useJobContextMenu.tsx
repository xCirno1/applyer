import { useState, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
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
 * Retry/Unqueue/Exclude to the whole selection instead of just the one
 * card. Retry only confirms when it would touch more than one job
 * (single-job retry matches `JobDetailModal`'s immediate behavior);
 * Unqueue and Exclude always confirm, matching their existing single-job
 * dialogs — both remove the job from the board (Exclude also permanently
 * blacklists its URL; Unqueue does not).
 */
export function useJobContextMenu(): {
  openContextMenu: (e: MouseEvent, job: JobRecord, onOpen: () => void) => void
  menuNode: ReactElement
} {
  const { t } = useTranslation('board')
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null)
  const [confirmRetry, setConfirmRetry] = useState<BulkConfirmState | null>(null)
  const [confirmExclude, setConfirmExclude] = useState<BulkConfirmState | null>(null)
  const [confirmUnqueue, setConfirmUnqueue] = useState<BulkConfirmState | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [excluding, setExcluding] = useState(false)
  const [unqueueing, setUnqueueing] = useState(false)
  const { retryMany, excludeMany, unqueueMany } = useJobActions()

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
    const unqueueableIds = targetJobs.filter((j) => j.status === 'queued').map((j) => j.id)

    const items: MenuEntry[] = []
    if (!isBulk) {
      items.push({ type: 'action', key: 'open', label: t('actions.open'), onSelect: onOpen })
    }
    if (retryableIds.length > 0) {
      items.push({
        type: 'action',
        key: 'retry',
        label: isBulk ? t('actions.retryCount', { count: retryableIds.length }) : t('actions.retry'),
        onSelect: () => {
          if (retryableIds.length > 1) setConfirmRetry({ ids: retryableIds })
          else void retryMany(retryableIds)
        }
      })
    }
    if (unqueueableIds.length > 0) {
      items.push({
        type: 'action',
        key: 'unqueue',
        label: isBulk ? t('actions.unqueueCount', { count: unqueueableIds.length }) : t('actions.unqueue'),
        onSelect: () => setConfirmUnqueue({ ids: unqueueableIds })
      })
    }
    if (excludableIds.length > 0) {
      items.push({
        type: 'action',
        key: 'exclude',
        label: isBulk ? t('actions.excludeCount', { count: excludableIds.length }) : t('actions.exclude'),
        onSelect: () => setConfirmExclude({ ids: excludableIds })
      })
    }
    items.push({ type: 'separator', key: 'sep' })
    items.push(
      isBulk
        ? { type: 'action', key: 'clear', label: t('actions.clearSelection'), onSelect: store.clearSelection }
        : { type: 'action', key: 'deselect', label: t('actions.deselect'), onSelect: store.clearSelection }
    )

    setMenuState({ x: e.clientX, y: e.clientY, items })
  }

  const menuNode = (
    <>
      <ContextMenu state={menuState} onClose={() => setMenuState(null)} />

      <ConfirmDialog
        open={confirmRetry !== null}
        title={t('confirm.retryTitleMenu')}
        message={t('confirm.retryMessage', { count: confirmRetry?.ids.length ?? 0 })}
        confirmLabel={t('actions.retryAll')}
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
        title={t('confirm.excludeTitle', { count: confirmExclude?.ids.length ?? 0 })}
        message={t('confirm.excludeMessage', { count: confirmExclude?.ids.length ?? 0 })}
        confirmLabel={t('actions.exclude')}
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

      <ConfirmDialog
        open={confirmUnqueue !== null}
        title={t('confirm.unqueueTitle', { count: confirmUnqueue?.ids.length ?? 0 })}
        message={t('confirm.unqueueMessage', { count: confirmUnqueue?.ids.length ?? 0 })}
        confirmLabel={t('actions.unqueue')}
        loading={unqueueing}
        onConfirm={async () => {
          if (!confirmUnqueue) return
          setUnqueueing(true)
          await unqueueMany(confirmUnqueue.ids)
          setUnqueueing(false)
          setConfirmUnqueue(null)
        }}
        onCancel={() => setConfirmUnqueue(null)}
      />
    </>
  )

  return { openContextMenu, menuNode }
}
