import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import type { StorageLocationStatus } from '@shared/types/storageLocation'
import type { StorageStats } from '@shared/types/storage'

/**
 * Full-screen — not a modal — because it has to gate the entire app before
 * MainShell mounts (same shape as OnboardingFlow, not BrowserSetupModal).
 * Shown by App.tsx whenever storageLocation.getStatus() reports
 * needsRecovery: true — a configured custom storage location is currently
 * unavailable and the app booted into a substitute (default) database.
 * Continuing to use the app silently here risks orphaning real work if the
 * custom location reappears on a later launch, so this blocks until the
 * user makes an explicit choice.
 */
export default function StorageRecoveryFlow({
  status,
  onResolved
}: {
  status: StorageLocationStatus
  onResolved: () => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const errorMessage = useErrorMessage()
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [checkingDefault, setCheckingDefault] = useState(false)
  const [confirmStats, setConfirmStats] = useState<StorageStats | null>(null)
  const [usingDefault, setUsingDefault] = useState(false)
  const toast = useToast()

  const handleRetry = async (): Promise<void> => {
    setRetrying(true)
    setRetryError(null)
    try {
      const result = await window.api.storageLocation.retryCustomLocation()
      if (result.ok) {
        toast.success(t('recovery.reconnected'))
        onResolved()
      } else {
        setRetryError(result.error ? errorMessage(result.error) : t('recovery.stillUnavailable'))
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : t('recovery.retryFailed'))
    } finally {
      setRetrying(false)
    }
  }

  // Fetch current fallback-location stats before showing the confirm dialog,
  // so a returning user with real work already in the fallback DB sees
  // exactly that up front rather than a generic warning.
  const handleUseDefaultClick = async (): Promise<void> => {
    setCheckingDefault(true)
    try {
      const stats = await window.api.settings.getStorageStats()
      setConfirmStats(stats)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('recovery.inspectFailed'))
    } finally {
      setCheckingDefault(false)
    }
  }

  const handleConfirmDefault = async (): Promise<void> => {
    setUsingDefault(true)
    try {
      const result = await window.api.storageLocation.useDefaultLocation()
      if (result.ok) {
        setConfirmStats(null)
        toast.success(t('recovery.usingDefault'))
        onResolved()
      } else {
        toast.error(errorMessage(result.error))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('recovery.useDefaultFailed'))
    } finally {
      setUsingDefault(false)
    }
  }

  // Based on actual row counts, not totalBytes — a freshly-created database
  // file is never exactly 0 bytes (schema, seeded failure tags, WAL
  // overhead), so a byte-size check is true essentially always and would
  // warn about "existing data" even for a location with zero real jobs,
  // documents, indexed jobs, or exclusions.
  const hasExistingData = confirmStats
    ? confirmStats.counts.jobs > 0 ||
      confirmStats.counts.documents > 0 ||
      confirmStats.counts.indexedJobs > 0 ||
      confirmStats.counts.exclusions > 0
    : false

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-canvas-inset p-6">
      <div className="my-auto w-full max-w-2xl border border-border bg-canvas p-5 shadow-pop">
        <h1 className="text-[16px] font-medium text-text">{t('recovery.title')}</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          {status.recoveryReason ? errorMessage(status.recoveryReason) : null}
        </p>
        <p className="mt-3 text-[13px] text-text-muted">{t('recovery.help')}</p>

        <div className="mt-3 border border-border-soft bg-canvas-soft px-2 py-1.5">
          <span className="break-all text-[12px] text-text">{status.unavailableCustomRoot}</span>
        </div>

        {retryError && <p className="mt-2 text-[12px] text-danger">{retryError}</p>}

        <div className="mt-4 flex justify-between gap-2">
          <Button variant="ghost" onClick={handleUseDefaultClick} loading={checkingDefault} disabled={retrying}>
            {t('recovery.useDefault')}
          </Button>
          <Button variant="primary" onClick={handleRetry} loading={retrying} disabled={checkingDefault}>
            {t('recovery.retry')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmStats !== null}
        title={t('recovery.confirmTitle')}
        message={
          hasExistingData
            ? t('recovery.confirmMessageExisting', {
                jobs: confirmStats?.counts.jobs ?? 0,
                documents: confirmStats?.counts.documents ?? 0
              })
            : t('recovery.confirmMessageEmpty')
        }
        confirmLabel={t('recovery.confirmLabel')}
        loading={usingDefault}
        onConfirm={handleConfirmDefault}
        onCancel={() => setConfirmStats(null)}
      />
    </div>
  )
}
