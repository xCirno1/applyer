import type { ReactElement, SelectHTMLAttributes } from 'react'

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label: string
  options: { value: string; label: string }[]
}

export default function Select({ label, options, id, ...rest }: SelectProps): ReactElement {
  const selectId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <label htmlFor={selectId} className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      <select
        id={selectId}
        {...rest}
        className="h-7 cursor-pointer border border-border bg-canvas-soft px-2 text-[13px] text-text outline-none focus:border-accent"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
