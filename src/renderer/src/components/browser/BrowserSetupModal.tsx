import { useState, type ReactElement } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import ProgressBar from '../ui/ProgressBar'
import type { BrowserSetupState } from './useBrowserSetupState'

interface BrowserSetupModalProps {
  state: BrowserSetupState
  dismissed: boolean
  onRetry: () => Promise<void>
  onDismiss: () => void
}

export default function BrowserSetupModal({
  state,
  dismissed,
  onRetry,
  onDismiss
}: BrowserSetupModalProps): ReactElement | null {
  const [retrying, setRetrying] = useState(false)

  if (state.status === 'idle' || dismissed) return null

  const handleRetry = async (): Promise<void> => {
    setRetrying(true)
    await onRetry()
    setRetrying(false)
  }

  return (
    <Modal open title="Setting up a browser" onClose={onDismiss}>
      {state.status === 'downloading' && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-text-muted">
            No installed Chrome or Edge was found, so a one-time browser download is running in the background —
            this is needed for job search and applications.
          </p>
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
