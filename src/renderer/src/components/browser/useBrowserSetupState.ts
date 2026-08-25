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

/** Push-driven, not click-driven — a background download can start on its own the first time a job action needs a browser, so unlike ExportModal/ImportModal there's no explicit "open" call site. */
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
