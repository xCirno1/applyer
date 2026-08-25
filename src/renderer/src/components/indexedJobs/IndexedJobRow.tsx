import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { IndexedJobRecord } from '@shared/types/indexedJob'
import Tag from '../ui/Tag'
import { useJobsStore } from '../../state/jobsStore'

/**
 * Coarse relative time. Deliberately not Intl.RelativeTimeFormat: the
 * catalog strings here are the abbreviated forms this dense list needs
 * ("3h ago"), which RelativeTimeFormat's `numeric: 'auto'` output ("3 hours
 * ago") is too long for.
 */
function formatRelativeTime(iso: string, t: TFunction<'indexedJobs'>): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return t('row.justNow')
  if (minutes < 60) return t('row.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('row.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('row.daysAgo', { count: days })
}

export default function IndexedJobRow({ item, compact = false }: { item: IndexedJobRecord; compact?: boolean }): ReactElement {
  const { t } = useTranslation('indexedJobs')
  const openJob = useJobsStore((s) => s.openJob)
  const matched = item.matchedJobId !== null

  const handleActivate = (): void => {
    if (matched && item.matchedJobId) openJob(item.matchedJobId)
  }

  const interactiveProps = matched
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: handleActivate,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleActivate()
          }
        }
      }
    : {}

  if (compact) {
    return (
      <div
        {...interactiveProps}
        className={`flex h-7 w-full items-center gap-2 border border-border-soft px-2 text-left outline-none ${
          matched ? 'cursor-pointer hover:border-border focus-visible:border-accent' : ''
        } bg-canvas-raised`}
      >
        <Tag label={matched ? t('row.matched') : t('row.notSelected')} tone={matched ? 'success' : 'neutral'} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text">{item.title}</span>
        <span className="shrink-0 truncate text-[11px] text-text-muted">{item.company}</span>
        {item.matchedScore !== null && (
          <span className="shrink-0 text-[11px] tabular-nums text-text-faint">{item.matchedScore}%</span>
        )}
        <span className="shrink-0 text-[11px] text-text-faint">{formatRelativeTime(item.lastSeenAt, t)}</span>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={t('row.viewListing')}
          title={t('row.viewListing')}
          className="shrink-0 text-[11px] text-text-muted hover:text-text"
        >
          ↗
        </a>
      </div>
    )
  }

  return (
    <div
      {...interactiveProps}
      className={`flex w-full items-start gap-3 border border-border-soft px-2 py-1.5 text-left outline-none ${
        matched ? 'cursor-pointer hover:border-border focus-visible:border-accent' : ''
      } bg-canvas-raised`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-[12px] font-medium leading-tight text-text">{item.title}</span>
          {item.matchedScore !== null && (
            <span className="shrink-0 text-[11px] tabular-nums text-text-faint">{item.matchedScore}%</span>
          )}
        </div>
        <span className="text-[11px] text-text-muted">{item.company}</span>
        {item.location && <span className="text-[11px] text-text-faint">{item.location}</span>}
        <div className="mt-0.5 flex items-center gap-1.5">
          <Tag label={matched ? t('row.matched') : t('row.notSelected')} tone={matched ? 'success' : 'neutral'} />
          {item.source && <span className="text-[11px] text-text-faint">{item.source}</span>}
          <span className="text-[11px] text-text-faint">
            {t('row.seen', { time: formatRelativeTime(item.lastSeenAt, t) })}
          </span>
        </div>
      </div>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 text-[11px] text-text-muted hover:text-text"
      >
        {t('row.viewListingLong')}
      </a>
    </div>
  )
}
