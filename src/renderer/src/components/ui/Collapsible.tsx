import { useState, type ReactElement, type ReactNode } from 'react'

interface CollapsibleProps {
  label: string
  /** Short state shown at the header's right edge (e.g. "On"), so a collapsed section still says what it is set to. */
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

// Used by pages/Settings/AppearanceSection.tsx to tuck the custom CSS editor behind an "Advanced"
// toggle, and by components/settings/RemoteBrowserCard.tsx for the whole attach-to-browser panel.
/** Bordered disclosure section — header toggles a bottom-bordered content panel. */
export default function Collapsible({ label, summary, defaultOpen = false, children }: CollapsibleProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-border-soft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-7 w-full cursor-pointer items-center justify-between gap-2 bg-canvas-soft px-2 text-left text-[12px] font-medium text-text hover:bg-canvas-raised"
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {summary !== undefined && <span className="font-normal text-text-muted">{summary}</span>}
          <ChevronIcon open={open} />
        </span>
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
