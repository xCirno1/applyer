import type { InputHTMLAttributes, ReactElement } from 'react'

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  hint?: string
  error?: string
}

export default function TextField({ label, hint, error, id, ...rest }: TextFieldProps): ReactElement {
  const inputId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <label htmlFor={inputId} className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      <input
        id={inputId}
        {...rest}
        className={`h-7 border bg-canvas-soft px-2 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent ${
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
