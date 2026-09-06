import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_WORKSPACE_LAYOUT,
  clampDockHeight,
  clampSidebarWidth,
  readStoredWorkspaceLayout,
  writeStoredWorkspaceLayout,
  type DockTab,
  type WorkspaceLayout
} from './workspaceLayout'

// Panel visibility + sidebar width + dock height + active dock tab, persisted
// to localStorage with debounced writes (flushed on `beforeunload`).
// Clamping/parsing rules live in the plain `workspaceLayout.ts` module (no
// React) so they're independently testable; this hook only wraps that with
// debounced persistence — same split as `terminal/terminalKeys.ts`. Called
// from `App.tsx`'s `MainShell` (not `WorkspacePage`, which receives the
// result as props) since `AppMenuBar`'s sidebar/dock toggles live in the
// shared top bar now.

/** A drag produces one layout change per pointer frame; debounce the write. */
const PERSIST_DEBOUNCE_MS = 200

export interface WorkspaceLayoutController {
  layout: WorkspaceLayout
  setSidebarVisible: (visible: boolean) => void
  setDockVisible: (visible: boolean) => void
  setDockTab: (tab: DockTab) => void
  /** @param available Width of the region the sidebar shares with the board. */
  setSidebarWidth: (width: number, available?: number) => void
  /** @param available Height of the region the board shares with the dock. */
  setDockHeight: (height: number, available?: number) => void
  reset: () => void
}

export function useWorkspaceLayout(): WorkspaceLayoutController {
  // Electron's renderer has no SSR pass, so reading storage in the
  // initializer carries none of the hydration-mismatch risk a server-rendered
  // app would have — the first paint can already reflect the saved layout.
  const [layout, setLayout] = useState<WorkspaceLayout>(() => readStoredWorkspaceLayout())

  // Mirrors `layout` outside of render so the mount-once effect below can
  // flush whatever's current without re-subscribing its listener on every
  // layout change.
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  useEffect(() => {
    const timer = setTimeout(() => writeStoredWorkspaceLayout(layout), PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [layout])

  // Flush whatever the debounce is still holding if the window closes
  // mid-drag.
  useEffect(() => {
    const flush = (): void => writeStoredWorkspaceLayout(layoutRef.current)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  const update = useCallback((patch: Partial<WorkspaceLayout>) => {
    setLayout((current) => ({ ...current, ...patch }))
  }, [])

  const setSidebarVisible = useCallback((visible: boolean) => update({ sidebarVisible: visible }), [update])
  const setDockVisible = useCallback((visible: boolean) => update({ dockVisible: visible }), [update])
  const setDockTab = useCallback((tab: DockTab) => update({ dockTab: tab }), [update])

  const setSidebarWidth = useCallback(
    (width: number, available?: number) => update({ sidebarWidth: clampSidebarWidth(width, available) }),
    [update]
  )
  const setDockHeight = useCallback(
    (height: number, available?: number) => update({ dockHeight: clampDockHeight(height, available) }),
    [update]
  )

  const reset = useCallback(() => setLayout(DEFAULT_WORKSPACE_LAYOUT), [])

  return { layout, setSidebarVisible, setDockVisible, setDockTab, setSidebarWidth, setDockHeight, reset }
}
