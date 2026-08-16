import { useEffect, useState, type ReactElement } from 'react'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/ui/Skeleton'
import Tag from '../../components/ui/Tag'
import type { ActivityLevel, ActivityLogEntry } from '@shared/types/activity'

const PAGE_SIZE = 50

const LEVEL_OPTIONS: { value: ActivityLevel | ''; label: string }[] = [
  { value: '', label: 'All levels' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'debug', label: 'Debug' }
]

const LEVEL_TONE: Record<ActivityLevel, 'neutral' | 'warning' | 'danger'> = {
  debug: 'neutral',
  info: 'neutral',
  warn: 'warning',
  error: 'danger'
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export default function LogsPage(): ReactElement {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [level, setLevel] = useState<ActivityLevel | ''>('')

  const fetchPage = async (offset: number, replace: boolean): Promise<void> => {
    setLoading(true)
    const result = await window.api.logs.list({
      level: level || undefined,
      limit: PAGE_SIZE,
      offset
    })
    setEntries((prev) => (replace ? result.entries : [...prev, ...result.entries]))
    setTotal(result.total)
    setLoading(false)
    setLoadedOnce(true)
  }

  useEffect(() => {
    // Standard fetch-on-mount/filter-change: fetchPage's own setLoading(true)
    // runs before its first await, which the lint rule reads as a
    // synchronous setState — intentional here, not a derived-state smell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage(0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level])

  return (
    <div className="flex h-full flex-col bg-canvas-inset">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-soft bg-canvas px-3">
        <span className="text-[12px] font-medium text-text">Activity Log</span>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as ActivityLevel | '')}
          className="h-6 cursor-pointer border border-border bg-canvas-soft px-1.5 text-[12px] text-text outline-none focus:border-accent"
        >
          {LEVEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[11px] text-text-faint">{total} entries</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!loadedOnce && (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        )}

        {loadedOnce && entries.length === 0 && <p className="text-[12px] text-text-faint">No activity yet.</p>}

        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border-soft align-top">
                <td className="whitespace-nowrap py-1.5 pr-3 text-text-faint">{formatTime(entry.createdAt)}</td>
                <td className="py-1.5 pr-3">
                  <Tag label={entry.level} tone={LEVEL_TONE[entry.level]} />
                </td>
                <td className="py-1.5 pr-3 text-text">
                  {entry.message}
                  {entry.meta && (
                    <span className="ml-1 text-text-faint">{JSON.stringify(entry.meta)}</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 text-text-faint">{entry.jobId ? entry.jobId.slice(0, 8) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {loadedOnce && entries.length < total && (
          <div className="mt-2 flex justify-center">
            <Button size="sm" variant="ghost" loading={loading} onClick={() => fetchPage(entries.length, false)}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
