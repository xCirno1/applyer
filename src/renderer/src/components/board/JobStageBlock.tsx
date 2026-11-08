import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobRecord } from '@shared/types/job'
import Dropdown from '../ui/Dropdown'
import Skeleton from '../ui/Skeleton'
import Spinner from '../ui/Spinner'
import Tooltip from '../ui/Tooltip'
import { useStagesStore } from '../../state/stagesStore'
import { findJobStage } from '../../state/stagesStoreLogic'
import { useJobActions } from './useJobActions'
import { useStageLabel } from './useStageLabel'

/*
 * The "Stage" block inside `JobDetailModal`, shown for Submitted jobs only
 * (no other status carries a stage): one dropdown of the user's stages in
 * their order plus "No stage", applied as soon as it changes, with the
 * dropdown disabled and a spinner beside it until the request settles.
 * The modal's job is re-derived from the store, so the dropdown follows a
 * change the agent makes while the modal is open, too.
 */

const NO_STAGE = '__none__'

export default function JobStageBlock({ job }: { job: JobRecord }): ReactElement | null {
  const { t } = useTranslation('board')
  const stageLabel = useStageLabel()
  const stages = useStagesStore((s) => s.stages)
  const loadedOnce = useStagesStore((s) => s.loadedOnce)
  const fetchStages = useStagesStore((s) => s.fetch)
  const current = useStagesStore((s) => findJobStage(job.stageId, s.stagesById, s.loadedOnce))
  const { setStageMany } = useJobActions()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!loadedOnce) void fetchStages()
  }, [loadedOnce, fetchStages])

  if (job.status !== 'submitted') return null

  const handleChange = async (value: string): Promise<void> => {
    const stageId = value === NO_STAGE ? null : value
    if (stageId === (current?.id ?? null)) return
    const stage = stageId ? (stages.find((item) => item.id === stageId) ?? null) : null
    setSaving(true)
    await setStageMany([job.id], stageId, stageLabel(stage))
    setSaving(false)
  }

  const options = [
    ...stages.map((stage) => ({ value: stage.id, label: stageLabel(stage) })),
    { value: NO_STAGE, label: t('stages.none') }
  ]
  const selectId = `job-stage-${job.id}`

  return (
    <div className="flex flex-col gap-1">
      <Tooltip label={t('stages.tooltip')}>
        <label htmlFor={selectId} className="text-[12px] font-medium text-text-muted">
          {t('detail.stage')}
        </label>
      </Tooltip>
      {loadedOnce ? (
        <div className="flex items-center gap-2">
          <Dropdown
            id={selectId}
            ariaLabel={t('detail.stageSelect')}
            className="w-full sm:w-56"
            options={options}
            value={current?.id ?? NO_STAGE}
            onChange={(value) => void handleChange(value)}
            disabled={saving}
          />
          {saving && <Spinner />}
        </div>
      ) : (
        <Skeleton className="h-7 w-full sm:w-56" />
      )}
      <p className="text-[11px] text-text-faint">{t('detail.stageHint')}</p>
    </div>
  )
}
