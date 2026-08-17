import { useEffect, useRef, type ReactElement } from 'react'
import { MenuList, type MenuEntry } from './Menu'

export interface ContextMenuState {
  x: number
  y: number
  items: MenuEntry[]
}

const VIEWPORT_MARGIN = 8
// No live DOM measurement (unlike Dropdown's option panel) — right-click
// menus in this app are always short (a handful of job-card actions), so a
// fixed estimate avoids the flicker/double-render a measure-then-reposition
// pass would need, same tradeoff Dropdown already makes for panel height.
const ESTIMATED_WIDTH = 220
const ESTIMATED_HEIGHT = 220

/**
 * Cursor-positioned right-click menu — the `fixed`-position sibling of
 * `Menu`'s trigger-button dropdown, sharing the same `MenuList` item
 * rendering. Fully controlled: `state` is null when closed, and the caller
 * (one instance per `JobCard`, via `useJobContextMenu`) sets it from a
 * `contextmenu` handler. Closes on outside click, Escape, or a new
 * `contextmenu` event anywhere else (so right-clicking a different card
 * swaps the menu instead of stacking two).
 */
export default function ContextMenu({
  state,
  onClose
}: {
  state: ContextMenuState | null
  onClose: () => void
}): ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state) return
    const onPointerDown = (e: PointerEvent): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('contextmenu', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('contextmenu', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [state, onClose])

  if (!state) return null

  const left = Math.max(VIEWPORT_MARGIN, Math.min(state.x, window.innerWidth - ESTIMATED_WIDTH - VIEWPORT_MARGIN))
  const top = Math.max(VIEWPORT_MARGIN, Math.min(state.y, window.innerHeight - ESTIMATED_HEIGHT - VIEWPORT_MARGIN))

  return (
    <div ref={menuRef} style={{ position: 'fixed', top, left }} className="z-50">
      <MenuList
        items={state.items}
        onItemActivated={onClose}
        className="w-max min-w-40 whitespace-nowrap border border-border bg-canvas-raised py-1 shadow-pop"
      />
    </div>
  )
}
