import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useJobsStore } from '../../state/jobsStore'
import Dropdown from '../ui/Dropdown'
import type { JobSortOrder } from '@shared/types/job'
import { JOB_SOURCE_LABELS, SEARCHABLE_SOURCES } from '@shared/types/jobSource'

// Search (debounced)/source/sort controls above the board, backed by
// `jobsStore`'s `filters` state — changing any of them refetches all four
// columns from the server (filtering isn't done client-side).
//
// Job-board brand names are proper nouns and stay untranslated; only the
// two synthetic entries ("All sources", "Other") get a string. The list is
// the shared one so a source added to the search shows up here without a
// second edit.

export default function BoardFilters(): ReactElement {
  const { t } = useTranslation('board')
  const filters = useJobsStore((s) => s.filters)
  const setFilters = useJobsStore((s) => s.setFilters)
  const [searchDraft, setSearchDraft] = useState(filters.search)

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

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-soft bg-canvas px-3">
      <input
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
        placeholder={t('filters.searchPlaceholder')}
        className="h-6 w-56 border border-border bg-canvas-soft px-2 text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent"
      />
      <Dropdown
        size="sm"
        className="w-36"
        ariaLabel={t('filters.sourceLabel')}
        options={sourceOptions}
        value={filters.source ?? ''}
        onChange={(v) => setFilters({ source: v || null })}
      />
      <Dropdown
        size="sm"
        className="w-40"
        ariaLabel={t('filters.sortLabel')}
        options={sortOptions}
        value={filters.sortBy}
        onChange={(v) => setFilters({ sortBy: v as JobSortOrder })}
      />
    </div>
  )
}
