import type { ReactElement } from 'react'

export interface DonutSegment {
  key: string
  value: number
  /** Tailwind `stroke-*` class, e.g. `"stroke-accent"`. */
  strokeClassName: string
}

interface DonutChartProps {
  segments: DonutSegment[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerSublabel?: string
  className?: string
}

/** Gap between adjacent slices, in px of arc length. */
const GAP_PX = 2

/**
 * A part-to-whole donut, built from plain SVG stroked circles (no chart
 * library — this is one shape). Segments render in the order given;
 * negative or zero values are dropped rather than plotted, and an all-zero
 * total renders as an empty track rather than dividing by zero.
 */
export default function DonutChart({
  segments,
  size = 88,
  thickness = 12,
  centerLabel,
  centerSublabel,
  className = ''
}: DonutChartProps): ReactElement {
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)

  const arcs = segments
    .filter((s) => s.value > 0 && total > 0)
    .reduce<{ list: { key: string; strokeClassName: string; renderedLength: number; dashOffset: number }[]; offset: number }>(
      (acc, s) => {
        const arcLength = (s.value / total) * circumference
        const renderedLength = Math.max(0, arcLength - GAP_PX)
        const dashOffset = -(acc.offset + GAP_PX / 2)
        return {
          list: [...acc.list, { key: s.key, strokeClassName: s.strokeClassName, renderedLength, dashOffset }],
          offset: acc.offset + arcLength
        }
      },
      { list: [], offset: 0 }
    ).list

  const label = [centerLabel, centerSublabel].filter(Boolean).join(' ')

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label || undefined}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={thickness} className="stroke-border-soft" />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={thickness}
              strokeLinecap="butt"
              strokeDasharray={`${arc.renderedLength} ${circumference - arc.renderedLength}`}
              strokeDashoffset={arc.dashOffset}
              className={arc.strokeClassName}
            />
          ))}
        </g>
      </svg>
      {(centerLabel || centerSublabel) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && (
            <span className="text-[15px] font-medium leading-tight tabular-nums text-text">{centerLabel}</span>
          )}
          {centerSublabel && <span className="text-2xs uppercase tracking-wide text-text-faint">{centerSublabel}</span>}
        </div>
      )}
    </div>
  )
}
