import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
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
import type { McpCliId, OnboardingStatus } from '@shared/types/ipcEvents'
import type { StorageMode } from '@shared/types/profile'

export function registerOnboardingIpc(): void {
  ipcMain.handle(IPC.onboarding.getStatus, (): OnboardingStatus => {
    return {
      completed: isOnboardingCompleted(),
      storageMode: getStorageMode(),
      encryptionAvailable: isEncryptionAvailable()
    }
  })

  ipcMain.handle(IPC.onboarding.setStorageMode, (_event, { mode }: { mode: StorageMode }) => {
    if (mode !== 'encrypted' && mode !== 'plaintext') {
      return { ok: false, error: 'Invalid storage mode.' }
    }
    setStorageMode(mode)
    return { ok: true }
  })

  ipcMain.handle(IPC.onboarding.complete, () => {
    markOnboardingCompleted()
    return { ok: true }
  })

  ipcMain.handle(IPC.onboarding.detectMcpConfigs, () => detectMcpConfigs())

  ipcMain.handle(IPC.onboarding.getMcpSnippet, (_event, { cli }: { cli: McpCliId }) => getMcpSnippet(cli))

  ipcMain.handle(IPC.onboarding.autoConfigureMcp, (_event, { cli }: { cli: McpCliId }) => autoConfigureMcp(cli))

  ipcMain.handle(IPC.onboarding.verifyMcpConnection, () => verifyMcpConnection())
}
