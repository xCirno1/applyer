import { ipcMain } from 'electron'
import { IPC, type BrowserPreference } from '@shared/types/ipcEvents'
import { unexpectedError } from '@shared/types/errorCodes'
import {
  ensureManagedChromiumDownloaded,
  getResolvedBrowserStatus,
  invalidateResolvedBrowser,
  resolveManagedDownloadConfirmation
} from '../browser/browserController'
import { getBrowserPreference, setBrowserPreference } from '../db/repositories/settingsRepository'

export function registerBrowserSetupIpc(): void {
  ipcMain.handle(IPC.browserSetup.retryDownload, async () => {
    try {
      // Clicking "Retry" is already an explicit user action — don't ask again.
      await ensureManagedChromiumDownloaded({ requireConfirmation: false })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.browserSetup.respondInstall, (_event, payload: { accept: boolean }) => {
    resolveManagedDownloadConfirmation(payload.accept)
    return { ok: true }
  })

  ipcMain.handle(IPC.browserSetup.getPreference, () => getBrowserPreference())

  ipcMain.handle(IPC.browserSetup.setPreference, (_event, payload: { preference: BrowserPreference }) => {
    setBrowserPreference(payload.preference)
    invalidateResolvedBrowser()
    return { ok: true }
  })

  ipcMain.handle(IPC.browserSetup.getStatus, () => getResolvedBrowserStatus())
}
