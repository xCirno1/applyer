import type { ReactElement, ReactNode } from 'react'

interface WarningPanelProps {
  title: string
  children: ReactNode
}

/**
 * A panel for a setting that widens what the app can reach: a full warning
 * border, a titled row with the triangle icon, and whatever control or prose
 * belongs under it. Distinct from `Callout` (a one-line aside with a 2px seam
 * on the left) because these hold their own controls and need to read as a
 * bounded region, not a remark. Settings > Browser uses it for the two
 * permissions that do that: local network access and attaching to the user's
 * own browser.
 */
export default function WarningPanel({ title, children }: WarningPanelProps): ReactElement {
  return (
    <div className="flex flex-col gap-2 border border-warning bg-canvas-soft p-3">
      <div className="flex items-center gap-2 text-warning">
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3 22 21H2L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 9v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17.5" r="1" fill="currentColor" />
        </svg>
        <h2 className="text-[13px] font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  )
}
