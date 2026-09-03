import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import StorageModeCard from '../../components/onboarding/StorageModeCard'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/ui/Skeleton'
import ProgressBar from '../../components/ui/ProgressBar'
import Tag from '../../components/ui/Tag'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { formatBytes } from '../../lib/formatBytes'
import { useStorageLocation } from './useStorageLocation'
import type { StorageMode } from '@shared/types/profile'
import type { StorageStats } from '@shared/types/storage'
import type { StorageLocationProgressPhase } from '@shared/types/storageLocation'

const PHASE_KEYS = {
  documents: 'storage.phaseDocuments',
  screenshots: 'storage.phaseScreenshots',
  logs: 'storage.phaseLogs',
  database: 'storage.phaseDatabase',
  verifying: 'storage.phaseVerifying',
  finalizing: 'storage.phaseFinalizing'
} as const satisfies Record<StorageLocationProgressPhase, string>

export default function StorageSection(): ReactElement {
  const [currentMode, setCurrentMode] = useState<StorageMode | null>(null)
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [pendingMode, setPendingMode] = useState<StorageMode | null>(null)
  const [changing, setChanging] = useState(false)
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const location = useStorageLocation()
  const locationMigrating = location.ui.phase === 'migrating'
  const locationConnecting = location.ui.phase === 'connecting'
  const locationBusy = locationMigrating || locationConnecting

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
      toast.success(t('storage.changed'))
      refresh()
      handleRefreshStats()
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('storage.changeFailed'))
    }
  }

  const handleConfirmLocation = async (): Promise<void> => {
    await location.confirm()
    handleRefreshStats()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">{t('storage.intro')}</p>

      <div className="flex gap-3">
        <StorageModeCard
          title={t('storage.encrypted')}
          recommended
          description={t('storage.encryptedDescription')}
          selected={currentMode === 'encrypted'}
          disabled={!encryptionAvailable || locationBusy}
          disabledReason={!encryptionAvailable ? t('storage.encryptionUnavailable') : undefined}
          onSelect={() => setPendingMode('encrypted')}
        />
        <StorageModeCard
          title={t('storage.plaintext')}
          description={t('storage.plaintextDescription')}
          selected={currentMode === 'plaintext'}
          disabled={locationBusy}
          onSelect={() => setPendingMode('plaintext')}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
        <h2 className="text-[13px] font-semibold text-text">{t('storage.locationTitle')}</h2>
        <p className="text-[12px] text-text-muted">{t('storage.locationIntro')}</p>
        <div className="flex h-8 items-center gap-2 border border-border-soft px-2">
          <Tag
            label={
              !location.status || location.status.isDefault
                ? t('storage.locationDefault')
                : t('storage.locationCustom')
            }
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-text" title={location.status?.activeRoot}>
            {location.status?.activeRoot ?? t('states.loading', { ns: 'common' })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={changing || locationBusy || !location.status}
            onClick={location.pick}
          >
            {t('storage.change')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={locationConnecting}
            disabled={changing || locationBusy || !location.status}
            onClick={location.pickExisting}
          >
            {t('storage.connectExisting')}
          </Button>
        </div>

        {location.ui.phase === 'migrating' && (
          <div className="flex flex-col gap-1 px-1">
            <span className="text-[12px] text-text-muted">
              {location.ui.progress ? t(PHASE_KEYS[location.ui.progress.phase]) : t('storage.phaseStarting')}
            </span>
            <ProgressBar percent={location.ui.progress?.percent ?? 0} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-text">{t('storage.usage')}</h2>
          <Button size="sm" variant="ghost" loading={statsLoading} onClick={handleRefreshStats}>
            {t('storage.refresh')}
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
                <span className="text-[12px] font-medium text-text">{t('storage.total')}</span>
                <span className="text-[12px] font-medium text-text">{formatBytes(stats.totalBytes)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[12px] text-text-muted sm:grid-cols-3">
              {(
                [
                  ['countJobs', stats.counts.jobs],
                  ['countIndexedJobs', stats.counts.indexedJobs],
                  ['countExclusions', stats.counts.exclusions],
                  ['countCompanyBoards', stats.counts.companyBoards],
                  ['countDocuments', stats.counts.documents],
                  ['countActivityLog', stats.counts.activityLogEntries]
                ] as const
              ).map(([key, count]) => (
                <div key={key} className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate">{t(`storage.${key}`)}</span>
                  <span className="shrink-0 tabular-nums text-text">{count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        title={t('storage.changeTitle')}
        message={
          pendingMode === 'encrypted'
            ? t('storage.changeMessageEncrypted')
            : t('storage.changeMessagePlaintext')
        }
        confirmLabel={t('storage.changeConfirm')}
        loading={changing}
        onConfirm={handleConfirm}
        onCancel={() => setPendingMode(null)}
      />

      <ConfirmDialog
        open={location.ui.phase === 'pendingConfirm'}
        title={t('storage.moveTitle')}
        message={t('storage.moveMessage', {
          path: location.ui.phase === 'pendingConfirm' ? location.ui.path : ''
        })}
        confirmLabel={t('storage.moveConfirm')}
        onConfirm={handleConfirmLocation}
        onCancel={location.cancel}
      />

      <ConfirmDialog
        open={location.ui.phase === 'pendingExistingConfirm'}
        title={t('storage.connectTitle')}
        message={t('storage.connectMessage', {
          path: location.ui.phase === 'pendingExistingConfirm' ? location.ui.path : ''
        })}
        confirmLabel={t('storage.connectConfirm')}
        onConfirm={location.confirmExisting}
        onCancel={location.cancel}
      />
    </div>
  )
}
