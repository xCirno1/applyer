import type { ReactElement } from 'react'

// Pulsing placeholder block for loading states (board columns, boot screen).

export default function Skeleton({ className = 'h-4 w-full' }: { className?: string }): ReactElement {
  return <div className={`animate-pulse rounded-none bg-canvas-soft ${className}`} />
}
