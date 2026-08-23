import { useEffect, useState, type ReactElement } from 'react'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useToast } from '../../components/ui/useToast'
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

export default function IndexedJobsSection(): ReactElement {
  const [current, setCurrent] = useState<IndexedJobsRetention>(INDEXED_JOBS_RETENTION_DEFAULT_DAYS)
  const [draft, setDraft] = useState<string>(toValue(INDEXED_JOBS_RETENTION_DEFAULT_DAYS))
  const [pending, setPending] = useState<IndexedJobsRetention | null>(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => {
    window.api.indexedJobs.getRetention().then((retention) => {
      setCurrent(retention)
      setDraft(toValue(retention))
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
      setDraft(toValue(current))
      toast.error(result.error ?? 'Failed to update retention.')
    }
  }

  const draftRetention = toRetention(draft)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">
        Every job search an agent runs is indexed here, whether or not it was chosen — so you can audit what got
        found and skipped, not just what was queued. Old entries are pruned automatically after this window.
      </p>

      <div className="max-w-xs">
        <Select label="Keep indexed job history for" options={OPTIONS} value={draft} onChange={setDraft} />
      </div>

      {draftRetention === 'unlimited' && (
        <p className="max-w-md text-[12px] text-warning">
          Indexed job history will be kept forever. Since agents can index far more jobs than they ever queue, this
          may grow the database significantly over time.
        </p>
      )}

      {draft !== toValue(current) && (
        <div>
          <Button variant="primary" onClick={() => setPending(draftRetention)}>
            Save
          </Button>
        </div>
      )}

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
        onCancel={() => {
          setPending(null)
          setDraft(toValue(current))
        }}
      />
    </div>
  )
}
