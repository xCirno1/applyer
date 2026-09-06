import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../ui/useToast'

export type BrowserSetupState =
  | { status: 'idle' }
  | { status: 'confirm' }
  | { status: 'downloading'; percent: number; totalSize: string }
  | { status: 'error'; message: string }

interface BrowserSetupHook {
  state: BrowserSetupState
  dismissed: boolean
  dismiss: () => void
  retry: () => Promise<void>
  /** Answers a pending 'confirm' prompt — true to start the download, false to decline. */
  respondInstall: (accept: boolean) => Promise<void>
}

// Backs `BrowserSetupModal`, shown when a packaged build can't find a system
// Chrome/Edge and needs a managed Chromium at runtime
// (main/browser/browserController.ts's launchWithResolution /
// ensureManagedChromiumDownloaded). Subscribes to the browserSetup:progress
// and browserSetup:status IPC pushes; same push-driven shape as
// CaptchaAlertProvider, but kept as a plain hook (not a context provider)
// since nothing else in the tree needs this state — a background download
// can start on its own the first time a job action needs a browser, so
// unlike ExportModal/ImportModal there's no explicit "open" call site.
//
// The confirm ('Install'/'Not now') step is answered via
// window.api.browserSetup.respondInstall — main-process resolution actually
// blocks on this answer, via confirmManagedDownload()'s gate, before
// starting any download. retryDownload() skips re-confirming, since
// clicking Retry is already explicit consent. The download and error states
// are dismissible without canceling the background work (a toast still
// fires on completion, via the 'ready' status branch above); the confirm
// step is the one exception — dismissing it counts as declining, since
// there'd otherwise be no way to bring a merely-hidden prompt back.
export function useBrowserSetupState(): BrowserSetupHook {
  const [state, setState] = useState<BrowserSetupState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)
  const { t } = useTranslation('settings')
  const toast = useToast()

  useEffect(() => {
    const offProgress = window.api.browserSetup.onProgress((payload) => {
      setDismissed(false)
      setState({ status: 'downloading', percent: payload.percent, totalSize: payload.totalSize })
    })
    const offStatus = window.api.browserSetup.onStatus((payload) => {
      if (payload.status === 'confirm') {
        setDismissed(false)
        setState({ status: 'confirm' })
      } else if (payload.status === 'downloading') {
        setDismissed(false)
        setState((prev) => (prev.status === 'downloading' ? prev : { status: 'downloading', percent: 0, totalSize: '' }))
      } else if (payload.status === 'ready') {
        toast.success(t('browserSetup.complete'))
        setState({ status: 'idle' })
      } else {
        toast.error(`Browser setup failed: ${payload.message}`)
        setState({ status: 'error', message: payload.message })
      }
    })
    return () => {
      offProgress()
      offStatus()
    }
    // Mount-once subscription — `toast` dispatches to a stable context value, so
    // omitting it doesn't risk a stale closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = async (): Promise<void> => {
    setDismissed(false)
    setState({ status: 'downloading', percent: 0, totalSize: '' })
    const result = await window.api.browserSetup.retryDownload()
    if (!result.ok) {
      const message = result.error ?? 'Unknown error'
      toast.error(`Browser setup failed: ${message}`)
      setState({ status: 'error', message })
    }
  }

  const respondInstall = async (accept: boolean): Promise<void> => {
    setState(accept ? { status: 'downloading', percent: 0, totalSize: '' } : { status: 'idle' })
    await window.api.browserSetup.respondInstall(accept)
  }

  return { state, dismissed, dismiss: () => setDismissed(true), retry, respondInstall }
}
