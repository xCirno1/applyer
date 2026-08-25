import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('settings')
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
    <Modal open title={t('browserSetup.title')} onClose={handleClose}>
      {state.status === 'confirm' && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-muted">{t('browserSetup.confirm')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={responding} onClick={() => handleRespond(false)}>
              {t('browserSetup.notNow')}
            </Button>
            <Button variant="primary" size="sm" loading={responding} onClick={() => handleRespond(true)}>
              {t('browserSetup.install')}
            </Button>
          </div>
        </div>
      )}
      {state.status === 'downloading' && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-text-muted">{t('browserSetup.downloading')}</p>
          <ProgressBar percent={state.percent} />
          <p className="text-[12px] text-text-muted">
            {state.totalSize
              ? t('browserSetup.progress', { percent: state.percent, total: state.totalSize })
              : t('storage.phaseStarting')}
          </p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-text-muted">
            {t('browserSetup.failed', { message: state.message })}
          </p>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" loading={retrying} onClick={handleRetry}>
              {t('recovery.retry')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
