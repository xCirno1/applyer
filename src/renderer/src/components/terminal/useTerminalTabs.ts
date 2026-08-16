import { useCallback, useRef, useState } from 'react'

export interface TerminalTab {
  id: string
  title: string
}

interface TerminalTabsState {
  tabs: TerminalTab[]
  activeId: string | null
}

/** Sane ceiling on concurrent shell processes a user can spawn from the "+" button. */
export const MAX_TERMINALS = 12

export interface TerminalTabsController {
  tabs: TerminalTab[]
  activeId: string | null
  atMax: boolean
  addTerminal: () => void
  closeTerminal: (id: string) => void
  setActiveId: (id: string) => void
}

/**
 * Tracks which terminal tabs are open and which is active. Deliberately not
 * persisted anywhere (unlike workspaceLayout) — a pty session is a live OS
 * process, not serializable state, so there's nothing meaningful to restore
 * across an app restart; every launch starts with exactly one fresh
 * terminal, same as before multi-terminal support existed.
 */
export function useTerminalTabs(): TerminalTabsController {
  const nextNumberRef = useRef(2) // the initial tab below already claims "Terminal 1"
  const [state, setState] = useState<TerminalTabsState>(() => {
    const first: TerminalTab = { id: crypto.randomUUID(), title: 'Terminal 1' }
    return { tabs: [first], activeId: first.id }
  })

  const addTerminal = useCallback(() => {
    setState((prev) => {
      if (prev.tabs.length >= MAX_TERMINALS) return prev
      const tab: TerminalTab = { id: crypto.randomUUID(), title: `Terminal ${nextNumberRef.current}` }
      nextNumberRef.current += 1
      return { tabs: [...prev.tabs, tab], activeId: tab.id }
    })
  }, [])

  const closeTerminal = useCallback((id: string) => {
    setState((prev) => {
      const tabs = prev.tabs.filter((t) => t.id !== id)
      const activeId = prev.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : prev.activeId
      return { tabs, activeId }
    })
  }, [])

  const setActiveId = useCallback((id: string) => {
    setState((prev) => (prev.tabs.some((t) => t.id === id) ? { ...prev, activeId: id } : prev))
  }, [])

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    atMax: state.tabs.length >= MAX_TERMINALS,
    addTerminal,
    closeTerminal,
    setActiveId
  }
}
