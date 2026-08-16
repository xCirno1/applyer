import { useEffect, useRef, useState, type ReactElement } from 'react'

interface ViewMenuItem {
  key: string
  label: string
  checked: boolean
  onToggle: () => void
}

/**
 * Menu-bar-style "View" dropdown (à la VS Code) for toggling which
 * workspace panels are visible, replacing what used to be two standalone
 * toggle buttons in the topbar. `absolute`-positioned off its own trigger
 * (not `fixed`+measured like `Dropdown`) since it only ever opens inside
 * the header, which never clips it.
 */
export default function ViewMenu({ items }: { items: ViewMenuItem[] }): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`h-6 cursor-pointer px-2 text-[12px] ${
          open ? 'bg-canvas-soft text-text' : 'text-text-muted hover:bg-canvas-soft hover:text-text'
        }`}
      >
        View
      </button>

      {open && (
        <ul
          role="menu"
          className="absolute left-0 top-[calc(100%+4px)] z-50 w-44 border border-border bg-canvas-raised py-1 shadow-pop"
        >
          {items.map((item) => (
            <li key={item.key} role="menuitemcheckbox" aria-checked={item.checked}>
              <button
                type="button"
                onClick={() => {
                  item.onToggle()
                  setOpen(false)
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-text hover:bg-canvas-soft"
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {item.checked && <CheckIcon />}
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CheckIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="text-accent">
      <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
