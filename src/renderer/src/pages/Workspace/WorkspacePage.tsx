import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import KanbanBoard from '../../components/board/KanbanBoard'
import PipelineOverview from '../../components/board/PipelineOverview'
import WorkspaceDock from '../../components/workspace/WorkspaceDock'
import ResizeHandle from '../../components/ui/ResizeHandle'
import { DOCK_MAX_PX, DOCK_MIN_PX, SIDEBAR_MAX_PX, SIDEBAR_MIN_PX } from '../../components/workspace/workspaceLayout'
import type { WorkspaceLayoutController } from '../../components/workspace/useWorkspaceLayout'

/**
 * The main screen's body: a job-pipeline overview, the kanban board, and a
 * terminal/logs dock as three simultaneous panels rather than three
 * separately-navigated pages. Which job is open in the detail modal is
 * shared app state (jobsStore) so both the board and the sidebar's
 * verification list can drive it.
 *
 * Layout state (`useWorkspaceLayout`) is owned by `App.tsx`'s `MainShell`,
 * not here — the top bar it drives (logo/menu/settings) spans the full
 * window width above the icon rail, so it's rendered there too; this
 * component only receives the resulting layout + setters as props.
 */
export default function WorkspacePage({
  layout,
  setSidebarVisible,
  setDockVisible,
  setDockTab,
  setSidebarWidth,
  setDockHeight
}: Pick<
  WorkspaceLayoutController,
  'layout' | 'setSidebarVisible' | 'setDockVisible' | 'setDockTab' | 'setSidebarWidth' | 'setDockHeight'
>): ReactElement {
  const { t } = useTranslation('workspace')
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
    <div ref={bodyRef} className="flex h-full flex-col">
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
              label={t('resizeOverview')}
              onResize={handleSidebarResize}
            />
          </>
        )}

        <div className="h-full min-w-0 flex-1 bg-canvas-inset">
          <KanbanBoard />
        </div>
      </div>

      {layout.dockVisible && (
        <ResizeHandle
          orientation="horizontal"
          value={layout.dockHeight}
          min={DOCK_MIN_PX}
          max={DOCK_MAX_PX}
          invert
          label={t('resizeDock')}
          onResize={handleDockResize}
        />
      )}
      {/* Always mounted (CSS visibility, not conditional render) so hiding the dock
          doesn't kill the terminal sessions living inside WorkspaceDock/TerminalGroup. */}
      <div
        className={`shrink-0 overflow-hidden border-t border-border ${layout.dockVisible ? '' : 'hidden'}`}
        style={{ height: layout.dockVisible ? layout.dockHeight : 0 }}
      >
        <WorkspaceDock tab={layout.dockTab} onTabChange={setDockTab} onHide={() => setDockVisible(false)} />
      </div>
    </div>
  )
}
