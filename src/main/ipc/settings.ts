import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { getStorageMode, setStorageMode } from '../db/repositories/settingsRepository'
import { getProfile, saveProfile, hasProfile } from '../db/repositories/profileRepository'
import { listDocuments, rewriteDocumentStorageMode } from '../db/repositories/documentsRepository'
import { isEncryptionAvailable } from '../db/encryption'
import { logActivity } from '../db/repositories/activityLogRepository'
import type { StorageMode } from '@shared/types/profile'

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settings.changeStorageMode, (_event, { mode }: { mode: StorageMode }) => {
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
        rewriteDocumentStorageMode(doc.id, mode)
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
}
