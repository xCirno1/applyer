import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useIndexedJobsStore } from '../../state/indexedJobsStore'
import Dropdown from '../ui/Dropdown'
import type { IndexedJobMatchFilter } from '@shared/types/indexedJob'

function DensityIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5h16M4 10h16M4 15h16M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export default function IndexedJobsFilters(): ReactElement {
  const { t } = useTranslation('indexedJobs')
  const filters = useIndexedJobsStore((s) => s.filters)
  const setFilters = useIndexedJobsStore((s) => s.setFilters)
  const compact = useIndexedJobsStore((s) => s.compact)
  const toggleCompact = useIndexedJobsStore((s) => s.toggleCompact)
  const [searchDraft, setSearchDraft] = useState(filters.search)

  // Debounced so we don't refetch on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchDraft !== filters.search) {
        setFilters({ search: searchDraft })
      }
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  // Every source name here is a proper noun and stays untranslated. The four
  // ATS providers appear because a search now indexes company boards too, so
  // filtering to one of them answers "what did my own watchlist turn up?".
  const sourceOptions = [
    { value: '', label: t('filters.allSources') },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'indeed', label: 'Indeed' },
    { value: 'greenhouse', label: 'Greenhouse' },
    { value: 'lever', label: 'Lever' },
    { value: 'ashby', label: 'Ashby' },
    { value: 'workday', label: 'Workday' }
  ]

  const matchOptions: { value: IndexedJobMatchFilter; label: string }[] = [
    { value: 'all', label: t('filters.matchAll') },
    { value: 'matched', label: t('filters.matchMatched') },
    { value: 'unmatched', label: t('filters.matchUnmatched') }
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
        ariaLabel={t('filters.matchLabel')}
        options={matchOptions}
        value={filters.matched}
        onChange={(v) => setFilters({ matched: v as IndexedJobMatchFilter })}
      />
      <button
        type="button"
        onClick={toggleCompact}
        aria-pressed={compact}
        aria-label={compact ? t('filters.toComfortable') : t('filters.toCompact')}
        title={compact ? t('filters.comfortableTitle') : t('filters.compactTitle')}
        className={`ml-auto flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center border ${
          compact
            ? 'border-accent text-accent'
            : 'border-border text-text-muted hover:border-text-faint hover:text-text'
        }`}
      >
        <DensityIcon />
      </button>
    </div>
  )
}
