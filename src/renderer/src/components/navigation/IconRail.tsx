import type { ReactElement } from 'react'
import Tooltip from '../ui/Tooltip'

export type RailPage = 'workspace' | 'indexedJobs'

const ITEMS: { page: RailPage; label: string; icon: (props: { className?: string }) => ReactElement }[] = [
  { page: 'workspace', label: 'Job Board', icon: BoardIcon },
  { page: 'indexedJobs', label: 'Indexed Jobs', icon: SearchIcon }
]

/**
 * Persistent left-side page switcher between the job board and the Indexed
 * Jobs page — Settings deliberately stays on its own header gear button
 * rather than joining this rail.
 */
export default function IconRail({
  active,
  onSelect
}: {
  active: RailPage
  onSelect: (page: RailPage) => void
}): ReactElement {
  return (
    <nav className="flex w-10 shrink-0 flex-col items-center gap-0.5 border-r border-border bg-canvas py-2">
      {ITEMS.map(({ page, label, icon: Icon }) => {
        const isActive = active === page
        return (
          <Tooltip key={page} label={label}>
            <button
              type="button"
              onClick={() => onSelect(page)}
              aria-label={label}
              aria-current={isActive}
              className={`flex h-8 w-8 cursor-pointer items-center justify-center border-l-2 ${
                isActive ? 'border-l-accent text-text' : 'border-l-transparent text-text-muted hover:text-text'
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          </Tooltip>
        )
      })}
    </nav>
  )
}

function BoardIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="4" width="18" height="16" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 4v16M15 4v16" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.35-4.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
