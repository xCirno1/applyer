import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import ResizeHandle from '../ui/ResizeHandle'
import WorkspaceDock from './WorkspaceDock'
import { DOCK_MAX_PX, DOCK_MIN_PX } from './workspaceLayout'
import type { WorkspaceLayoutController } from './useWorkspaceLayout'

/*
 * The rail screens above, the terminal/logs dock below. One dock for every
 * screen (it holds the only terminal session, and the agent is how resumes
 * get tailored and jobs get found, not just how the board gets filled), so
 * this sits in `MainShell` rather than in `WorkspacePage`. Visibility is per
 * screen (`layout.dockVisible[screen]`), height is shared.
 *
 * The dock is always mounted and only hidden with CSS, since unmounting
 * `WorkspaceDock` would kill the pty sessions inside `TerminalGroup`.
 */
interface ShellDockProps extends Pick<WorkspaceLayoutController, 'layout' | 'setDockTab' | 'setDockHeight'> {
  visible: boolean
  onHide: () => void
  children: ReactNode
}

export default function ShellDock({
  layout,
  visible,
  setDockTab,
  setDockHeight,
  onHide,
  children
}: ShellDockProps): ReactElement {
  const { t } = useTranslation('workspace')
  const bodyRef = useRef<HTMLDivElement>(null)

  const handleDockResize = useCallback(
    (next: number) => setDockHeight(next, bodyRef.current?.clientHeight),
    [setDockHeight]
  )

  const heightRef = useRef(layout.dockHeight)
  useEffect(() => {
    heightRef.current = layout.dockHeight
  }, [layout.dockHeight])
  useEffect(() => {
    const reclamp = (): void => setDockHeight(heightRef.current, bodyRef.current?.clientHeight)
    reclamp()
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [visible, setDockHeight])

  return (
    <div ref={bodyRef} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{children}</div>
      {visible && (
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
      <div
        className={`shrink-0 overflow-hidden border-t border-border ${visible ? '' : 'hidden'}`}
        style={{ height: visible ? layout.dockHeight : 0 }}
      >
        <WorkspaceDock tab={layout.dockTab} onTabChange={setDockTab} onHide={onHide} />
      </div>
    </div>
  )
}
