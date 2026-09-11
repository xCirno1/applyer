import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '../ui/Tooltip'

export type RailPage = 'workspace' | 'indexedJobs'

const ITEMS: { page: RailPage; labelKey: 'rail.jobBoard' | 'rail.discovery'; icon: (props: { className?: string }) => ReactElement }[] = [
  { page: 'workspace', labelKey: 'rail.jobBoard', icon: BoardIcon },
  { page: 'indexedJobs', labelKey: 'rail.discovery', icon: SearchIcon }
]

/**
 * The left rail switching `App.tsx`'s `MainShell` between the Workspace and
 * Job Discovery screens (the rail label the `IndexedJobs` page screen
 * answers to, since that page holds Indexed, Company Boards and Excluded
 * rather than only the first). Sits below the shared full-width top bar
 * rather than spanning the whole window height — two inline-SVG icon
 * buttons, active state is a left accent border (no icon background or
 * rounded badge, per the style guidelines). Settings deliberately stays off
 * this rail (header gear button instead).
 */
export default function IconRail({
  active,
  onSelect
}: {
  active: RailPage
  onSelect: (page: RailPage) => void
}): ReactElement {
  const { t } = useTranslation('workspace')

  return (
    <nav className="flex w-10 shrink-0 flex-col items-center gap-0.5 border-r border-border bg-canvas py-2">
      {ITEMS.map(({ page, labelKey, icon: Icon }) => {
        const isActive = active === page
        const label = t(labelKey)
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
