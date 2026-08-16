import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import logo from '../../assets/logo.png'
import KanbanBoard from '../../components/board/KanbanBoard'
import PipelineOverview from '../../components/board/PipelineOverview'
import WorkspaceDock from '../../components/workspace/WorkspaceDock'
import ResizeHandle from '../../components/ui/ResizeHandle'
import ViewMenu from '../../components/workspace/ViewMenu'
import { useWorkspaceLayout } from '../../components/workspace/useWorkspaceLayout'
import { DOCK_MAX_PX, DOCK_MIN_PX, SIDEBAR_MAX_PX, SIDEBAR_MIN_PX } from '../../components/workspace/workspaceLayout'

/**
 * The main screen: a job-pipeline overview, the kanban board, and a
 * terminal/logs dock as three simultaneous panels rather than three
 * separately-navigated pages. Panel sizes and visibility are a persisted
 * per-browser preference (see useWorkspaceLayout); which job is open in the
 * detail modal is shared app state (jobsStore) so both the board and the
 * sidebar's verification list can drive it.
 */
export default function WorkspacePage({ onOpenSettings }: { onOpenSettings: () => void }): ReactElement {
  const { layout, setSidebarVisible, setDockVisible, setDockTab, setSidebarWidth, setDockHeight } =
    useWorkspaceLayout()

  // bodyRef is the column the board and dock share; topRef the row the
  // board and sidebar share — both measured to clamp a drag against what's
  // actually on screen.
  const bodyRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const handleSidebarResize = useCallback(
    (next: number) => setSidebarWidth(next, topRef.current?.clientWidth),
    [setSidebarWidth]
  )
  const handleDockResize = useCallback(
    (next: number) => setDockHeight(next, bodyRef.current?.clientHeight),
    [setDockHeight]
  )

  // Re-clamp against the real container on window resize, so a layout
  // dragged wide on a large monitor doesn't come back oversized on a smaller
  // one. Mirrored into a ref outside render so the resize listener can read
  // the current size without re-subscribing on every drag frame.
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])
  useEffect(() => {
    const reclamp = (): void => {
      setSidebarWidth(layoutRef.current.sidebarWidth, topRef.current?.clientWidth)
      setDockHeight(layoutRef.current.dockHeight, bodyRef.current?.clientHeight)
    }
    reclamp()
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [layout.sidebarVisible, layout.dockVisible, setSidebarWidth, setDockHeight])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-nav shrink-0 items-center gap-2 border-b border-border bg-canvas px-3">
        <img src={logo} alt="Applyer" className="h-5 w-5 shrink-0" draggable={false} />
        <ViewMenu
          items={[
            { key: 'overview', label: 'Overview', checked: layout.sidebarVisible, onToggle: () => setSidebarVisible(!layout.sidebarVisible) },
            { key: 'console', label: 'Console', checked: layout.dockVisible, onToggle: () => setDockVisible(!layout.dockVisible) }
          ]}
        />

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            className="flex h-6 w-6 cursor-pointer items-center justify-center text-text-muted hover:text-text"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        </div>
      </header>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <div ref={topRef} className="flex min-h-0 flex-1 overflow-hidden">
          {layout.sidebarVisible && (
            <>
              <aside className="h-full shrink-0 border-r border-border" style={{ width: layout.sidebarWidth }}>
                <PipelineOverview onHide={() => setSidebarVisible(false)} />
              </aside>
              <ResizeHandle
                orientation="vertical"
                value={layout.sidebarWidth}
                min={SIDEBAR_MIN_PX}
                max={SIDEBAR_MAX_PX}
                label="Resize overview panel"
                onResize={handleSidebarResize}
              />
            </>
          )}

          <div className="h-full min-w-0 flex-1 bg-canvas-inset">
            <KanbanBoard />
          </div>
        </div>

        {layout.dockVisible && (
          <>
            <ResizeHandle
              orientation="horizontal"
              value={layout.dockHeight}
              min={DOCK_MIN_PX}
              max={DOCK_MAX_PX}
              invert
              label="Resize console dock"
              onResize={handleDockResize}
            />
            <div className="shrink-0 overflow-hidden border-t border-border" style={{ height: layout.dockHeight }}>
              <WorkspaceDock tab={layout.dockTab} onTabChange={setDockTab} onHide={() => setDockVisible(false)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
