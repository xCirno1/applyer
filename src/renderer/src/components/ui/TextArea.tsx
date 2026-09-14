import type { ReactElement, TextareaHTMLAttributes } from 'react'

// Labeled multi-line input, the `TextField` counterpart: same label row, same
// seam and focus colour, with the height set by `rows` rather than fixed.

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label: string
  hint?: string
  error?: string
}

export default function TextArea({ label, hint, error, id, rows = 3, ...rest }: TextAreaProps): ReactElement {
  const inputId = id ?? `area-${label.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <label htmlFor={inputId} className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      <textarea
        id={inputId}
        rows={rows}
        {...rest}
        className={`border bg-canvas-soft px-2 py-1.5 text-[13px] leading-snug text-text outline-none placeholder:text-text-faint focus:border-accent ${
          error ? 'border-danger' : 'border-border'
        }`}
      />
      {error ? (
        <span className="text-[11px] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-text-faint">{hint}</span>
      ) : null}
    </label>
  )
}
