import { useEffect, useState, type ReactElement } from 'react'
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

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'indeed', label: 'Indeed' }
]

const MATCH_OPTIONS: { value: IndexedJobMatchFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'matched', label: 'Matched' },
  { value: 'unmatched', label: 'Not selected' }
]

export default function IndexedJobsFilters(): ReactElement {
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

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-soft bg-canvas px-3">
      <input
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
        placeholder="Search title or company…"
        className="h-6 w-56 border border-border bg-canvas-soft px-2 text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent"
      />
      <Dropdown
        size="sm"
        className="w-36"
        ariaLabel="Filter by source"
        options={SOURCE_OPTIONS}
        value={filters.source ?? ''}
        onChange={(v) => setFilters({ source: v || null })}
      />
      <Dropdown
        size="sm"
        className="w-40"
        ariaLabel="Filter by match status"
        options={MATCH_OPTIONS}
        value={filters.matched}
        onChange={(v) => setFilters({ matched: v as IndexedJobMatchFilter })}
      />
      <button
        type="button"
        onClick={toggleCompact}
        aria-pressed={compact}
        aria-label={compact ? 'Switch to comfortable rows' : 'Switch to compact rows'}
        title={compact ? 'Comfortable rows' : 'Compact rows'}
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
