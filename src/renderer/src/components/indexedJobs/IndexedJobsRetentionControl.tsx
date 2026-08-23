import { useEffect, useState, type ReactElement } from 'react'
import Dropdown from '../ui/Dropdown'
import ConfirmDialog from '../ui/ConfirmDialog'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/useToast'
import type { IndexedJobsRetention } from '@shared/types/indexedJob'
import { INDEXED_JOBS_RETENTION_DEFAULT_DAYS } from '@shared/constants'

const OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'unlimited', label: 'Unlimited' }
]

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
  const toast = useToast()

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
          ? `Retention updated — ${result.deletedCount} indexed job${result.deletedCount === 1 ? '' : 's'} older than the window were deleted.`
          : 'Retention updated.'
      )
    } else {
      toast.error(result.error ?? 'Failed to update retention.')
    }
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Tooltip label="How long indexed jobs are kept before being pruned automatically.">
        <span className="text-[11px] text-text-faint">Keep for</span>
      </Tooltip>
      <Dropdown
        size="sm"
        className="w-28"
        ariaLabel="Indexed job retention"
        options={OPTIONS}
        value={toValue(current)}
        onChange={(v) => setPending(toRetention(v))}
        disabled={!loaded || saving}
      />

      <ConfirmDialog
        open={pending !== null}
        title="Change indexed jobs retention"
        message={
          pending === 'unlimited'
            ? 'No indexed jobs will be deleted — history will be kept indefinitely.'
            : `Indexed jobs last seen more than ${pending} days ago will be deleted now.`
        }
        confirmLabel="Change"
        loading={saving}
        onConfirm={handleConfirm}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
