import { useTranslation } from 'react-i18next'
import { useJobsStore } from '../../state/jobsStore'
import { useToast } from '../ui/useToast'

/**
 * The two bulk job mutations shared by the board's `BulkActionBar` and each
 * `JobCard`'s right-click menu (`useJobContextMenu`) — kept in one place so
 * both entry points apply store updates and toasts identically. Confirming
 * (or not) before calling these is the caller's job: single-job retry stays
 * immediate to match `JobDetailModal`'s existing behavior, while anything
 * touching more than one job goes through a `ConfirmDialog` first.
 */
export function useJobActions(): {
  retryMany: (ids: string[]) => Promise<void>
  excludeMany: (ids: string[]) => Promise<void>
  unqueueMany: (ids: string[]) => Promise<void>
} {
  const { t } = useTranslation('board')
  const applyUpdate = useJobsStore((s) => s.applyUpdate)
  const removeJobLocal = useJobsStore((s) => s.removeJobLocal)
  const toast = useToast()

  const retryMany = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    const result = await window.api.jobs.retryMany(ids)
    if (!result.ok) {
      toast.error(t('toast.retryFailed'))
      return
    }
    for (const job of result.jobs) applyUpdate(job)
    toast.success(t('toast.retried', { count: result.jobs.length }))
  }

  const excludeMany = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    const result = await window.api.jobs.excludeMany(ids)
    if (!result.ok) {
      toast.error(t('toast.excludeFailed'))
      return
    }
    for (const id of result.excludedIds) removeJobLocal(id)
    toast.success(t('toast.excluded', { count: result.excludedIds.length }))
  }

  const unqueueMany = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    const result = await window.api.jobs.unqueueMany(ids)
    if (!result.ok) {
      toast.error(t('toast.unqueueFailed'))
      return
    }
    for (const id of result.unqueuedIds) removeJobLocal(id)
    toast.success(t('toast.unqueued', { count: result.unqueuedIds.length }))
  }

  return { retryMany, excludeMany, unqueueMany }
}
