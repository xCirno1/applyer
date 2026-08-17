import { useEffect, useRef, useState, type ReactElement } from 'react'

export type MenuEntry =
  | { type: 'action'; key: string; label: string; shortcut?: string; onSelect: () => void; disabled?: boolean }
  | { type: 'checkbox'; key: string; label: string; checked: boolean; onToggle: () => void; shortcut?: string }
  | { type: 'separator'; key: string }

/**
 * The `<ul>` of items shared by `Menu` (trigger-button dropdown) and
 * `ContextMenu` (cursor-positioned right-click menu) — the two differ only
 * in how they're opened/positioned, not in how an item list renders or
 * behaves. `onItemActivated` fires after a real item's action runs, so each
 * host can close itself without this component knowing which kind it's in.
 */
export function MenuList({
  items,
  onItemActivated,
  className
}: {
  items: MenuEntry[]
  onItemActivated: () => void
  className?: string
}): ReactElement {
  const hasCheckbox = items.some((item) => item.type === 'checkbox')

  return (
    <ul role="menu" className={className}>
      {items.map((item) =>
        item.type === 'separator' ? (
          <li key={item.key} role="separator" className="my-1 border-t border-border-soft" />
        ) : (
          <li
            key={item.key}
            role={item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={item.type === 'checkbox' ? item.checked : undefined}
          >
            <button
              type="button"
              disabled={item.type === 'action' && item.disabled}
              onClick={() => {
                if (item.type === 'checkbox') item.onToggle()
                else item.onSelect()
                onItemActivated()
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-text hover:bg-canvas-soft disabled:cursor-not-allowed disabled:text-text-faint disabled:hover:bg-transparent"
            >
              {hasCheckbox && (
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {item.type === 'checkbox' && item.checked && <CheckIcon />}
                </span>
              )}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && <span className="text-[11px] text-text-faint">{item.shortcut}</span>}
            </button>
          </li>
        )
      )}
    </ul>
  )
}

/**
 * Single top-level menu-bar dropdown (à la VS Code's File/Edit/View...).
 * `absolute`-positioned off its own trigger, not `fixed`+measured like
 * `Dropdown`, since it only ever opens inside the header, which never clips
 * it. Generalizes what used to be `workspace/ViewMenu.tsx` (checkbox items
 * only) to also support plain actions and separators, so
 * `workspace/AppMenuBar.tsx` can build File/Terminal/Jobs/View/Help out of
 * the same component.
 */
export default function Menu({ label, items }: { label: string; items: MenuEntry[] }): ReactElement {
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
        {label}
      </button>

      {open && (
        <MenuList
          items={items}
          onItemActivated={() => setOpen(false)}
          className="absolute left-0 top-[calc(100%+4px)] z-50 w-max min-w-40 whitespace-nowrap border border-border bg-canvas-raised py-1 shadow-pop"
        />
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
