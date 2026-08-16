import type { ReactElement } from 'react'

export default function Skeleton({ className = 'h-4 w-full' }: { className?: string }): ReactElement {
  return <div className={`animate-pulse rounded-none bg-canvas-soft ${className}`} />
}
