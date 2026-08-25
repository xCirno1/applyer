import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import {
  getStorageMode,
  setStorageMode,
  getAutoStartCommand,
  setAutoStartCommand
} from '../db/repositories/settingsRepository'
import { getProfile, saveProfile, hasProfile } from '../db/repositories/profileRepository'
import { listDocuments, rewriteDocumentStorageMode } from '../db/repositories/documentsRepository'
import { isEncryptionAvailable } from '../db/encryption'
import { logActivity } from '../db/repositories/activityLogRepository'
import { computeStorageStats } from '../storageStats'
import type { StorageMode } from '@shared/types/profile'
import type { AutoStartCommand } from '@shared/types/ipcEvents'
import type { StorageStats } from '@shared/types/storage'

const AUTO_START_COMMAND_MAX_LENGTH = 500

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settings.changeStorageMode, async (_event, { mode }: { mode: StorageMode }) => {
    if (mode !== 'encrypted' && mode !== 'plaintext') {
      return { ok: false, error: 'Invalid storage mode.' }
    }
    if (mode === 'encrypted' && !isEncryptionAvailable()) {
      return { ok: false, error: 'Encrypted storage is not available on this system (no OS keychain detected).' }
    }

    const currentMode = getStorageMode()
    if (currentMode === mode) {
      return { ok: true }
    }

    try {
      setStorageMode(mode)

      if (hasProfile()) {
        const profile = getProfile()
        if (profile) saveProfile(profile)
      }

      for (const doc of listDocuments()) {
        await rewriteDocumentStorageMode(doc.id, mode)
      }

      logActivity('info', `Storage mode changed to ${mode}`)
      return { ok: true }
    } catch (err) {
      // Best-effort rollback of the setting itself; the data already
      // rewritten in the new mode is left as-is rather than risking a
      // partial, inconsistent second migration back.
      if (currentMode) setStorageMode(currentMode)
      logActivity('error', 'Storage mode change failed', { error: String(err) })
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.settings.getAutoStartCommand, (): AutoStartCommand => getAutoStartCommand())

  ipcMain.handle(IPC.settings.setAutoStartCommand, (_event, { command }: { command: unknown }) => {
    if (typeof command !== 'string') {
      return { ok: false, error: 'Invalid command.' }
    }
    // Strip newlines/carriage returns rather than rejecting them outright —
    // this is typed straight into a pty on session start, so a stray
    // newline would silently turn into "run this extra line too" instead
    // of an obvious validation error.
    const sanitized = command.replace(/[\r\n]+/g, ' ').trim()
    if (sanitized.length > AUTO_START_COMMAND_MAX_LENGTH) {
      return { ok: false, error: `Command is too long (max ${AUTO_START_COMMAND_MAX_LENGTH} characters).` }
    }
    setAutoStartCommand(sanitized)
    logActivity('info', sanitized ? `Auto-start command set to: ${sanitized}` : 'Auto-start command disabled')
    return { ok: true, command: sanitized }
  })

  ipcMain.handle(IPC.settings.getStorageStats, (): StorageStats => computeStorageStats())
}
