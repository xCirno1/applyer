import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobStatus } from '@shared/types/job'
import { useJobsStore } from '../../state/jobsStore'
import { usePendingCaptchaAlerts } from '../../providers/CaptchaAlertContext'
import Tag from '../ui/Tag'
import DonutChart from '../ui/DonutChart'
import MetaList from '../ui/MetaList'

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
 */
export default function PipelineOverview({ onHide }: { onHide: () => void }): ReactElement {
  const { t } = useTranslation('board')
  const columns = useJobsStore((s) => s.columns)
  const openJob = useJobsStore((s) => s.openJob)
  const pendingAlerts = usePendingCaptchaAlerts()

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
