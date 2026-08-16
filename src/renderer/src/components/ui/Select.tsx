import type { ReactElement } from 'react'
import Dropdown, { type DropdownOption } from './Dropdown'

interface SelectProps {
  label: string
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
}

export default function Select({ label, options, value, onChange, id, disabled }: SelectProps): ReactElement {
  const selectId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <label htmlFor={selectId} className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      <Dropdown id={selectId} options={options} value={value} onChange={onChange} disabled={disabled} />
    </label>
  )
}
