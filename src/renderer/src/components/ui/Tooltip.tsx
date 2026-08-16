import { useState, type ReactElement, type ReactNode } from 'react'

export default function Tooltip({ label, children }: { label: string; children: ReactNode }): ReactElement {
  const [visible, setVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap bg-canvas-raised px-2 py-1 text-[11px] text-text shadow-pop border border-border"
        >
          {label}
        </span>
      )}
    </span>
  )
}
