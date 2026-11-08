import { useTranslation } from 'react-i18next'
import { useJobsStore } from '../../state/jobsStore'
import { useToast } from '../ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useStagesStore } from '../../state/stagesStore'
import { useErrorMessage } from '../../i18n/formatError'

/**
 * Bulk job mutations shared by the board's `BulkActionBar` and each
 * `JobCard`'s right-click menu (`useJobContextMenu`) — kept in one place so
 * both entry points apply store updates and toasts identically. Confirming
 * (or not) before calling these is the caller's job: single-job retry stays
 * immediate to match `JobDetailModal`'s existing behavior, while manual
 * status changes and destructive actions are confirmed.
 */
export function useJobActions(): {
  markFilledMany: (ids: string[]) => Promise<void>
  retryMany: (ids: string[]) => Promise<void>
  excludeMany: (ids: string[]) => Promise<void>
  unqueueMany: (ids: string[]) => Promise<void>
  removeCompletedMany: (ids: string[]) => Promise<void>
  /**
   * Sets (or with `null` clears) the stage of Submitted jobs. `stageName`
   * is the on-screen name for the toast. Resolves `true` when the request
   * went through, so a picker knows whether to close.
   */
  setStageMany: (ids: string[], stageId: string | null, stageName: string) => Promise<boolean>
} {
  const { t } = useTranslation('board')
  const applyUpdate = useJobsStore((s) => s.applyUpdate)
  const removeJobLocal = useJobsStore((s) => s.removeJobLocal)
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const setJobStage = useStagesStore((s) => s.setJobStage)

  const markFilledMany = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    const result = await callIpc('jobs.markFilledMany', () => window.api.jobs.markFilledMany(ids), {
      ok: false,
      jobs: []
    })
    if (!result.ok) {
      toast.error(t('toast.markFilledFailed'))
      return
    }
    for (const job of result.jobs) applyUpdate(job)
    toast.success(t('toast.markedFilled', { count: result.jobs.length }))
  }

  const retryMany = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    // Each falls back to that call's own failure shape, so a bridge
    // failure produces the same toast a refused request does.
    const result = await callIpc('jobs.retryMany', () => window.api.jobs.retryMany(ids), {
      ok: false,
      jobs: []
    })
    if (!result.ok) {
      toast.error(t('toast.retryFailed'))
      return
    }
    for (const job of result.jobs) applyUpdate(job)
    toast.success(t('toast.retried', { count: result.jobs.length }))
  }

  const excludeMany = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    const result = await callIpc('jobs.excludeMany', () => window.api.jobs.excludeMany(ids), {
      ok: false,
      excludedIds: []
    })
    if (!result.ok) {
      toast.error(t('toast.excludeFailed'))
      return
    }
    for (const id of result.excludedIds) removeJobLocal(id)
    toast.success(t('toast.excluded', { count: result.excludedIds.length }))
  }

  const unqueueMany = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    const result = await callIpc('jobs.unqueueMany', () => window.api.jobs.unqueueMany(ids), {
      ok: false,
      unqueuedIds: []
    })
    if (!result.ok) {
      toast.error(t('toast.unqueueFailed'))
      return
    }
    for (const id of result.unqueuedIds) removeJobLocal(id)
    toast.success(t('toast.unqueued', { count: result.unqueuedIds.length }))
  }

  const removeCompletedMany = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    const result = await callIpc('jobs.removeMany', () => window.api.jobs.removeMany(ids), {
      ok: false,
      removedIds: []
    })
    if (!result.ok) {
      toast.error(t('toast.removeFailed'))
      return
    }
    for (const id of result.removedIds) removeJobLocal(id)
    toast.success(t('toast.removed', { count: result.removedIds.length }))
  }

  const setStageMany = async (ids: string[], stageId: string | null, stageName: string): Promise<boolean> => {
    if (ids.length === 0) return false
    const result = await setJobStage(ids, stageId)
    if (!result.ok) {
      toast.error(errorMessage(result.error))
      return false
    }
    // Applied here as well as by the `jobs:updated` broadcast, so the card
    // and an open detail modal settle with the request.
    const updated = Array.isArray(result.value?.jobs) ? result.value.jobs : []
    const skipped = Array.isArray(result.value?.skippedIds) ? result.value.skippedIds.length : 0
    for (const job of updated) applyUpdate(job)
    if (updated.length === 0 && skipped === 0) toast.info(t('stages.toast.unchanged'))
    else if (updated.length > 0) {
      toast.success(
        stageId
          ? t('stages.toast.set', { count: updated.length, name: stageName })
          : t('stages.toast.cleared', { count: updated.length })
      )
    }
    if (skipped > 0) toast.info(t('stages.toast.skipped', { count: skipped }))
    return true
  }

  return { markFilledMany, retryMany, excludeMany, unqueueMany, removeCompletedMany, setStageMany }
}
