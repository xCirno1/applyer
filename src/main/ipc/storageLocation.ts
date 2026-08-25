import { ipcMain, dialog } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import type { DialogLabels } from '@shared/types/ipcEvents'
import type {
  StorageLocationStatus,
  StorageLocationValidation,
  StorageLocationMigrationResult,
  StorageLocationPickResult
} from '@shared/types/storageLocation'
import {
  activeStorageRoot,
  defaultStorageRoot,
  consumeStartupFallbackWarning,
  getStorageRecoveryState
} from '../config/storageLocation'
import { validateStorageDestination, migrateStorageLocation } from '../storageLocation/migrate'
import {
  connectToExistingLocation,
  resolveCustomStorageRoot,
  useDefaultStorageLocation
} from '../storageLocation/recovery'
import { closeMcpSocketServer, startMcpServerIfStorageResolved } from '../storageLocation/bootGate'
import { appLogger } from '../logger'
import { relaunchApp } from '../relaunch'
import { broadcastStorageLocationProgress } from './jobsBroadcast'
import { appError, unexpectedError } from '@shared/types/errorCodes'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerStorageLocationIpc(): void {
  ipcMain.handle(IPC.storageLocation.getStatus, (): StorageLocationStatus => {
    const defaultRoot = defaultStorageRoot()
    const active = activeStorageRoot()
    const recovery = getStorageRecoveryState()
    return {
      activeRoot: active,
      isDefault: active === defaultRoot,
      defaultRoot,
      startupFallbackWarning: consumeStartupFallbackWarning(),
      needsRecovery: recovery.needed,
      recoveryReason: recovery.reason,
      unavailableCustomRoot: recovery.unavailableCustomRoot
    }
  })

  ipcMain.handle(
    IPC.storageLocation.retryCustomLocation,
    async (): Promise<StorageLocationMigrationResult> => {
      try {
        const result = await resolveCustomStorageRoot()
        if (result.ok) startMcpServerIfStorageResolved()
        return result
      } catch (err) {
        const message = errorMessage(err)
        appLogger.error(`Storage location retry failed unexpectedly: ${message}`)
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )

  ipcMain.handle(IPC.storageLocation.useDefaultLocation, (): StorageLocationMigrationResult => {
    try {
      const result = useDefaultStorageLocation()
      if (result.ok) startMcpServerIfStorageResolved()
      return result
    } catch (err) {
      const message = errorMessage(err)
      appLogger.error(`Using the default storage location failed unexpectedly: ${message}`)
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.storageLocation.pickFolder, async (_event, { labels }: { labels: DialogLabels }): Promise<StorageLocationPickResult> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: labels.title,
      properties: ['openDirectory', 'createDirectory']
    })
    const path = filePaths[0]
    if (canceled || !path) return { ok: false, canceled: true }
    return { ok: true, path }
  })

  ipcMain.handle(
    IPC.storageLocation.connectExisting,
    async (_event, { path }: { path: unknown }): Promise<StorageLocationMigrationResult> => {
      if (typeof path !== 'string') {
        return { ok: false, error: appError('invalidFolderPath') }
      }
      try {
        const result = await connectToExistingLocation(path)
        if (result.ok) {
          // Stop accepting new agent work immediately. Relaunching the main
          // process, rather than swapping its singleton DB live, terminates
          // every old-dataset browser/network continuation before startup
          // opens the selected location.
          closeMcpSocketServer()
          setTimeout(() => relaunchApp(), 100)
        }
        return result
      } catch (err) {
        const message = errorMessage(err)
        appLogger.error(`Connecting to an existing storage location failed unexpectedly: ${message}`)
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.storageLocation.validate,
    (_event, { path }: { path: unknown }): StorageLocationValidation => {
      if (typeof path !== 'string') {
        return { ok: false, error: appError('invalidFolderPath') }
      }
      return validateStorageDestination(path)
    }
  )

  ipcMain.handle(
    IPC.storageLocation.migrate,
    async (_event, { path }: { path: unknown }): Promise<StorageLocationMigrationResult> => {
      if (typeof path !== 'string') {
        return { ok: false, error: appError('invalidFolderPath') }
      }
      try {
        return await migrateStorageLocation(path, { onProgress: broadcastStorageLocationProgress })
      } catch (err) {
        // Unexpected failure outside migrateStorageLocation's own handled
        // phases — its own reopen-fallback may not have run, so avoid
        // touching the DB here (logActivity requires an open connection)
        // and log via the file-backed logger instead.
        const message = errorMessage(err)
        appLogger.error(`Storage location change failed unexpectedly: ${message}`)
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )
}
