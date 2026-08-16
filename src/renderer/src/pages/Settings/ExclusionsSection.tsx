import { useEffect, useState, type ReactElement } from 'react'
import Button from '../../components/ui/Button'
import TextField from '../../components/ui/TextField'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Tag from '../../components/ui/Tag'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import type { ExclusionRecord } from '@shared/types/exclusion'

const PAGE_SIZE = 20

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString()
}

export default function ExclusionsSection(): ReactElement {
  const [exclusions, setExclusions] = useState<ExclusionRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [url, setUrl] = useState('')
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const toast = useToast()

  const load = async (offset: number): Promise<void> => {
    setLoading(true)
    const result = await window.api.exclusions.list({ limit: PAGE_SIZE, offset })
    setLoading(false)
    setLoadedOnce(true)
    setExclusions((prev) => (offset === 0 ? result.exclusions : [...prev, ...result.exclusions]))
    setTotal(result.total)
  }

  useEffect(() => {
    let cancelled = false
    window.api.exclusions.list({ limit: PAGE_SIZE, offset: 0 }).then((result) => {
      if (cancelled) return
      setExclusions(result.exclusions)
      setTotal(result.total)
      setLoadedOnce(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleAdd = async (): Promise<void> => {
    if (!url.trim()) return
    setAdding(true)
    const result = await window.api.exclusions.add(url.trim(), reason.trim() || undefined)
    setAdding(false)
    if (result.ok) {
      setUrl('')
      setReason('')
      toast.success('Added to the exclusion list.')
      load(0)
    } else {
      toast.error(result.error ?? 'Failed to add exclusion.')
    }
  }

  const handleRemove = async (): Promise<void> => {
    if (!pendingRemoveId) return
    setRemoving(true)
    await window.api.exclusions.remove(pendingRemoveId)
    setRemoving(false)
    setExclusions((prev) => prev.filter((e) => e.id !== pendingRemoveId))
    setTotal((t) => Math.max(0, t - 1))
    setPendingRemoveId(null)
    toast.success('Removed from the exclusion list — it can be found by search and queued again.')
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">
        URLs on this list are never returned by a job search and can't be queued, whether you or the agent tries to.
        Exclude a job from its detail view on the board, or add one directly here.
      </p>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label="Job posting URL"
            placeholder="https://example.com/careers/123"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
        </div>
        <div className="flex-1">
          <TextField
            label="Reason (optional)"
            placeholder="e.g. not remote"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
        </div>
        <Button onClick={handleAdd} loading={adding} disabled={!url.trim()}>
          Add
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        {!loadedOnce && (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        )}
        {loadedOnce && exclusions.length === 0 && (
          <p className="p-2 text-[12px] text-text-faint">Nothing excluded yet.</p>
        )}
        {exclusions.map((e) => (
          <div
            key={e.id}
            className="flex items-center gap-2 border border-border-soft bg-canvas-soft px-2 py-1.5 text-[12px]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-text" title={e.url}>
                  {e.title ? `${e.title}${e.company ? ` @ ${e.company}` : ''}` : e.url}
                </span>
                <Tag label={e.excludedBy === 'agent' ? 'agent' : 'you'} tone="neutral" />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
                <span className="truncate" title={e.url}>
                  {e.url}
                </span>
                {e.reason && <span>· {e.reason}</span>}
                <span className="shrink-0">· {formatDate(e.createdAt)}</span>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPendingRemoveId(e.id)}>
              Remove
            </Button>
          </div>
        ))}
        {loadedOnce && exclusions.length < total && (
          <div className="mt-1 flex justify-center">
            <Button size="sm" variant="ghost" loading={loading} onClick={() => load(exclusions.length)}>
              Load more
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingRemoveId !== null}
        title="Remove exclusion"
        message="This job posting will be searchable and queueable again."
        confirmLabel="Remove"
        loading={removing}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemoveId(null)}
      />
    </div>
  )
}
