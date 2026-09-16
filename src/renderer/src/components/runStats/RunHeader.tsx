import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import ConfirmDialog from '../ui/ConfirmDialog'
import Dropdown from '../ui/Dropdown'
import Tag from '../ui/Tag'
import Tooltip from '../ui/Tooltip'
import { useFormatters } from '../../i18n/format'
import { formatDuration, runDisplayName } from './runFormat'
import type { RunRecord } from '@shared/types/run'
import { RUN_LABEL_MAX_LENGTH } from '@shared/types/run'

/**
 * The Runs screen's control strip: which run is showing, whether it is in
 * progress and for how long, and the Start/Stop, rename and delete actions.
 *
 * Start and Stop are one button that flips, because only one run can be in
 * progress and starting another while one is open would silently end it
 * (the repository does that to keep the invariant). The elapsed figure ticks
 * once a second from the run's own start stamp rather than counting locally,
 * so it survives a remount and agrees with the main process.
 *
 * The run picker lists the history a page at a time (`runsStore`), with a
 * "show older" row under the list while there are runs it does not hold
 * yet, so the oldest run stays reachable however many there are.
 */
export default function RunHeader({
  active,
  selected,
  history,
  historyTotal,
  historyLoadingMore,
  acting,
  onSelect,
  onLoadMore,
  onStart,
  onStop,
  onRename,
  onDelete
}: {
  active: RunRecord | null
  selected: RunRecord | null
  history: RunRecord[]
  historyTotal: number
  historyLoadingMore: boolean
  acting: boolean
  onSelect: (runId: string) => void
  onLoadMore: () => void
  onStart: () => void
  onStop: () => void
  onRename: (runId: string, label: string | null) => Promise<boolean>
  onDelete: (runId: string) => Promise<boolean>
}): ReactElement {
  const { t } = useTranslation('runs')
  const format = useFormatters()
  const defaultName = (sequence: number): string => t('header.defaultName', { sequence })

  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!selected) return
    const tick = (): void => {
      const start = Date.parse(selected.startedAt)
      const end = selected.endedAt ? Date.parse(selected.endedAt) : Date.now()
      setElapsed(Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0)
    }
    tick()
    if (selected.endedAt) return
    const handle = setInterval(tick, 1000)
    return () => clearInterval(handle)
  }, [selected])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const beginRename = (): void => {
    if (!selected) return
    setDraft(selected.label ?? '')
    setEditing(true)
  }
  const commitRename = async (): Promise<void> => {
    if (!selected) return
    setEditing(false)
    const next = draft.trim()
    if (next === (selected.label ?? '')) return
    await onRename(selected.id, next.length > 0 ? next : null)
  }

  const options = history.map((run) => ({
    value: run.id,
    label: `${runDisplayName(run, defaultName)}${run.endedAt ? '' : ` (${t('header.current')})`} · ${format.dateTime(run.startedAt)}`
  }))
  // The run being shown is always in the list, even if the history page
  // has not caught up with a run that started a moment ago.
  if (selected && !options.some((option) => option.value === selected.id)) {
    options.unshift({ value: selected.id, label: runDisplayName(selected, defaultName) })
  }

  const inProgress = selected !== null && selected.endedAt === null
  const older = Math.max(0, historyTotal - history.length)

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-soft bg-canvas px-3">
      <span className="text-[12px] font-medium text-text">{t('title')}</span>

      {options.length > 0 && (
        <Dropdown
          size="sm"
          className="w-64"
          ariaLabel={t('header.pick')}
          placeholder={t('header.pick')}
          options={options}
          value={selected?.id ?? ''}
          onChange={onSelect}
          footer={
            older > 0 ? (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={historyLoadingMore}
                className="flex h-7 w-full cursor-pointer items-center gap-1.5 px-2.5 text-left text-[12px] text-text-muted hover:bg-canvas-soft hover:text-text disabled:cursor-default disabled:opacity-50"
              >
                {historyLoadingMore && <Spinner className="h-3 w-3" />}
                {t('header.showOlder', { count: older })}
              </button>
            ) : null
          }
        />
      )}

      {selected && !editing && (
        <button
          type="button"
          onClick={beginRename}
          title={t('header.rename')}
          aria-label={t('header.rename')}
          className="flex h-6 w-6 cursor-pointer items-center justify-center text-text-faint hover:text-text"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {selected && editing && (
        <input
          autoFocus
          value={draft}
          maxLength={RUN_LABEL_MAX_LENGTH}
          placeholder={t('header.namePlaceholder')}
          aria-label={t('header.nameLabel')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="h-6 w-48 border border-border bg-canvas-soft px-2 text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
      )}

      {selected && (
        <>
          <Tag label={inProgress ? t('header.inProgress') : t('header.ended')} tone={inProgress ? 'success' : 'neutral'} />
          <span className="text-[11px] tabular-nums text-text-muted" title={t('header.elapsed')}>
            {formatDuration(elapsed)}
          </span>
          <span className="text-[11px] text-text-faint">{t('header.events', { count: selected.eventCount })}</span>
        </>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {selected && !inProgress && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={acting}
            title={t('header.delete')}
            aria-label={t('header.delete')}
            className="flex h-6 w-6 cursor-pointer items-center justify-center text-text-faint hover:text-danger disabled:cursor-default disabled:opacity-50"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {active ? (
          <Button size="sm" variant="secondary" loading={acting} onClick={onStop}>
            {t('header.stop')}
          </Button>
        ) : (
          <Tooltip label={t('header.startHint')}>
            <Button size="sm" variant="primary" loading={acting} onClick={onStart}>
              {t('header.start')}
            </Button>
          </Tooltip>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('header.deleteTitle')}
        message={t('header.deleteMessage')}
        confirmLabel={t('header.delete')}
        danger
        loading={acting}
        onConfirm={() => {
          if (!selected) return
          void onDelete(selected.id).then(() => setConfirmDelete(false))
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
