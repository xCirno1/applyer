import { useCallback, useEffect, useState, type ReactElement } from 'react'
import StorageModeCard from '../../components/onboarding/StorageModeCard'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { formatBytes } from '../../lib/formatBytes'
import type { StorageMode } from '@shared/types/profile'
import type { StorageStats } from '@shared/types/storage'

export default function StorageSection(): ReactElement {
  const [currentMode, setCurrentMode] = useState<StorageMode | null>(null)
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [pendingMode, setPendingMode] = useState<StorageMode | null>(null)
  const [changing, setChanging] = useState(false)
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const toast = useToast()

  const refresh = (): void => {
    window.api.onboarding.getStatus().then((status) => {
      setCurrentMode(status.storageMode)
      setEncryptionAvailable(status.encryptionAvailable)
    })
  }

  const loadStats = useCallback((): void => {
    window.api.settings.getStorageStats().then((result) => {
      setStats(result)
      setStatsLoading(false)
    })
  }, [])

  const handleRefreshStats = (): void => {
    setStatsLoading(true)
    loadStats()
  }

  useEffect(refresh, [])
  useEffect(loadStats, [loadStats])

  const handleConfirm = async (): Promise<void> => {
    if (!pendingMode) return
    setChanging(true)
    const result = await window.api.settings.changeStorageMode(pendingMode)
    setChanging(false)
    setPendingMode(null)
    if (result.ok) {
      toast.success('Storage mode changed — your profile and documents were re-written in the new format.')
      refresh()
      handleRefreshStats()
    } else {
      toast.error(result.error ?? 'Failed to change storage mode.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">
        Everything stays on this computer either way — this only changes how it&apos;s stored on disk. Changing this
        re-writes your existing profile and documents in the new format.
      </p>

      <div className="flex gap-3">
        <StorageModeCard
          title="Encrypted"
          recommended
          description="Locked using this computer's built-in secure storage — only readable on this device, by your user account."
          selected={currentMode === 'encrypted'}
          disabled={!encryptionAvailable}
          disabledReason="Not available on this system (no OS keychain detected)."
          onSelect={() => setPendingMode('encrypted')}
        />
        <StorageModeCard
          title="Plain text"
          description="Stored as regular, readable files. Simpler to back up or inspect, but readable by anyone with access to this computer's files."
          selected={currentMode === 'plaintext'}
          onSelect={() => setPendingMode('plaintext')}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-text">Usage</h2>
          <Button size="sm" variant="ghost" loading={statsLoading} onClick={handleRefreshStats}>
            Refresh
          </Button>
        </div>

        {!stats && (
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        )}

        {stats && (
          <>
            <div className="flex flex-col divide-y divide-border-soft border border-border-soft">
              {stats.breakdown.map((item) => {
                const pct = stats.totalBytes > 0 ? (item.bytes / stats.totalBytes) * 100 : 0
                return (
                  <div key={item.key} className="flex h-7 items-center gap-2 px-2">
                    <span className="w-24 shrink-0 text-[12px] text-text">{item.label}</span>
                    <div className="h-1.5 flex-1 bg-canvas-inset">
                      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-[12px] text-text-muted">
                      {formatBytes(item.bytes)}
                    </span>
                  </div>
                )
              })}
              <div className="flex h-7 items-center justify-between bg-canvas-soft px-2">
                <span className="text-[12px] font-medium text-text">Total</span>
                <span className="text-[12px] font-medium text-text">{formatBytes(stats.totalBytes)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[12px] text-text-muted sm:grid-cols-3">
              <span>Jobs · {stats.counts.jobs}</span>
              <span>Indexed jobs · {stats.counts.indexedJobs}</span>
              <span>Exclusions · {stats.counts.exclusions}</span>
              <span>Documents · {stats.counts.documents}</span>
              <span>Activity log entries · {stats.counts.activityLogEntries}</span>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        title="Change storage mode"
        message={`This will re-write your profile and uploaded documents in ${pendingMode === 'encrypted' ? 'encrypted' : 'plain text'} form. It may take a moment.`}
        confirmLabel="Change"
        loading={changing}
        onConfirm={handleConfirm}
        onCancel={() => setPendingMode(null)}
      />
    </div>
  )
}
