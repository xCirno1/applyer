import type { ReactElement } from 'react'

export default function ProgressBar({ percent }: { percent: number }): ReactElement {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div className="h-1.5 w-full bg-canvas-inset">
      <div className="h-full bg-accent transition-[width]" style={{ width: `${clamped}%` }} />
    </div>
  )
}
