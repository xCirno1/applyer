import { ipcMain } from 'electron'
import { IPC, type BrowserPreference } from '@shared/types/ipcEvents'
import { ensureManagedChromiumDownloaded, getResolvedBrowserStatus, invalidateResolvedBrowser } from '../browser/browserController'
import { getBrowserPreference, setBrowserPreference } from '../db/repositories/settingsRepository'

export function registerBrowserSetupIpc(): void {
  ipcMain.handle(IPC.browserSetup.retryDownload, async () => {
    try {
      await ensureManagedChromiumDownloaded()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle(IPC.browserSetup.getPreference, () => getBrowserPreference())

  ipcMain.handle(IPC.browserSetup.setPreference, (_event, payload: { preference: BrowserPreference }) => {
    setBrowserPreference(payload.preference)
    invalidateResolvedBrowser()
    return { ok: true }
  })

  ipcMain.handle(IPC.browserSetup.getStatus, () => getResolvedBrowserStatus())
}
