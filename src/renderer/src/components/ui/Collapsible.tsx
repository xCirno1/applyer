import { useState, type ReactElement, type ReactNode } from 'react'

interface CollapsibleProps {
  label: string
  defaultOpen?: boolean
  children: ReactNode
}

/** Bordered disclosure section — header toggles a bottom-bordered content panel. */
export default function Collapsible({ label, defaultOpen = false, children }: CollapsibleProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-border-soft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-7 w-full cursor-pointer items-center justify-between gap-2 bg-canvas-soft px-2 text-left text-[12px] font-medium text-text hover:bg-canvas-raised"
      >
        <span>{label}</span>
        <ChevronIcon open={open} />
      </button>
      {open && <div className="border-t border-border-soft p-2">{children}</div>}
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
      className={`shrink-0 text-text-faint transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
