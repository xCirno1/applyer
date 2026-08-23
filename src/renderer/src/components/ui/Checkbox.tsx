import type { ReactElement } from 'react'

interface CheckboxProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  hint?: string
  id?: string
}

/** Square, bordered checkbox — never a pill/switch. Label sits to the right; an optional hint line sits below. */
export default function Checkbox({ label, checked, onChange, disabled, hint, id }: CheckboxProps): ReactElement {
  const inputId = id ?? `checkbox-${label.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <label
      htmlFor={inputId}
      className={`flex items-start gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer appearance-none border border-border bg-canvas-soft checked:border-accent checked:bg-accent disabled:cursor-not-allowed"
        style={
          checked
            ? {
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M3 8.5L6.5 12L13 4.5'/%3E%3C/svg%3E\")",
                backgroundSize: '10px 10px',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat'
              }
            : undefined
        }
      />
      <span className="flex flex-col">
        <span className="text-[13px] text-text">{label}</span>
        {hint && <span className="text-[11px] text-text-faint">{hint}</span>}
      </span>
    </label>
  )
}
