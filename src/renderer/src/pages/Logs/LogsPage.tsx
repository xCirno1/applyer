import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/ui/Skeleton'
import Tag from '../../components/ui/Tag'
import Dropdown from '../../components/ui/Dropdown'
import { useFormatters } from '../../i18n/format'
import type { ActivityLevel, ActivityLogEntry } from '@shared/types/activity'

const PAGE_SIZE = 50

const LEVEL_TONE: Record<ActivityLevel, 'neutral' | 'warning' | 'danger'> = {
  debug: 'neutral',
  info: 'neutral',
  warn: 'warning',
  error: 'danger'
}

export default function LogsPage(): ReactElement {
  const { t } = useTranslation('workspace')
  const format = useFormatters()
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

  const levelOptions: { value: ActivityLevel | ''; label: string }[] = [
    { value: '', label: t('logs.allLevels') },
    { value: 'info', label: t('logs.info') },
    { value: 'warn', label: t('logs.warn') },
    { value: 'error', label: t('logs.error') },
    { value: 'debug', label: t('logs.debug') }
  ]

  return (
    <div className="flex h-full flex-col bg-canvas-inset">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-soft bg-canvas px-3">
        <span className="text-[12px] font-medium text-text">{t('logs.title')}</span>
        <Dropdown
          size="sm"
          className="w-32"
          ariaLabel={t('logs.levelLabel')}
          options={levelOptions}
          value={level}
          onChange={(v) => setLevel(v as ActivityLevel | '')}
        />
        <span className="ml-auto text-[11px] text-text-faint">{t('logs.entries', { count: total })}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!loadedOnce && (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        )}

        {loadedOnce && entries.length === 0 && <p className="text-[12px] text-text-faint">{t('logs.empty')}</p>}

        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border-soft align-top">
                <td className="whitespace-nowrap py-1.5 pr-3 text-text-faint">{format.dateTime(entry.createdAt)}</td>
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
              {t('actions.loadMore', { ns: 'common' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
