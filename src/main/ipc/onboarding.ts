import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import {
  getStorageMode,
  setStorageMode,
  isOnboardingCompleted,
  markOnboardingCompleted
} from '../db/repositories/settingsRepository'
import { isEncryptionAvailable } from '../db/encryption'
import {
  detectMcpConfigs,
  getMcpSnippet,
  autoConfigureMcp,
  verifyMcpConnection
} from '../config/mcpConfigWriter'
import { mcpTargetPayload } from './payloadSchemas'
import type { OnboardingStatus } from '@shared/types/ipcEvents'
import { setDatabaseEncryptionMode } from '../db'
import { setLogStorageMode } from '../logger'
import { rewriteScreenshotStorageMode } from '../secureFiles'

export function registerOnboardingIpc(): void {
  ipcMain.handle(IPC.onboarding.getStatus, (): OnboardingStatus => {
    return {
      completed: isOnboardingCompleted(),
      storageMode: getStorageMode(),
      encryptionAvailable: isEncryptionAvailable()
    }
  })

  ipcMain.handle(IPC.onboarding.setStorageMode, (_event, payload: unknown) => {
    const mode = (payload as { mode?: unknown } | null | undefined)?.mode
    if (mode !== 'encrypted' && mode !== 'plaintext') {
      return { ok: false, error: appError('invalidStorageMode') }
    }
    if (mode === 'encrypted' && !isEncryptionAvailable()) {
      return { ok: false, error: appError('keychainUnavailable') }
    }
    const currentMode = getStorageMode()
    try {
      setStorageMode(mode)
      rewriteScreenshotStorageMode(mode)
      setLogStorageMode(mode)
      setDatabaseEncryptionMode(mode)
      return { ok: true }
    } catch (err) {
      const rollbackMode = currentMode ?? 'plaintext'
      setStorageMode(rollbackMode)
      rewriteScreenshotStorageMode(rollbackMode)
      setLogStorageMode(rollbackMode)
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.onboarding.complete, () => {
    markOnboardingCompleted()
    return { ok: true }
  })

  ipcMain.handle(IPC.onboarding.detectMcpConfigs, () => detectMcpConfigs())

  // `cli` indexes an adapter table, so an unrecognised one is a TypeError on
  // an undefined adapter rather than a refusal — checked before the lookup.
  ipcMain.handle(IPC.onboarding.getMcpSnippet, (_event, payload: unknown) => {
    const parsed = mcpTargetPayload.safeParse(payload)
    if (!parsed.success) return ''
    return getMcpSnippet(parsed.data.cli, parsed.data.scope)
  })

  ipcMain.handle(IPC.onboarding.autoConfigureMcp, (_event, payload: unknown) => {
    const parsed = mcpTargetPayload.safeParse(payload)
    // `McpAutoConfigureResult` carries a finished string rather than an error
    // code — this is the same channel an adapter's own failure comes back on.
    if (!parsed.success) {
      return { success: false, error: 'Unrecognized CLI or scope.' }
    }
    return autoConfigureMcp(parsed.data.cli, parsed.data.scope)
  })

  ipcMain.handle(IPC.onboarding.verifyMcpConnection, () => verifyMcpConnection())
}
