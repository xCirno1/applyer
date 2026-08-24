import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

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
              onClick={(e) => {
                // ContextMenu renders inline (fixed-positioned, not
                // portaled) as a DOM descendant of whatever triggered it —
                // for JobCard that's the row's own onClick. Without this,
                // a menu item's click bubbles up to that row handler too,
                // which (using its stale pre-click `hasSelection` closure)
                // re-toggles the very selection this click just changed —
                // e.g. clicking "Deselect" with one job selected cleared it
                // then immediately re-added it via the bubbled click.
                e.stopPropagation()
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

interface MenuBarContextValue {
  activeLabel: string | null
  openMenu: (label: string) => void
  closeAll: () => void
}

const MenuBarContext = createContext<MenuBarContextValue | null>(null)

/**
 * Groups a row of top-level `Menu`s (à la VS Code's File/Edit/View... bar) so
 * they share one "which menu is open" state instead of each managing its own.
 * That's what makes the VS Code-style handoff possible: clicking a menu opens
 * it and marks the bar active; while active, just *hovering* another menu's
 * trigger switches to it with no second click. Clicking anywhere outside the
 * whole bar (not just outside the currently-open menu) closes everything and
 * drops back to "hover does nothing" until the next click.
 */
export function MenuBar({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeLabel === null) return
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current?.contains(e.target as Node)) return
      setActiveLabel(null)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setActiveLabel(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [activeLabel])

  return (
    <MenuBarContext.Provider value={{ activeLabel, openMenu: setActiveLabel, closeAll: () => setActiveLabel(null) }}>
      <div ref={rootRef} className={className}>
        {children}
      </div>
    </MenuBarContext.Provider>
  )
}

/**
 * Single top-level menu-bar dropdown (à la VS Code's File/Edit/View...).
 * `absolute`-positioned off its own trigger, not `fixed`+measured like
 * `Dropdown`, since it only ever opens inside the header, which never clips
 * it. Generalizes what used to be `workspace/ViewMenu.tsx` (checkbox items
 * only) to also support plain actions and separators, so
 * `workspace/AppMenuBar.tsx` can build File/Terminal/Jobs/View/Help out of
 * the same component. Must be rendered inside a `MenuBar` — that's what
 * makes hovering between already-open menus switch them without a click.
 */
export default function Menu({ label, items }: { label: string; items: MenuEntry[] }): ReactElement {
  const menuBar = useContext(MenuBarContext)
  if (!menuBar) throw new Error('Menu must be rendered inside a MenuBar')
  const open = menuBar.activeLabel === label

  const handleTriggerClick = (): void => {
    if (open) menuBar.closeAll()
    else menuBar.openMenu(label)
  }

  const handleTriggerMouseEnter = (): void => {
    if (menuBar.activeLabel !== null && menuBar.activeLabel !== label) menuBar.openMenu(label)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleTriggerClick}
        onMouseEnter={handleTriggerMouseEnter}
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
          onItemActivated={() => menuBar.closeAll()}
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
