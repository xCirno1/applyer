import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { ensureManagedChromiumDownloaded } from '../browser/browserController'

export function registerBrowserSetupIpc(): void {
  ipcMain.handle(IPC.browserSetup.retryDownload, async () => {
    try {
      await ensureManagedChromiumDownloaded()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
