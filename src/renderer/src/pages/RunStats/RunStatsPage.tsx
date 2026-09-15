import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import RunHeader from '../../components/runStats/RunHeader'
import RunTimeline from '../../components/runStats/RunTimeline'
import SourceTable from '../../components/runStats/SourceTable'
import ToolTable from '../../components/runStats/ToolTable'
import { StatGrid, StatGroup, StatRow } from '../../components/runStats/StatGroup'
import { formatDuration, formatMillis } from '../../components/runStats/runFormat'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useFormatters } from '../../i18n/format'
import { useRunsStore } from '../../state/runsStore'
import type { RunStats } from '@shared/types/run'

/**
 * The Runs screen: a control strip over the statistic groups in a grid,
 * with the timeline as a full-height column on the right. The groups are folded by the main process from the run's events
 * (`shared/types/run.ts`), so this page only lays numbers out; the live
 * update is the store's subscription to `runs:changed`.
 *
 * A rail screen rather than a dock tab because the figures are too many for
 * a strip a few rows tall, and the dock still sits under this screen, so the
 * terminal the run is measuring stays in view. Mounted once by the shell and
 * kept mounted like the other rail screens, so the subscription and the
 * selected run survive looking at something else for a while.
 */
export default function RunStatsPage(): ReactElement {
  const { t } = useTranslation('runs')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const active = useRunsStore((s) => s.active)
  const stats = useRunsStore((s) => s.stats)
  const history = useRunsStore((s) => s.history)
  const loading = useRunsStore((s) => s.loading)
  const loadedOnce = useRunsStore((s) => s.loadedOnce)
  const acting = useRunsStore((s) => s.acting)
  const refresh = useRunsStore((s) => s.refresh)
  const select = useRunsStore((s) => s.select)
  const start = useRunsStore((s) => s.start)
  const stop = useRunsStore((s) => s.stop)
  const rename = useRunsStore((s) => s.rename)
  const remove = useRunsStore((s) => s.remove)
  const subscribeToChanges = useRunsStore((s) => s.subscribeToChanges)

  useEffect(() => {
    void refresh()
    return subscribeToChanges()
  }, [refresh, subscribeToChanges])

  const handleStart = async (): Promise<void> => {
    const result = await start()
    if (result.ok) toast.success(t('header.startedToast'))
    else toast.error(errorMessage(result.error))
  }
  const handleStop = async (): Promise<void> => {
    const result = await stop()
    if (result.ok) toast.success(t('header.stoppedToast'))
    else toast.error(errorMessage(result.error))
  }
  const handleRename = async (runId: string, label: string | null): Promise<boolean> => {
    const result = await rename(runId, label)
    if (result.ok) toast.success(t('header.renamedToast'))
    else toast.error(errorMessage(result.error))
    return result.ok
  }
  const handleDelete = async (runId: string): Promise<boolean> => {
    const result = await remove(runId)
    if (result.ok) toast.success(t('header.deletedToast'))
    else toast.error(errorMessage(result.error))
    return result.ok
  }

  return (
    <div className="flex h-full flex-col bg-canvas-inset">
      <RunHeader
        active={active}
        selected={stats?.run ?? null}
        history={history}
        acting={acting}
        onSelect={(runId) => void select(runId)}
        onStart={() => void handleStart()}
        onStop={() => void handleStop()}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      <div className="min-h-0 flex-1">
        {!loadedOnce && (
          <div className="flex h-full">
            <div className="grid h-max min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-px">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
              <Skeleton className="col-span-full h-40" />
            </div>
            <Skeleton className="h-full w-[28rem] shrink-0" />
          </div>
        )}

        {loadedOnce && !stats && (
          <div className="flex h-full flex-col justify-center gap-1 px-6">
            <p className="text-[13px] font-medium text-text">{t('empty.title')}</p>
            <p className="max-w-xl text-[12px] text-text-muted">{t('empty.body')}</p>
            {history.length > 0 && <p className="text-[12px] text-text-faint">{t('empty.history')}</p>}
          </div>
        )}

        {loadedOnce && stats && <StatsColumns stats={stats} refreshing={loading} />}
      </div>
    </div>
  )
}

