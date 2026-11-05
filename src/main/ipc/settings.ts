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
  setNotificationLocale,
  getAgentPermissions,
  setAgentPermissions,
  getSearchCountry,
  setSearchCountry,
  getSearchChallengeFallback,
  setSearchChallengeFallback
} from '../db/repositories/settingsRepository'
import { isSearchCountry, type SearchCountry } from '@shared/types/jobSource'
import { getProfile, saveProfile, hasProfile } from '../db/repositories/profileRepository'
import { listDocuments, rewriteDocumentStorageMode } from '../db/repositories/documentsRepository'
import { rewriteResumeStorageMode } from '../db/repositories/resumeRepository'
import { rewriteChatStorageMode } from '../db/repositories/chatRepository'
import { isEncryptionAvailable } from '../db/encryption'
import { logActivity } from '../db/repositories/activityLogRepository'
import { enabledPayload } from './payloadSchemas'
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
import { setDatabaseEncryptionMode } from '../db'
import { setLogStorageMode } from '../logger'
import { rewriteScreenshotStorageMode } from '../secureFiles'
import { isAgentPermissions, type AgentPermissions } from '@shared/types/agentPermissions'
import { broadcastAgentPermissionsChanged } from './jobsBroadcast'
import {
  CustomSystemPromptError,
  getCustomSystemPrompt,
  rewriteCustomSystemPromptStorageMode,
  saveCustomSystemPrompt
} from '../config/customSystemPrompt'
import { writeAgentInstructions } from '../config/agentInstructions'
import { CUSTOM_SYSTEM_PROMPT_MAX_LENGTH, type CustomSystemPromptResult } from '@shared/types/customSystemPrompt'

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
      rewriteResumeStorageMode(mode)
      rewriteChatStorageMode(mode)
      rewriteCustomSystemPromptStorageMode(mode)
      rewriteScreenshotStorageMode(mode)
      setLogStorageMode(mode)

      // Whole-database encryption covers jobs, search history, exclusions,
      // boards, settings, caches and activity logs without weakening queries.
      setDatabaseEncryptionMode(mode)
      // The instruction file embeds the custom instructions only in
      // plaintext mode, so it has to follow the new mode right away.
      writeAgentInstructions()

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

  ipcMain.handle(IPC.settings.getAgentPermissions, (): AgentPermissions => getAgentPermissions())

  ipcMain.handle(IPC.settings.setAgentPermissions, (_event, payload: unknown) => {
    const permissions =
      typeof payload === 'object' && payload !== null
        ? (payload as { permissions?: unknown }).permissions
        : undefined
    if (!isAgentPermissions(permissions)) return { ok: false, error: appError('invalidAgentPermissions') }
    try {
      setAgentPermissions(permissions)
      broadcastAgentPermissionsChanged(permissions)
      logActivity('info', 'Agent permissions updated', { ...permissions })
      return { ok: true, permissions }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

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

  ipcMain.handle(IPC.settings.getSearchCountry, (): SearchCountry => getSearchCountry())

  ipcMain.handle(IPC.settings.setSearchCountry, (_event, payload: unknown) => {
    const country =
      typeof payload === 'object' && payload !== null ? (payload as { country?: unknown }).country : undefined
    if (!isSearchCountry(country)) {
      return { ok: false, error: appError('invalidSearchCountry') }
    }
    try {
      setSearchCountry(country)
      logActivity('info', `Job search country set to ${country.toUpperCase()}`)
      return { ok: true, country }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.settings.getSearchChallengeFallback, (): boolean => getSearchChallengeFallback())

  ipcMain.handle(IPC.settings.setSearchChallengeFallback, (_event, payload: unknown) => {
    const parsed = enabledPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, error: appError('unexpected') }
    try {
      setSearchChallengeFallback(parsed.data.enabled)
      logActivity('info', `Search challenge fallback ${parsed.data.enabled ? 'enabled' : 'disabled'}`)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
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

  ipcMain.handle(IPC.settings.getCustomSystemPrompt, (): CustomSystemPromptResult => {
    try {
      return { ok: true, prompt: getCustomSystemPrompt() }
    } catch (err) {
      logActivity('error', 'Custom system prompt could not be read', { error: String(err) })
      return { ok: false, error: appError('customSystemPromptUnreadable') }
    }
  })

  ipcMain.handle(IPC.settings.setCustomSystemPrompt, (_event, payload: unknown): CustomSystemPromptResult => {
    const prompt = typeof payload === 'object' && payload !== null ? (payload as { prompt?: unknown }).prompt : undefined
    try {
      const saved = saveCustomSystemPrompt(prompt)
      // CLI agents read the instruction file at session start; chat mode and
      // new MCP connections read the stored row, so only the file needs this.
      writeAgentInstructions()
      // Length only: the text itself is user data and stays out of the log.
      logActivity('info', saved ? 'Custom system prompt updated' : 'Custom system prompt cleared', {
        length: saved.length
      })
      return { ok: true, prompt: saved }
    } catch (err) {
      if (err instanceof CustomSystemPromptError) {
        return {
          ok: false,
          error:
            err.reason === 'tooLong'
              ? appError('customSystemPromptTooLong', { max: CUSTOM_SYSTEM_PROMPT_MAX_LENGTH })
              : appError('invalidCustomSystemPrompt')
        }
      }
      logActivity('error', 'Custom system prompt could not be saved', { error: String(err) })
      return { ok: false, error: unexpectedError(err) }
    }
  })
}
