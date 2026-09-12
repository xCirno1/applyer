import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import {
  disconnectAttachedBrowser,
  ensureManagedChromiumDownloaded,
  getResolvedBrowserStatus,
  invalidateResolvedBrowser,
  probeRemoteBrowser,
  RemoteBrowserUnreachableError,
  resolveManagedDownloadConfirmation
} from '../browser/browserController'
import {
  getAllowLocalAddresses,
  getBrowserPreference,
  getRemoteBrowserSettings,
  setAllowLocalAddresses,
  setBrowserPreference,
  setRemoteBrowserSettings
} from '../db/repositories/settingsRepository'
import {
  allowLocalAddressesPayload,
  browserPreferencePayload,
  remoteBrowserEndpointPayload,
  remoteBrowserPayload,
  respondInstallPayload
} from './payloadSchemas'

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

  ipcMain.handle(IPC.browserSetup.getRemoteBrowser, () => getRemoteBrowserSettings())

  ipcMain.handle(IPC.browserSetup.setRemoteBrowser, async (_event, payload: unknown) => {
    // Same reasoning as setPreference: the endpoint is stored now and handed to
    // Playwright at the next interactive launch, so it is validated here rather
    // than failing inside an agent's tool call later.
    const parsed = remoteBrowserPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, error: appError('invalidRemoteBrowserEndpoint') }
    const previous = getRemoteBrowserSettings()
    setRemoteBrowserSettings(parsed.data)
    // The shared connection is kept across jobs so the browser's permission prompt is
    // answered once; turning attaching off, or pointing it elsewhere, is the one time
    // that connection should not outlive the setting that opened it.
    if (!parsed.data.enabled || parsed.data.endpoint !== previous.endpoint) await disconnectAttachedBrowser()
    return { ok: true }
  })

  ipcMain.handle(IPC.browserSetup.testRemoteBrowser, async (_event, payload: unknown) => {
    const parsed = remoteBrowserEndpointPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, error: appError('invalidRemoteBrowserEndpoint') }
    try {
      return { ok: true, probe: await probeRemoteBrowser(parsed.data.endpoint) }
    } catch (err) {
      if (err instanceof RemoteBrowserUnreachableError) {
        return { ok: false, error: appError('remoteBrowserUnreachable', { endpoint: err.endpoint, message: err.detail }) }
      }
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.browserSetup.getStatus, () => getResolvedBrowserStatus())
}
