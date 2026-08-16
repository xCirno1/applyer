import type { ReactElement } from 'react'

type Tone = 'neutral' | 'danger' | 'warning' | 'success'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-border text-text-muted',
  danger: 'border-danger text-danger',
  warning: 'border-warning text-warning',
  success: 'border-success text-success'
}

/** Plain bordered rectangle with text — never a pill, never a dot-chip. */
export default function Tag({ label, tone = 'neutral' }: { label: string; tone?: Tone }): ReactElement {
  return (
    <span className={`inline-flex h-5 items-center border px-1.5 text-[11px] font-medium ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  )
}
