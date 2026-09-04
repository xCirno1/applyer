import { useState, type ReactElement, type ReactNode } from 'react'

interface SettingsDisclosureProps {
  label: string
  children: ReactNode
  defaultOpen?: boolean
  forceOpen?: boolean
  nested?: boolean
}

/** Borderless settings hierarchy: indentation shows depth and a rule carries the disclosure heading. */
export default function SettingsDisclosure({
  label,
  children,
  defaultOpen = false,
  forceOpen = false,
  nested = false
}: SettingsDisclosureProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const expanded = forceOpen || open

  return (
    <div className={nested ? 'pl-4' : ''}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 w-full cursor-pointer items-center gap-1.5 text-left text-[12px] font-medium text-text hover:text-accent"
      >
        <ChevronIcon open={expanded} />
        <span className="shrink-0">{label}</span>
        <span className="h-px min-w-4 flex-1 bg-border-soft" aria-hidden="true" />
      </button>
      {expanded && <div className="pl-3">{children}</div>}
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-text-faint transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
