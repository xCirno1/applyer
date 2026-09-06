import type { ReactElement, ReactNode } from 'react'

type CalloutTone = 'accent' | 'success' | 'warning' | 'danger'

interface CalloutProps {
  tone?: CalloutTone
  /** Short lead-in, rendered inline ahead of the body rather than as a heading row. */
  title?: string
  children: ReactNode
}

/**
 * A one- or two-line aside: a 2px colored seam on the left, an opaque
 * `bg-canvas-soft` fill, no rounding and no icon badge. Same shape as a
 * toast (`ToastProvider`) and a job card's status edge, so a tip inside a
 * form reads as part of the same language rather than as a floating box.
 *
 * For a sentence next to the thing it is about. Anything longer, or with
 * its own actions, is a panel and should be built as one.
 */
const TONE_CLASSES: Record<CalloutTone, string> = {
  accent: 'border-l-accent',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger'
}

export default function Callout({ tone = 'accent', title, children }: CalloutProps): ReactElement {
  return (
    <div
      className={`border border-border-soft border-l-2 bg-canvas-soft px-2.5 py-1.5 text-[12px] text-text-muted ${TONE_CLASSES[tone]}`}
    >
      {title && <span className="font-medium text-text">{title} </span>}
      {children}
    </div>
  )
}
