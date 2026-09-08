import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { unexpectedError } from '@shared/types/errorCodes'
import {
  ensureManagedChromiumDownloaded,
  getResolvedBrowserStatus,
  invalidateResolvedBrowser,
  resolveManagedDownloadConfirmation
} from '../browser/browserController'
import {
  getAllowLocalAddresses,
  getBrowserPreference,
  setAllowLocalAddresses,
  setBrowserPreference
} from '../db/repositories/settingsRepository'
import { allowLocalAddressesPayload, browserPreferencePayload, respondInstallPayload } from './payloadSchemas'

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

  ipcMain.handle(IPC.browserSetup.respondInstall, (_event, payload: unknown) => {
    const parsed = respondInstallPayload.safeParse(payload)
    // An unreadable answer to "may I download a browser?" is not a yes.
    resolveManagedDownloadConfirmation(parsed.success ? parsed.data.accept : false)
    return { ok: true }
  })

  ipcMain.handle(IPC.browserSetup.getPreference, () => getBrowserPreference())

  ipcMain.handle(IPC.browserSetup.setPreference, (_event, payload: unknown) => {
    // Stored, then used as Playwright's `channel` on the next launch — an
    // unchecked value here is a persisted setting that fails at browser
    // launch, far from the call that wrote it.
    const parsed = browserPreferencePayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    setBrowserPreference(parsed.data.preference)
    invalidateResolvedBrowser()
    return { ok: true }
  })

  ipcMain.handle(IPC.browserSetup.getAllowLocalAddresses, () => getAllowLocalAddresses())

  ipcMain.handle(IPC.browserSetup.setAllowLocalAddresses, (_event, payload: unknown) => {
    const parsed = allowLocalAddressesPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    setAllowLocalAddresses(parsed.data.allowed)
    return { ok: true }
  })

  ipcMain.handle(IPC.browserSetup.getStatus, () => getResolvedBrowserStatus())
}
