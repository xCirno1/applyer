import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import KanbanBoard from '../../components/board/KanbanBoard'
import PipelineOverview from '../../components/board/PipelineOverview'
import ResizeHandle from '../../components/ui/ResizeHandle'
import { SIDEBAR_MAX_PX, SIDEBAR_MIN_PX } from '../../components/workspace/workspaceLayout'
import type { WorkspaceLayoutController } from '../../components/workspace/useWorkspaceLayout'

/**
 * The main screen's body: a job-pipeline overview beside the kanban board.
 * Which job is open in the detail modal is shared app state (jobsStore) so
 * both the board and the sidebar's verification list can drive it.
 *
 * Layout state (`useWorkspaceLayout`) is owned by `App.tsx`'s `MainShell`,
 * not here, and so is the terminal/logs dock: the dock sits under every
 * rail screen (a resume is tailored by talking to the agent while looking
 * at the preview), so the shell renders it below whichever screen is
 * active and this component only receives the sidebar half of the layout.
 */
export default function WorkspacePage({
  layout,
  setSidebarVisible,
  setSidebarWidth
}: Pick<WorkspaceLayoutController, 'layout' | 'setSidebarVisible' | 'setSidebarWidth'>): ReactElement {
  const { t } = useTranslation('workspace')
  const topRef = useRef<HTMLDivElement>(null)

  const handleSidebarResize = useCallback(
    (next: number) => setSidebarWidth(next, topRef.current?.clientWidth),
    [setSidebarWidth]
  )

  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])
  useEffect(() => {
    const reclamp = (): void => setSidebarWidth(layoutRef.current.sidebarWidth, topRef.current?.clientWidth)
    reclamp()
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [layout.sidebarVisible, setSidebarWidth])

  return (
    <div ref={topRef} className="flex h-full min-h-0 overflow-hidden">
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
  )
}
