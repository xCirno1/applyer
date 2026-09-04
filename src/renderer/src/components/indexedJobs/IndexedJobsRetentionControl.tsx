import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Dropdown from '../ui/Dropdown'
import ConfirmDialog from '../ui/ConfirmDialog'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import type { IndexedJobsRetention } from '@shared/types/indexedJob'
import { INDEXED_JOBS_RETENTION_DEFAULT_DAYS, INDEXED_JOBS_RETENTION_OPTIONS } from '@shared/constants'

const DAY_OPTIONS = INDEXED_JOBS_RETENTION_OPTIONS.filter((value): value is number => typeof value === 'number')

function toRetention(value: string): IndexedJobsRetention {
  return value === 'unlimited' ? 'unlimited' : Number.parseInt(value, 10)
}

function toValue(retention: IndexedJobsRetention): string {
  return retention === 'unlimited' ? 'unlimited' : String(retention)
}

/**
 * How long an indexed job is kept since it was last seen — a setting for
 * this page's own list, so it lives here (in the "Indexed" tab's toolbar)
 * rather than in Settings. Choosing a value applies immediately behind a
 * confirm, since shortening the window can delete rows right away.
 */
export default function IndexedJobsRetentionControl({ className = '' }: { className?: string }): ReactElement {
  const [current, setCurrent] = useState<IndexedJobsRetention>(INDEXED_JOBS_RETENTION_DEFAULT_DAYS)
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState<IndexedJobsRetention | null>(null)
  const [saving, setSaving] = useState(false)
  const { t } = useTranslation('indexedJobs')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  useEffect(() => {
    window.api.indexedJobs.getRetention().then((retention) => {
      setCurrent(retention)
      setLoaded(true)
    })
  }, [])

  const handleConfirm = async (): Promise<void> => {
    if (pending === null) return
    setSaving(true)
    const result = await window.api.indexedJobs.setRetention(pending)
    setSaving(false)
    setPending(null)
    if (result.ok) {
      setCurrent(pending)
      toast.success(
        result.deletedCount
          ? t('retention.updatedDeleted', { count: result.deletedCount })
          : t('retention.updated')
      )
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('retention.failed'))
    }
  }

  const options = [
    ...DAY_OPTIONS.map((days) => ({ value: String(days), label: t('retention.days', { count: days }) })),
    ...(INDEXED_JOBS_RETENTION_OPTIONS.includes('unlimited')
      ? [{ value: 'unlimited', label: t('retention.unlimited') }]
      : [])
  ]

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Tooltip label={t('retention.tooltip')}>
        <span className="text-[11px] text-text-faint">{t('retention.keepFor')}</span>
      </Tooltip>
      <Dropdown
        size="sm"
        className="w-28"
        ariaLabel={t('retention.ariaLabel')}
        options={options}
        value={toValue(current)}
        onChange={(v) => setPending(toRetention(v))}
        disabled={!loaded || saving}
      />

      <ConfirmDialog
        open={pending !== null}
        title={t('retention.title')}
        message={
          pending === 'unlimited'
            ? t('retention.messageUnlimited')
            : t('retention.messageDays', { count: pending ?? 0 })
        }
        confirmLabel={t('retention.confirm')}
        loading={saving}
        onConfirm={handleConfirm}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
