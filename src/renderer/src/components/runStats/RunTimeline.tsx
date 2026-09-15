import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import Skeleton from '../ui/Skeleton'
import { useFormatters } from '../../i18n/format'
import { callIpc } from '../../lib/ipcCall'
import { describeRunEvent, runEventTone } from './describeRunEvent'
import { RUN_EVENT_KINDS, type RunEventKind, type RunEventView } from '@shared/types/run'

const PAGE_SIZE = 50

/**
 * The run's events newest first, a page at a time. Tool calls are hidden by
 * default: every search or fill is also a tool call, so showing them doubles
 * the list with rows that say nothing the neighbouring row does not.
 *
 * `version` is the run's event count as the parent knows it; a change means
 * the main process pushed new events, and the list is re-read from the top
 * so the newest rows appear. Pages loaded further down are dropped by that
 * refetch, which is accepted: the user is looking at the top of a live list.
 */
export default function RunTimeline({ runId, version }: { runId: string; version: number }): ReactElement {
  const { t } = useTranslation('runs')
  const { t: tCommon } = useTranslation('common')
  const format = useFormatters()
  const [items, setItems] = useState<RunEventView[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [showToolCalls, setShowToolCalls] = useState(false)

  const kinds: RunEventKind[] | undefined = showToolCalls ? undefined : RUN_EVENT_KINDS.filter((kind) => kind !== 'tool_call')

  const fetchPage = async (offset: number, replace: boolean): Promise<void> => {
    setLoading(true)
    const result = await callIpc(
      'runs.listEvents',
      () => window.api.runs.listEvents({ runId, kinds, limit: PAGE_SIZE, offset }),
      { items: [], total: 0 }
    )
    setItems((prev) => (replace ? result.items : [...prev, ...result.items]))
    setTotal(result.total)
    setLoading(false)
    setLoadedFor(runId)
  }

  useEffect(() => {
    // Fetch on mount and whenever the run, the filter or the event count
    // changes; the setLoading before the first await is the ordinary
    // fetch-on-change shape, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage(0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, version, showToolCalls])

  const loaded = loadedFor === runId

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 pb-1.5 text-[11px] text-text-faint">
        <span>{t('timeline.count', { count: total })}</span>
        <div className="ml-auto">
          <Checkbox label={t('timeline.showToolCalls')} checked={showToolCalls} onChange={setShowToolCalls} />
        </div>
      </div>

      {!loaded && (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      )}

      {loaded && items.length === 0 && <p className="text-[12px] text-text-faint">{t('timeline.empty')}</p>}

      {loaded && items.length > 0 && (
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {items.map((event) => {
              const tone = runEventTone(event)
              const toneClass =
                tone === 'danger'
                  ? 'text-danger'
                  : tone === 'warning'
                    ? 'text-warning'
                    : tone === 'success'
                      ? 'text-success'
                      : 'text-text'
              return (
                <tr key={event.id} className="border-b border-border-soft align-top">
                  <td className="whitespace-nowrap py-1 pr-3 tabular-nums text-text-faint">{format.time(event.createdAt)}</td>
                  <td className={`py-1 ${toneClass}`}>{describeRunEvent(event, t)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {loaded && items.length < total && (
        <div className="mt-2 flex justify-center">
          <Button size="sm" variant="ghost" loading={loading} onClick={() => fetchPage(items.length, false)}>
            {tCommon('actions.loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
