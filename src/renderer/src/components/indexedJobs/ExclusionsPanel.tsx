import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import TextField from '../ui/TextField'
import ConfirmDialog from '../ui/ConfirmDialog'
import Tag from '../ui/Tag'
import Skeleton from '../ui/Skeleton'
import MetaList from '../ui/MetaList'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useFormatters } from '../../i18n/format'
import type { ExclusionRecord } from '@shared/types/exclusion'

const PAGE_SIZE = 20

/**
 * URLs the search index/agent will never surface or queue again — lives on
 * the Indexed Jobs page (as the "Excluded" tab) rather than Settings, since
 * it's really a view onto the same job-discovery pipeline that page audits.
 */
export default function ExclusionsPanel(): ReactElement {
  const [exclusions, setExclusions] = useState<ExclusionRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [url, setUrl] = useState('')
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const { t } = useTranslation('indexedJobs')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const format = useFormatters()

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

  // This panel stays mounted-but-hidden while the Indexed tab is showing, so
  // without this it would keep displaying whatever it fetched on first
  // mount forever — never picking up an exclusion added elsewhere (the
  // board's Exclude action, a bulk exclude, or the agent's exclude_job tool).
  useEffect(() => window.api.exclusions.onChanged(() => load(0)), [])

  const handleAdd = async (): Promise<void> => {
    if (!url.trim()) return
    setAdding(true)
    const result = await window.api.exclusions.add(url.trim(), reason.trim() || undefined)
    setAdding(false)
    if (result.ok) {
      setUrl('')
      setReason('')
      toast.success(t('exclusions.added'))
      load(0)
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('exclusions.addFailed'))
    }
  }

  const handleRemove = async (): Promise<void> => {
    if (!pendingRemoveId) return
    setRemoving(true)
    await window.api.exclusions.remove(pendingRemoveId)
    setRemoving(false)
    setExclusions((prev) => prev.filter((e) => e.id !== pendingRemoveId))
    setTotal((prevTotal) => Math.max(0, prevTotal - 1))
    setPendingRemoveId(null)
    toast.success(t('exclusions.removed'))
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <p className="text-[13px] text-text-muted">
        {t('exclusions.intro')}
      </p>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label={t('exclusions.urlLabel')}
            placeholder={t('exclusions.urlPlaceholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
        </div>
        <div className="flex-1">
          <TextField
            label={t('exclusions.reasonLabel')}
            placeholder={t('exclusions.reasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
          />
        </div>
        <Button onClick={handleAdd} loading={adding} disabled={!url.trim()}>
          {t('exclusions.add')}
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
          <p className="p-2 text-[12px] text-text-faint">{t('exclusions.empty')}</p>
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
                <Tag label={e.excludedBy === 'agent' ? t('exclusions.byAgent') : t('exclusions.byYou')} tone="neutral" />
              </div>
              <MetaList
                className="text-[11px] text-text-faint"
                items={[
                  { key: 'url', value: e.url, grow: true, title: e.url },
                  e.reason && { key: 'reason', value: e.reason },
                  { key: 'date', value: format.date(e.createdAt) }
                ]}
              />
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPendingRemoveId(e.id)}>
              {t('exclusions.remove')}
            </Button>
          </div>
        ))}
        {loadedOnce && exclusions.length < total && (
          <div className="mt-1 flex justify-center">
            <Button size="sm" variant="ghost" loading={loading} onClick={() => load(exclusions.length)}>
              {t('actions.loadMore', { ns: 'common' })}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingRemoveId !== null}
        title={t('exclusions.removeTitle')}
        message={t('exclusions.removeMessage')}
        confirmLabel={t('exclusions.remove')}
        loading={removing}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemoveId(null)}
      />
    </div>
  )
}
