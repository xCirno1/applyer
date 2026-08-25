import { useState, type ReactElement } from 'react'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useToast } from '../../components/ui/useToast'
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
        toast.success('Reconnected to your storage location.')
        onResolved()
      } else {
        setRetryError(result.error ?? 'Still not available.')
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Could not retry the storage location.')
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
      toast.error(err instanceof Error ? err.message : 'Could not inspect the default storage location.')
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
        toast.success('Using the default storage location.')
        onResolved()
      } else {
        toast.error(result.error ?? 'Failed to switch to the default location.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to switch to the default location.')
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
        <h1 className="text-[16px] font-medium text-text">Your storage location isn&apos;t available</h1>
        <p className="mt-1 text-[13px] text-text-muted">{status.recoveryReason}</p>
        <p className="mt-3 text-[13px] text-text-muted">
          Reconnect the drive or folder, then retry — or use the default location for now. You can switch back once
          your custom location is available again.
        </p>

        <div className="mt-3 border border-border-soft bg-canvas-soft px-2 py-1.5">
          <span className="break-all text-[12px] text-text">{status.unavailableCustomRoot}</span>
        </div>

        {retryError && <p className="mt-2 text-[12px] text-danger">{retryError}</p>}

        <div className="mt-4 flex justify-between gap-2">
          <Button variant="ghost" onClick={handleUseDefaultClick} loading={checkingDefault} disabled={retrying}>
            Use the default location instead
          </Button>
          <Button variant="primary" onClick={handleRetry} loading={retrying} disabled={checkingDefault}>
            Retry
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmStats !== null}
        title="Use the default storage location?"
        message={
          hasExistingData
            ? `The default location already has data in it — ${confirmStats?.counts.jobs ?? 0} jobs, ${confirmStats?.counts.documents ?? 0} documents. Using it now continues from that data; it won't merge with your custom location. You can switch back once your custom location is available again.`
            : "This uses the default location until you reconnect your custom location and retry, or pick a new one in Settings."
        }
        confirmLabel="Use Default"
        loading={usingDefault}
        onConfirm={handleConfirmDefault}
        onCancel={() => setConfirmStats(null)}
      />
    </div>
  )
}
