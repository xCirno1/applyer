import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import type { StorageLocationStatus, StorageLocationProgressPayload } from '@shared/types/storageLocation'

type LocationUiState =
  | { phase: 'idle' }
  | { phase: 'pendingConfirm'; path: string }
  | { phase: 'pendingExistingConfirm'; path: string }
  | { phase: 'migrating'; progress: StorageLocationProgressPayload | null }
  | { phase: 'connecting' }

interface UseStorageLocationResult {
  status: StorageLocationStatus | null
  ui: LocationUiState
  /** Opens the folder picker, validates the choice, and — if valid — moves to the confirm step. Validation failures are toasted directly (no dialog opened for a doomed folder). */
  pick: () => Promise<void>
  pickExisting: () => Promise<void>
  confirm: () => Promise<void>
  confirmExisting: () => Promise<void>
  cancel: () => void
}

/** Push-driven progress (same shape as useBrowserSetupState), click-driven start (like ExportModal). */
export function useStorageLocation(): UseStorageLocationResult {
  const [status, setStatus] = useState<StorageLocationStatus | null>(null)
  const [ui, setUi] = useState<LocationUiState>({ phase: 'idle' })
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  // startupFallbackWarning is intentionally not surfaced here — App.tsx's
  // boot check calls getStatus() before Settings is ever reachable, and
  // that one-shot field is already consumed (and toasted) by then.
  const refreshStatus = useCallback((): void => {
    window.api.storageLocation.getStatus().then(setStatus)
  }, [])

  useEffect(refreshStatus, [refreshStatus])

  useEffect(() => {
    return window.api.storageLocation.onProgress((payload) => {
      setUi({ phase: 'migrating', progress: payload })
    })
  }, [])

  const pick = async (): Promise<void> => {
    try {
      const picked = await window.api.storageLocation.pickFolder({
        title: t('storage.pickFolderTitle'),
        filterName: ''
      })
      if (!picked.ok) return
      const validation = await window.api.storageLocation.validate(picked.path)
      if (!validation.ok) {
        toast.error(errorMessage(validation.error))
        return
      }
      setUi({ phase: 'pendingConfirm', path: picked.path })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('storage.pickFailed'))
    }
  }

  const pickExisting = async (): Promise<void> => {
    try {
      const picked = await window.api.storageLocation.pickFolder({
        title: t('storage.pickFolderTitle'),
        filterName: ''
      })
      if (!picked.ok) return
      setUi({ phase: 'pendingExistingConfirm', path: picked.path })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('storage.pickFailed'))
    }
  }

  const cancel = (): void => setUi({ phase: 'idle' })

  const confirm = async (): Promise<void> => {
    if (ui.phase !== 'pendingConfirm') return
    const path = ui.path
    setUi({ phase: 'migrating', progress: null })
    try {
      const result = await window.api.storageLocation.migrate(path)
      if (result.ok) {
        toast.success(t('storage.locationUpdated'))
        refreshStatus()
      } else {
        toast.error(errorMessage(result.error))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('storage.locationChangeFailed'))
    } finally {
      setUi({ phase: 'idle' })
    }
  }

  const confirmExisting = async (): Promise<void> => {
    if (ui.phase !== 'pendingExistingConfirm') return
    const path = ui.path
    setUi({ phase: 'connecting' })
    try {
      const result = await window.api.storageLocation.connectExisting(path)
      if (result.ok) {
        toast.success(t('storage.locationSelected'))
      } else {
        toast.error(errorMessage(result.error))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('storage.connectFailed'))
    } finally {
      setUi({ phase: 'idle' })
    }
  }

  return { status, ui, pick, pickExisting, confirm, confirmExisting, cancel }
}
