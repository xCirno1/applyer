import { useCallback, useRef, useState } from 'react'

export interface TerminalTab {
  id: string
  title: string
}

interface TerminalTabsState {
  tabs: TerminalTab[]
  activeId: string | null
  // Insertion-order list of tab ids, kept deliberately separate from `tabs`'
  // (reorderable) display order. Only `addTerminal`/`closeTerminal` ever
  // touch it — reordering never does. This is what `TerminalGroup` maps its
  // <TerminalPane> elements from: if panes were mapped straight from the
  // reorderable `tabs` array instead, a drag-reorder would give React a DOM
  // `Placement` for whichever pane moved, and in dev, React's StrictMode
  // double-invokes that fiber's effects as a safety check — which for a
  // component whose effect spawns a real pty means silently killing and
  // respawning the shell mid-drag (confirmed via an isolated React 19 +
  // StrictMode repro). Keeping this list append-only means a reorder only
  // ever changes which pane's CSS visibility class is active, never DOM
  // position, so no pane fiber gets a Placement and none gets
  // double-invoked.
  paneOrder: string[]
}

/** Sane ceiling on concurrent shell processes a user can spawn from the "+" button. */
export const MAX_TERMINALS = 12

export interface TerminalTabsController {
  tabs: TerminalTab[]
  activeId: string | null
  paneOrder: string[]
  atMax: boolean
  addTerminal: () => void
  closeTerminal: (id: string) => void
  setActiveId: (id: string) => void
  renameTerminal: (id: string, title: string) => void
  reorderTerminal: (dragId: string, targetId: string) => void
  moveTerminalToEnd: (id: string) => void
}

/**
 * Tracks which terminal tabs are open, which is active, their titles, and
 * their order. Deliberately not persisted anywhere (unlike workspaceLayout)
 * — a pty session is a live OS process, not serializable state, so there's
 * nothing meaningful to restore across an app restart; every launch starts
 * with exactly one fresh terminal, same as before multi-terminal support
 * existed. Renaming only ever touches the display title, never the
 * underlying pty session; reordering only ever touches array position, so
 * neither can disrupt an in-flight session.
 */
export function useTerminalTabs(): TerminalTabsController {
  const nextNumberRef = useRef(2) // the initial tab below already claims "Terminal 1"
  const [state, setState] = useState<TerminalTabsState>(() => {
    const first: TerminalTab = { id: crypto.randomUUID(), title: 'Terminal 1' }
    return { tabs: [first], activeId: first.id, paneOrder: [first.id] }
  })

  const addTerminal = useCallback(() => {
    setState((prev) => {
      if (prev.tabs.length >= MAX_TERMINALS) return prev
      const tab: TerminalTab = { id: crypto.randomUUID(), title: `Terminal ${nextNumberRef.current}` }
      nextNumberRef.current += 1
      return { tabs: [...prev.tabs, tab], activeId: tab.id, paneOrder: [...prev.paneOrder, tab.id] }
    })
  }, [])

  const closeTerminal = useCallback((id: string) => {
    setState((prev) => {
      const tabs = prev.tabs.filter((t) => t.id !== id)
      const activeId = prev.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : prev.activeId
      const paneOrder = prev.paneOrder.filter((pid) => pid !== id)
      return { tabs, activeId, paneOrder }
    })
  }, [])

  const setActiveId = useCallback((id: string) => {
    setState((prev) => (prev.tabs.some((t) => t.id === id) ? { ...prev, activeId: id } : prev))
  }, [])

  const renameTerminal = useCallback((id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    setState((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)) }))
  }, [])

  /** Moves `dragId` to sit where `targetId` currently is — the drop target of a tab drag-reorder. */
  const reorderTerminal = useCallback((dragId: string, targetId: string) => {
    if (dragId === targetId) return
    setState((prev) => {
      const fromIndex = prev.tabs.findIndex((t) => t.id === dragId)
      const toIndex = prev.tabs.findIndex((t) => t.id === targetId)
      if (fromIndex === -1 || toIndex === -1) return prev
      const tabs = [...prev.tabs]
      const [moved] = tabs.splice(fromIndex, 1)
      if (!moved) return prev
      tabs.splice(toIndex, 0, moved)
      return { ...prev, tabs }
    })
  }, [])

  /** Moves `id` to the very end — the drop target when dropping past the last tab, where there's no other tab to drop "onto". */
  const moveTerminalToEnd = useCallback((id: string) => {
    setState((prev) => {
      const index = prev.tabs.findIndex((t) => t.id === id)
      if (index === -1 || index === prev.tabs.length - 1) return prev
      const tabs = [...prev.tabs]
      const [moved] = tabs.splice(index, 1)
      if (!moved) return prev
      tabs.push(moved)
      return { ...prev, tabs }
    })
  }, [])

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    paneOrder: state.paneOrder,
    atMax: state.tabs.length >= MAX_TERMINALS,
    addTerminal,
    closeTerminal,
    setActiveId,
    renameTerminal,
    reorderTerminal,
    moveTerminalToEnd
  }
}
