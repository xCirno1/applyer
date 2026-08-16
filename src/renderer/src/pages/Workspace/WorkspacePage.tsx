import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import KanbanBoard from '../../components/board/KanbanBoard'
import PipelineOverview from '../../components/board/PipelineOverview'
import WorkspaceDock from '../../components/workspace/WorkspaceDock'
import ResizeHandle from '../../components/ui/ResizeHandle'
import Button from '../../components/ui/Button'
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
      <header className="flex h-nav shrink-0 items-center gap-3 border-b border-border bg-canvas px-3">
        <span className="text-[13px] font-medium text-text">Applyer</span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant={layout.sidebarVisible ? 'secondary' : 'ghost'}
            aria-pressed={layout.sidebarVisible}
            onClick={() => setSidebarVisible(!layout.sidebarVisible)}
          >
            Overview
          </Button>
          <Button
            size="sm"
            variant={layout.dockVisible ? 'secondary' : 'ghost'}
            aria-pressed={layout.dockVisible}
            onClick={() => setDockVisible(!layout.dockVisible)}
          >
            Console
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border-soft" />
          <button
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            className="flex h-6 w-6 cursor-pointer items-center justify-center text-text-muted hover:text-text"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <circle cx="7.5" cy="7.5" r="2.2" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M7.5 1.5v1.4M7.5 12.1v1.4M13.5 7.5h-1.4M2.9 7.5H1.5M11.6 3.4l-1 1M4.4 10.1l-1 1M11.6 11.6l-1-1M4.4 4.9l-1-1"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
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
