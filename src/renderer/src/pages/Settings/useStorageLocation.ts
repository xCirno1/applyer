import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../components/ui/useToast'
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
  const toast = useToast()

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
      const picked = await window.api.storageLocation.pickFolder()
      if (!picked.ok) return
      const validation = await window.api.storageLocation.validate(picked.path)
      if (!validation.ok) {
        toast.error(validation.error)
        return
      }
      setUi({ phase: 'pendingConfirm', path: picked.path })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not choose a storage location.')
    }
  }

  const pickExisting = async (): Promise<void> => {
    try {
      const picked = await window.api.storageLocation.pickFolder()
      if (!picked.ok) return
      setUi({ phase: 'pendingExistingConfirm', path: picked.path })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not choose a storage location.')
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
        toast.success('Storage location updated.')
        refreshStatus()
      } else {
        toast.error(result.error ?? 'Failed to change storage location.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change storage location.')
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
        toast.success('Connected to the existing storage location. Reloading Applyer…')
        refreshStatus()
        // The main process now serves a different database. Reload the
        // renderer so every mounted store/page refetches from that dataset;
        // otherwise Settings can switch successfully while the board keeps
        // showing records cached from the previous connection.
        window.setTimeout(() => window.location.reload(), 400)
      } else {
        toast.error(result.error ?? 'Failed to connect to that storage location.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect to that storage location.')
    } finally {
      setUi({ phase: 'idle' })
    }
  }

  return { status, ui, pick, pickExisting, confirm, confirmExisting, cancel }
}
