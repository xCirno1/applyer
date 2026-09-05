import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import {
  getStorageMode,
  setStorageMode,
  getAutoStartCommand,
  setAutoStartCommand,
  getNotificationPreferences,
  setNotificationPreferences,
  setNotificationLocale
} from '../db/repositories/settingsRepository'
import { getProfile, saveProfile, hasProfile } from '../db/repositories/profileRepository'
import { listDocuments, rewriteDocumentStorageMode } from '../db/repositories/documentsRepository'
import { isEncryptionAvailable } from '../db/encryption'
import { logActivity } from '../db/repositories/activityLogRepository'
import { computeStorageStats } from '../storageStats'
import type { StorageMode } from '@shared/types/profile'
import type { AutoStartCommand } from '@shared/types/ipcEvents'
import type { StorageStats } from '@shared/types/storage'
import { getSettings, isSettingKey } from '@shared/settings'
import { getAdvancedSettingsSnapshot, resetUserSetting, updateUserSetting } from '../config/settings'
import {
  isNotificationPreferences,
  isNotificationLocale,
  isNotificationTestKind,
  type NotificationPreferences
} from '@shared/types/notification'
import { sendTestNotification } from '../notificationService'

const AUTO_START_COMMAND_MAX_LENGTH = getSettings().dangerousAutoStartCommandMaxLength

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settings.changeStorageMode, async (_event, { mode }: { mode: StorageMode }) => {
    if (mode !== 'encrypted' && mode !== 'plaintext') {
      return { ok: false, error: appError('invalidStorageMode') }
    }
    if (mode === 'encrypted' && !isEncryptionAvailable()) {
      return { ok: false, error: appError('keychainUnavailable') }
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
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.settings.getAutoStartCommand, (): AutoStartCommand => getAutoStartCommand())

  ipcMain.handle(IPC.settings.setAutoStartCommand, (_event, { command }: { command: unknown }) => {
    if (typeof command !== 'string') {
      return { ok: false, error: appError('invalidCommand') }
    }
    // Strip newlines/carriage returns rather than rejecting them outright —
    // this is typed straight into a pty on session start, so a stray
    // newline would silently turn into "run this extra line too" instead
    // of an obvious validation error.
    const sanitized = command.replace(/[\r\n]+/g, ' ').trim()
    if (sanitized.length > AUTO_START_COMMAND_MAX_LENGTH) {
      return { ok: false, error: appError('commandTooLong', { max: AUTO_START_COMMAND_MAX_LENGTH }) }
    }
    setAutoStartCommand(sanitized)
    logActivity('info', sanitized ? `Auto-start command set to: ${sanitized}` : 'Auto-start command disabled')
    return { ok: true, command: sanitized }
  })

  ipcMain.handle(IPC.settings.getStorageStats, (): StorageStats => computeStorageStats())

  ipcMain.handle(IPC.settings.getAdvanced, () => getAdvancedSettingsSnapshot())

  ipcMain.handle(IPC.settings.updateAdvanced, (_event, payload: { key?: unknown; value?: unknown }) => {
    if (!isSettingKey(payload?.key)) {
      return { ok: false, error: appError('invalidAdvancedSetting') }
    }
    try {
      const snapshot = updateUserSetting(payload.key, payload.value)
      logActivity('info', `Advanced setting updated: ${payload.key}`)
      return { ok: true, snapshot }
    } catch (error) {
      logActivity('error', `Advanced setting update failed: ${payload.key}`, { error: String(error) })
      return { ok: false, error: appError('invalidAdvancedSetting', { message: String(error) }) }
    }
  })

  ipcMain.handle(IPC.settings.resetAdvanced, (_event, payload: { key?: unknown }) => {
    if (!isSettingKey(payload?.key)) {
      return { ok: false, error: appError('invalidAdvancedSetting') }
    }
    try {
      const snapshot = resetUserSetting(payload.key)
      logActivity('info', `Advanced setting reset: ${payload.key}`)
      return { ok: true, snapshot }
    } catch (error) {
      logActivity('error', `Advanced setting reset failed: ${payload.key}`, { error: String(error) })
      return { ok: false, error: unexpectedError(error) }
    }
  })

  ipcMain.handle(IPC.settings.getNotificationPreferences, (): NotificationPreferences => getNotificationPreferences())

  ipcMain.handle(IPC.settings.setNotificationPreferences, (_event, payload: unknown) => {
    const preferences =
      typeof payload === 'object' && payload !== null
        ? (payload as { preferences?: unknown }).preferences
        : undefined
    if (!isNotificationPreferences(preferences)) {
      return { ok: false, error: appError('invalidNotificationPreferences') }
    }
    try {
      setNotificationPreferences(preferences)
      logActivity('info', 'Desktop notification preferences updated', { ...preferences })
      return { ok: true, preferences }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.settings.testNotification, (_event, payload: unknown) => {
    const kind =
      typeof payload === 'object' && payload !== null ? (payload as { kind?: unknown }).kind : undefined
    if (!isNotificationTestKind(kind)) {
      return { ok: false, error: appError('invalidNotificationPreferences') }
    }
    return sendTestNotification(kind)
      ? { ok: true }
      : { ok: false, error: appError('notificationsUnsupported') }
  })

  ipcMain.handle(IPC.settings.setNotificationLocale, (_event, payload: unknown) => {
    const locale =
      typeof payload === 'object' && payload !== null ? (payload as { locale?: unknown }).locale : undefined
    if (!isNotificationLocale(locale)) {
      return { ok: false, error: appError('invalidLocale') }
    }
    try {
      setNotificationLocale(locale)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })
}
