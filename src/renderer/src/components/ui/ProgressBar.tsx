import type { ReactElement } from 'react'

// Determinate two-div width-percentage bar (bg-canvas-inset track, bg-accent fill) —
// promoted from an ad hoc version in pages/Settings/StorageSection.tsx. Used by
// BrowserSetupModal for download progress.

export default function ProgressBar({ percent }: { percent: number }): ReactElement {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div className="h-1.5 w-full bg-canvas-inset">
      <div className="h-full bg-accent transition-[width]" style={{ width: `${clamped}%` }} />
    </div>
  )
}
