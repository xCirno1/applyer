import type { ReactElement } from 'react'
import type { TerminalTab } from './useTerminalTabs'

export default function TerminalTabBar({
  tabs,
  activeId,
  atMax,
  onSelect,
  onClose,
  onAdd
}: {
  tabs: TerminalTab[]
  activeId: string | null
  atMax: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
}): ReactElement {
  return (
    <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-soft bg-canvas-inset px-1">
      {tabs.map((t) => (
        <div
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`group flex h-full shrink-0 cursor-pointer items-center gap-1 border-r border-border-soft px-2 text-[11px] ${
            t.id === activeId ? 'bg-canvas-raised text-text' : 'text-text-muted hover:text-text'
          }`}
        >
          <span className="max-w-24 truncate">{t.title}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
            aria-label={`Close ${t.title}`}
            className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center text-text-faint opacity-0 hover:text-text group-hover:opacity-100"
          >
            <CloseIcon />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        disabled={atMax}
        title={atMax ? `You can have at most ${tabs.length} terminals open` : 'New terminal'}
        aria-label="New terminal"
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center text-text-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PlusIcon />
      </button>
    </div>
  )
}

function CloseIcon(): ReactElement {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
