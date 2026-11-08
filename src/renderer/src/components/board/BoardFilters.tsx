import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useJobsStore } from '../../state/jobsStore'
import Dropdown from '../ui/Dropdown'
import Tooltip from '../ui/Tooltip'
import { useOpenSettings } from '../../providers/SettingsNavContext'
import type { JobSortOrder } from '@shared/types/job'
import { JOB_SOURCE_LABELS, SEARCHABLE_SOURCES } from '@shared/types/jobSource'
import Button from '../ui/Button'
import { useStagesStore } from '../../state/stagesStore'
import { STAGE_FILTER_ALL, STAGE_FILTER_NONE, coerceStageFilter } from '../../state/stagesStoreLogic'
import StageManagerModal from './StageManagerModal'
import { useStageLabel } from './useStageLabel'

// Search (debounced)/source/sort controls above the board, backed by
// `jobsStore`'s `filters` state — changing any of them refetches all four
// columns from the server (filtering isn't done client-side).
//
// Job-board brand names are proper nouns and stay untranslated; only the
// two synthetic entries ("All sources", "Other") get a string. The list is
// the shared one so a source added to the search shows up here without a
// second edit.
//
// The globe at the far end of the strip opens Settings > Search. The source
// filter narrows the board to jobs that came from a site; which sites a
// search reaches at all is the country setting, and this strip is where
// someone wondering why Seek never shows up is looking. It sits apart from
// the filters, on the right, because it is not one of them.
//
// The stage dropdown narrows only the Submitted column (no other status
// carries a stage), and "Manage stages" beside it opens
// `StageManagerModal`. A filter naming a stage that has since been deleted
// falls back to all stages instead of leaving the column mysteriously
// empty. The strip scrolls sideways rather than wrapping on a narrow window,
// since it is one fixed-height band.

export default function BoardFilters(): ReactElement {
  const { t } = useTranslation('board')
  const filters = useJobsStore((s) => s.filters)
  const setFilters = useJobsStore((s) => s.setFilters)
  const openSettings = useOpenSettings()
  const [searchDraft, setSearchDraft] = useState(filters.search)
  const [managerOpen, setManagerOpen] = useState(false)
  const stages = useStagesStore((s) => s.stages)
  const stagesLoaded = useStagesStore((s) => s.loadedOnce)
  const stageLabel = useStageLabel()

  useEffect(() => {
    if (!stagesLoaded) return
    const coerced = coerceStageFilter(filters.stage, stages)
    if (coerced !== filters.stage) setFilters({ stage: coerced })
  }, [stagesLoaded, stages, filters.stage, setFilters])

  // Debounced so we don't refetch all four columns on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchDraft !== filters.search) {
        setFilters({ search: searchDraft })
      }
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  const sourceOptions = [
    { value: '', label: t('filters.allSources') },
    ...SEARCHABLE_SOURCES.filter((value) => value !== 'generic').map((value) => ({
      value,
      label: JOB_SOURCE_LABELS[value as Exclude<typeof value, 'generic'>]
    })),
    { value: 'generic', label: t('filters.otherSource') }
  ]

  const sortOptions: { value: JobSortOrder; label: string }[] = [
    { value: 'newest', label: t('filters.sortNewest') },
    { value: 'matchScore', label: t('filters.sortMatch') }
  ]

  const stageOptions = [
    { value: STAGE_FILTER_ALL, label: t('filters.stageAll') },
    { value: STAGE_FILTER_NONE, label: t('filters.stageNone') },
    ...stages.map((stage) => ({ value: stage.id, label: stageLabel(stage) }))
  ]

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-b border-border-soft bg-canvas px-3">
      <input
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
        placeholder={t('filters.searchPlaceholder')}
        className="h-6 w-40 shrink-0 sm:w-56 border border-border bg-canvas-soft px-2 text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent"
      />
      <Dropdown
        size="sm"
        className="w-36 shrink-0"
        ariaLabel={t('filters.sourceLabel')}
        options={sourceOptions}
        value={filters.source ?? ''}
        onChange={(v) => setFilters({ source: v || null })}
      />
      <Dropdown
        size="sm"
        className="w-40 shrink-0"
        ariaLabel={t('filters.sortLabel')}
        options={sortOptions}
        value={filters.sortBy}
        onChange={(v) => setFilters({ sortBy: v as JobSortOrder })}
      />
      <Dropdown
        size="sm"
        className="w-40 shrink-0"
        ariaLabel={t('filters.stageLabel')}
        options={stageOptions}
        value={coerceStageFilter(filters.stage, stages)}
        onChange={(v) => setFilters({ stage: v })}
      />
      <Tooltip label={t('stages.tooltip')}>
        <Button size="sm" variant="ghost" onClick={() => setManagerOpen(true)}>
          {t('filters.manageStages')}
        </Button>
      </Tooltip>
      {openSettings && (
        <Tooltip label={t('filters.searchSettings')}>
          <button
            type="button"
            onClick={() => openSettings('search')}
            aria-label={t('filters.searchSettings')}
            className="ml-auto flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-text-muted hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        </Tooltip>
      )}
      <StageManagerModal open={managerOpen} onClose={() => setManagerOpen(false)} />
    </div>
  )
}