function StatsColumns({ stats, refreshing }: { stats: RunStats; refreshing: boolean }): ReactElement {
  const { t } = useTranslation('runs')
  const format = useFormatters()
  const { searches, pipeline, fills, captcha, resumes, misc, tools } = stats

  return (
    <div className={`flex h-full min-h-0 ${refreshing ? 'opacity-90' : ''}`}>
      <StatGrid>
        <StatGroup title={t('groups.overview')}>
          <StatRow label={t('overview.duration')} value={formatDuration(stats.durationMs)} />
          <StatRow label={t('overview.events')} value={stats.run.eventCount} />
          <StatRow label={t('overview.eventsPerHour')} value={stats.eventsPerHour} tip={t('overview.tips.eventsPerHour')} />
          <StatRow label={t('overview.firstEvent')} value={stats.firstEventAt ? format.time(stats.firstEventAt) : t('overview.none')} />
          <StatRow label={t('overview.lastEvent')} value={stats.lastEventAt ? format.time(stats.lastEventAt) : t('overview.none')} />
        </StatGroup>

        <StatGroup title={t('groups.searches')}>
          <StatRow label={t('searches.total')} value={searches.total} />
          <StatRow label={t('searches.failed')} value={searches.failed} tone="danger" muted />
          <StatRow label={t('searches.empty')} value={searches.empty} tone="warning" muted />
          <StatRow label={t('searches.results')} value={searches.results} tip={t('searches.tips.results')} />
          <StatRow label={t('searches.avgResults')} value={searches.avgResults} muted />
          <StatRow label={t('searches.avgDuration')} value={formatMillis(searches.avgDurationMs)} muted />
          <StatRow label={t('searches.distinct')} value={searches.distinctQueries} tip={t('searches.tips.distinct')} />
          <StatRow label={t('searches.blocked')} value={searches.blockedHits} tone="danger" tip={t('searches.tips.blocked')} />
          {searches.recent.length > 0 && (
            <div className="mt-2 border-t border-border-soft pt-1.5">
              <p className="text-[11px] text-text-faint">{t('searches.recent')}</p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {searches.recent.map((search, index) => (
                  <li key={`${search.at}-${index}`} className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="min-w-0 break-words text-text">
                      {search.query}
                      <span className="text-text-faint"> · {search.location ?? t('searches.anywhere')}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-text-muted">{search.results}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </StatGroup>

        <StatGroup title={t('groups.sources')} wide>
          <SourceTable sources={stats.sources} />
        </StatGroup>

        <StatGroup title={t('groups.pipeline')}>
          <StatRow label={t('pipeline.queued')} value={pipeline.queued} />
          <StatRow label={t('pipeline.queueExisting')} value={pipeline.queueExisting} tip={t('pipeline.tips.queueExisting')} muted />
          <StatRow label={t('pipeline.queueExcluded')} value={pipeline.queueExcluded} tip={t('pipeline.tips.queueExcluded')} muted />
          <StatRow
            label={t('pipeline.matchScore')}
            tip={t('pipeline.tips.matchScore')}
            value={
              pipeline.matchScore.count > 0 && pipeline.matchScore.avg !== null
                ? t('pipeline.matchScoreValue', {
                    avg: pipeline.matchScore.avg,
                    min: pipeline.matchScore.min,
                    max: pipeline.matchScore.max
                  })
                : t('overview.none')
            }
          />
          <StatRow label={t('pipeline.markedFilled')} value={pipeline.markedFilled} />
          <StatRow label={t('pipeline.submitted')} value={pipeline.submitted} tone="success" />
          <StatRow label={t('pipeline.failed')} value={pipeline.failed} tone="danger" />
          {pipeline.failureReasons.map((reason) => (
            <StatRow key={reason.reasonTag} label={reason.reasonTag} value={reason.count} muted />
          ))}
          <StatRow label={t('pipeline.retried')} value={pipeline.retried} />
          <StatRow label={t('pipeline.unqueued')} value={pipeline.unqueued} />
          <StatRow label={t('pipeline.removed')} value={pipeline.removed} />
          <StatRow label={t('pipeline.excludedByUser')} value={pipeline.excludedByUser} />
          <StatRow label={t('pipeline.excludedByAgent')} value={pipeline.excludedByAgent} />
        </StatGroup>

        <StatGroup title={t('groups.forms')}>
          <StatRow label={t('forms.inspected')} value={fills.inspected} tip={t('forms.tips.inspected')} />
          <StatRow label={t('forms.attempts')} value={fills.attempts} tip={t('forms.tips.attempts')} />
          <StatRow label={t('forms.filled')} value={fills.filled} tone="success" muted />
          <StatRow label={t('forms.partiallyFilled')} value={fills.partiallyFilled} tone="warning" muted />
          <StatRow label={t('forms.edited')} value={fills.edited} muted />
          <StatRow label={t('forms.failed')} value={fills.failed} tone="danger" muted />
          <StatRow label={t('forms.permissionDenied')} value={fills.permissionDenied} tone="warning" tip={t('forms.tips.permissionDenied')} muted />
          <StatRow label={t('forms.noSession')} value={fills.noSession} tone="warning" tip={t('forms.tips.noSession')} muted />
          <StatRow label={t('forms.fields')} value={fills.fieldsFilled} />
          <StatRow label={t('forms.fieldsSkipped')} value={fills.fieldsSkipped} muted />
          <StatRow label={t('forms.buttons')} value={fills.buttonsClicked} />
          <StatRow label={t('forms.buttonsFailed')} value={fills.buttonsFailed} tone="warning" muted />
        </StatGroup>

        <StatGroup title={t('groups.challenges')}>
          <StatRow label={t('challenges.paused')} value={captcha.paused} tone="danger" tip={t('challenges.tips.paused')} />
          <StatRow label={t('challenges.resolved')} value={captcha.resolved} tone="success" />
          {captcha.reasons.length > 0 && (
            <div className="mt-2 border-t border-border-soft pt-1.5">
              <p className="text-[11px] text-text-faint">{t('challenges.reasons')}</p>
              {captcha.reasons.map((reason) => (
                <StatRow key={reason.reason} label={reason.reason} value={reason.count} muted />
              ))}
            </div>
          )}
        </StatGroup>

        <StatGroup title={t('groups.resumes')}>
          <StatRow label={t('resumes.attachedVariant')} value={resumes.attachedVariant} />
          <StatRow label={t('resumes.attachedMaster')} value={resumes.attachedMaster} />
          <StatRow label={t('resumes.variantsSaved')} value={resumes.variantsSaved} />
          <StatRow label={t('resumes.assigned')} value={resumes.assigned} />
          <StatRow label={t('resumes.unassigned')} value={resumes.unassigned} />
          <StatRow label={t('resumes.masterSaved')} value={resumes.masterSaved} />
          <div className="mt-2 border-t border-border-soft pt-1.5">
            <StatRow label={t('resumes.profileUpdates')} value={misc.profileUpdates} />
            <StatRow label={t('resumes.boardsAdded')} value={misc.companyBoardsAdded} />
            <StatRow label={t('resumes.boardChecks')} value={misc.companyBoardChecks} />
            <StatRow label={t('resumes.boardsChecked')} value={misc.companyBoardsChecked} muted />
            <StatRow label={t('resumes.boardPostings')} value={misc.companyBoardPostings} muted />
          </div>
        </StatGroup>

        <StatGroup title={t('groups.tools')}>
          <StatRow label={t('tools.calls')} value={tools.calls} tip={t('tools.tips.calls')} />
          <StatRow label={t('tools.errors')} value={tools.errors} tone="warning" tip={t('tools.tips.errors')} />
          <StatRow label={t('tools.time')} value={formatMillis(tools.totalDurationMs)} />
          <div className="mt-2 border-t border-border-soft pt-1.5">
            <ToolTable tools={tools} />
          </div>
        </StatGroup>
      </StatGrid>

      <StatGroup title={t('groups.timeline')} fill>
        <RunTimeline runId={stats.run.id} version={stats.run.eventCount} />
      </StatGroup>
    </div>
  )
}
