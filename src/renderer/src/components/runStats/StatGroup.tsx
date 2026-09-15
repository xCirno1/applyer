import type { ReactElement, ReactNode } from 'react'
import Tooltip from '../ui/Tooltip'

/**
 * One group of the Runs screen. The groups sit in `StatGrid`, a grid of
 * equal columns whose cells stretch to their row, so the seams between
 * groups are straight lines however many rows a group has; a wrapping flex
 * row left ragged edges and holes. `wide` spans the whole row and is for the
 * per-source table, which has too many columns for one cell. `fill` is the
 * timeline's shape instead, outside the grid: a column that takes the full
 * height of the screen and scrolls inside, since it is the one group whose
 * length is the run's length rather than a fixed set of rows.
 */
export function StatGroup({
  title,
  wide = false,
  fill = false,
  children
}: {
  title: string
  wide?: boolean
  fill?: boolean
  children: ReactNode
}): ReactElement {
  const shape = fill ? 'h-full min-h-0 w-[28rem] shrink-0 border-l border-border-soft' : wide ? 'col-span-full' : ''
  return (
    <section className={`flex min-w-0 flex-col bg-canvas-inset ${shape}`}>
      <h3 className="shrink-0 border-b border-border-soft px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-faint">
        {title}
      </h3>
      <div className={`px-3 py-1.5 ${fill ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>{children}</div>
    </section>
  )
}

/**
 * The grid the groups sit in. The 1px gap over a seam-coloured ground is
 * what draws the lines between cells, and the grid keeps its own height
 * (`h-max`) inside a scrolling wrapper so the ground never shows below the
 * last row. Groups are placed densely so a full-width table does not leave
 * a half-empty row above it.
 */
export function StatGrid({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="grid h-max grid-flow-dense grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-px border-b border-border-soft bg-border-soft">
        {children}
      </div>
    </div>
  )
}

/**
 * A label/value line. `tone` colours the value when it is a problem worth
 * noticing (a failure count that is not zero); a zero stays neutral
 * whatever the tone, since nothing went wrong.
 */
export function StatRow({
  label,
  value,
  tip,
  tone = 'neutral',
  muted = false
}: {
  label: string
  value: ReactNode
  /** Tooltip for a label whose meaning is not obvious from the word alone. */
  tip?: string
  tone?: 'neutral' | 'danger' | 'warning' | 'success'
  /** A secondary line, indented under the row it belongs to. */
  muted?: boolean
}): ReactElement {
  const isZero = value === 0 || value === '0'
  const toneClass =
    tone === 'neutral' || isZero
      ? 'text-text'
      : tone === 'danger'
        ? 'text-danger'
        : tone === 'warning'
          ? 'text-warning'
          : 'text-success'
  return (
    <div className={`flex items-baseline justify-between gap-2 py-0.5 text-[12px] ${muted ? 'pl-3' : ''}`}>
      <span className={`truncate ${muted ? 'text-text-faint' : 'text-text-muted'}`}>
        {tip ? (
          <Tooltip label={tip}>
            <span className="cursor-help underline decoration-dotted underline-offset-2">{label}</span>
          </Tooltip>
        ) : (
          label
        )}
      </span>
      <span className={`shrink-0 tabular-nums ${toneClass}`}>{value}</span>
    </div>
  )
}
