import { useEffect, useState, type ReactElement } from 'react'
import { useJobsStore } from '../../state/jobsStore'
import type { JobSortOrder } from '@shared/types/job'

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'greenhouse', label: 'Greenhouse' },
  { value: 'lever', label: 'Lever' },
  { value: 'ashby', label: 'Ashby' },
  { value: 'workday', label: 'Workday' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'indeed', label: 'Indeed' },
  { value: 'generic', label: 'Other' }
]

const SORT_OPTIONS: { value: JobSortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'matchScore', label: 'Best match first' }
]

export default function BoardFilters(): ReactElement {
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

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-soft bg-canvas px-3">
      <input
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
        placeholder="Search title or company…"
        className="h-6 w-56 border border-border bg-canvas-soft px-2 text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent"
      />
      <select
        value={filters.source ?? ''}
        onChange={(e) => setFilters({ source: e.target.value || null })}
        className="h-6 cursor-pointer border border-border bg-canvas-soft px-1.5 text-[12px] text-text outline-none focus:border-accent"
      >
        {SOURCE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        value={filters.sortBy}
        onChange={(e) => setFilters({ sortBy: e.target.value as JobSortOrder })}
        className="h-6 cursor-pointer border border-border bg-canvas-soft px-1.5 text-[12px] text-text outline-none focus:border-accent"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
