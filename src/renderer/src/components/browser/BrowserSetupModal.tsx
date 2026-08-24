import { useState, type ReactElement } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import ProgressBar from '../ui/ProgressBar'
import type { BrowserSetupState } from './useBrowserSetupState'

interface BrowserSetupModalProps {
  state: BrowserSetupState
  dismissed: boolean
  onRetry: () => Promise<void>
  onRespondInstall: (accept: boolean) => Promise<void>
  onDismiss: () => void
}

export default function BrowserSetupModal({
  state,
  dismissed,
  onRetry,
  onRespondInstall,
  onDismiss
}: BrowserSetupModalProps): ReactElement | null {
  const [retrying, setRetrying] = useState(false)
  const [responding, setResponding] = useState(false)

  if (state.status === 'idle' || dismissed) return null

  const handleRetry = async (): Promise<void> => {
    setRetrying(true)
    await onRetry()
    setRetrying(false)
  }

  const handleRespond = async (accept: boolean): Promise<void> => {
    setResponding(true)
    await onRespondInstall(accept)
    setResponding(false)
  }

  // For the confirm prompt, closing the dialog (X, Escape, backdrop) means the same thing as
  // clicking "Not now" — there's no other way to bring the prompt back if it's just hidden, so
  // treat every way of leaving it as a real answer rather than risking a modal stuck open in
  // the background for up to 10 minutes with no way to reopen it.
  const handleClose = state.status === 'confirm' ? () => handleRespond(false) : onDismiss

  return (
    <Modal open title="Setting up a browser" onClose={handleClose}>
      {state.status === 'confirm' && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-muted">
            No installed Chrome or Edge was found on this system. Applyer needs a Chromium browser to search and
            apply to jobs — download one now? This only happens once.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={responding} onClick={() => handleRespond(false)}>
              Not now
            </Button>
            <Button variant="primary" size="sm" loading={responding} onClick={() => handleRespond(true)}>
              Install
            </Button>
          </div>
        </div>
      )}
      {state.status === 'downloading' && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-text-muted">Downloading a browser in the background — this is needed for job search and applications.</p>
          <ProgressBar percent={state.percent} />
          <p className="text-[12px] text-text-muted">
            {state.totalSize ? `${state.percent}% of ${state.totalSize}` : 'Starting…'}
          </p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-text-muted">The browser download failed: {state.message}</p>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" loading={retrying} onClick={handleRetry}>
              Retry
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
