import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobStatus } from '@shared/types/job'
import { useJobsStore } from '../../state/jobsStore'
import { usePendingCaptchaAlerts } from '../../providers/CaptchaAlertContext'
import Tag from '../ui/Tag'
import DonutChart from '../ui/DonutChart'
import MetaList from '../ui/MetaList'
import Skeleton from '../ui/Skeleton'
import { useStagesStore } from '../../state/stagesStore'
import { STAGE_FILTER_ALL, STAGE_FILTER_NONE, stageCountRows } from '../../state/stagesStoreLogic'
import { useStageLabel } from './useStageLabel'

// The workspace's left sidebar — a `DonutChart` + legend of per-status job
// counts/share, and a "needs verification" list (from `CaptchaAlertContext`'s
// `pending`, clickable to open that job's detail modal via `jobsStore`). The
// analogue of a persistent analysis rail alongside the board, rather than
// requiring a separate page.

const STATUS_ORDER: JobStatus[] = ['queued', 'filled', 'submitted', 'failed']

/** Same status → color mapping `JobCard`'s left-border accent uses, so the
 * chart reads as the same language as the board it summarizes. */
const STATUS_STROKE: Record<JobStatus, string> = {
  queued: 'stroke-accent',
  filled: 'stroke-warning',
  submitted: 'stroke-success',
  failed: 'stroke-danger'
}

const STATUS_SWATCH: Record<JobStatus, string> = {
  queued: 'bg-accent',
  filled: 'bg-warning',
  submitted: 'bg-success',
  failed: 'bg-danger'
}

/**
 * Left rail: a read-only summary of the job pipeline (per-status totals,
 * live from the same store the board columns fetch from) plus jobs currently
 * blocked on a verification challenge. The analogue of the reference
 * design's bot-analysis sidebar — a persistent glance at the state of the
 * work, alongside the board rather than requiring a separate page.
 *
 * Between the two, the Submitted stages: how many submitted applications
 * sit in each stage (and with none), counted across every Submitted job
 * rather than the board's current page. Clicking a row filters the
 * Submitted column to that stage, and clicking the active one again shows
 * every stage.
 */
export default function PipelineOverview({ onHide }: { onHide: () => void }): ReactElement {
  const { t } = useTranslation('board')
  const columns = useJobsStore((s) => s.columns)
  const openJob = useJobsStore((s) => s.openJob)
  const pendingAlerts = usePendingCaptchaAlerts()
  const stages = useStagesStore((s) => s.stages)
  const stageCounts = useStagesStore((s) => s.counts)
  const stagesLoaded = useStagesStore((s) => s.loadedOnce)
  const stageFilter = useJobsStore((s) => s.filters.stage)
  const setFilters = useJobsStore((s) => s.setFilters)
  const stageLabel = useStageLabel()
  const { rows: stageRows, total: submittedTotal } = stageCountRows(stages, stageCounts)

  const totalTracked = STATUS_ORDER.reduce((sum, status) => sum + columns[status].total, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center border-b border-border-soft bg-canvas px-2">
        <span className="text-[12px] font-medium text-text">{t('overview.title')}</span>
        <button
          onClick={onHide}
          title={t('overview.hide')}
          aria-label={t('overview.hide')}
          className="ml-auto flex h-5 w-5 cursor-pointer items-center justify-center text-text-faint hover:text-text"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M8 2.5L4.5 6L8 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border-soft px-3 py-2.5">
          <span className="text-2xs font-medium uppercase tracking-wide text-text-faint">{t('overview.pipeline')}</span>
          <div className="mt-2 flex items-center gap-3">
            <DonutChart
              size={84}
              thickness={11}
              centerLabel={String(totalTracked)}
              centerSublabel={t('overview.jobs')}
              segments={STATUS_ORDER.map((status) => ({
                key: status,
                value: columns[status].total,
                strokeClassName: STATUS_STROKE[status]
              }))}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {STATUS_ORDER.map((status) => {
                const count = columns[status].total
                const share = totalTracked > 0 ? Math.round((count / totalTracked) * 100) : 0
                return (
                  <div key={status} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 ${STATUS_SWATCH[status]}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{t(`status.${status}`)}</span>
                    <MetaList
                      className="shrink-0 text-[11px] tabular-nums text-text"
                      items={[
                        { key: 'count', value: count },
                        totalTracked > 0 && { key: 'share', value: `${share}%`, className: 'text-text-faint' }
                      ]}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="border-b border-border-soft px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wide text-text-faint">{t('overview.stages')}</span>
            {submittedTotal > 0 && <span className="text-2xs tabular-nums text-text-faint">{submittedTotal}</span>}
          </div>
          {!stagesLoaded ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : submittedTotal === 0 ? (
            <p className="mt-2 text-[11px] leading-snug text-text-faint">{t('overview.noSubmitted')}</p>
          ) : (
            <div className="mt-1.5 flex flex-col">
              {stageRows.map((row) => {
                const filterValue = row.stage ? row.stage.id : STAGE_FILTER_NONE
                const active = stageFilter === filterValue
                const share = Math.round((row.count / submittedTotal) * 100)
                return (
                  <button
                    key={filterValue}
                    type="button"
                    onClick={() => setFilters({ stage: active ? STAGE_FILTER_ALL : filterValue })}
                    aria-pressed={active}
                    title={t('overview.stageFilterHint')}
                    className={`flex h-6 w-full cursor-pointer items-center gap-1.5 px-1 text-left hover:bg-canvas-soft ${
                      active ? 'bg-canvas-soft' : ''
                    }`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate text-[11px] ${
                        active ? 'font-medium text-text' : row.count > 0 ? 'text-text-muted' : 'text-text-faint'
                      }`}
                    >
                      {stageLabel(row.stage)}
                    </span>
                    <MetaList
                      className={`shrink-0 text-[11px] tabular-nums ${row.count > 0 ? 'text-text' : 'text-text-faint'}`}
                      items={[
                        { key: 'count', value: row.count },
                        row.count > 0 && { key: 'share', value: `${share}%`, className: 'text-text-faint' }
                      ]}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wide text-text-faint">{t('overview.needsVerification')}</span>
            {pendingAlerts.length > 0 && (
              <span className="text-2xs tabular-nums text-warning">{pendingAlerts.length}</span>
            )}
          </div>

          {pendingAlerts.length === 0 ? (
            <p className="mt-2 text-[11px] leading-snug text-text-faint">
              {t('overview.noneWaiting')}
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              {pendingAlerts.map((item) => (
                <button
                  key={item.taskId}
                  onClick={() => openJob(item.jobId)}
                  className="flex w-full cursor-pointer flex-col gap-1 border border-border-soft bg-canvas-raised px-2 py-1.5 text-left hover:border-border"
                >
                  <span className="text-[12px] font-medium leading-tight text-text">{item.jobTitle}</span>
                  <span className="text-[11px] text-text-muted">{item.company}</span>
                  <div className="mt-0.5">
                    <Tag label={t('card.needsVerification')} tone="warning" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
