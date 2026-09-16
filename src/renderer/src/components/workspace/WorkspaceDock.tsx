import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentMode } from '@shared/types/agentMode'
import TerminalGroup from '../terminal/TerminalGroup'
import LogsPage from '../../pages/Logs/LogsPage'
import { visibleDockTabs, type DockTab } from './workspaceLayout'
import AgentPermissionsMenu from '../terminal/AgentPermissionsMenu'

// The bottom dock: in `cli` mode, terminal (itself a `TerminalGroup` of one
// or more concurrent sessions) and activity log; in `openrouter` mode only
// the activity log, since that mode's agent lives in `chat/ChatPanel` on
// the right instead (`visibleDockTabs`). Both bodies (`TerminalGroup`,
// `LogsPage`) stay mounted across every tab and mode switch (CSS
// visibility, not conditional render): a terminal owns a live pty session
// a remount would kill, and keeping Logs alongside it means switching back
// to it doesn't re-fetch.
export default function WorkspaceDock({
  tab,
  mode,
  onTabChange,
  onHide
}: {
  tab: DockTab
  mode: AgentMode | null
  onTabChange: (tab: DockTab) => void
  onHide: () => void
}): ReactElement {
  const { t } = useTranslation('workspace')
  const tabIds = visibleDockTabs(mode)

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-inset">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border-soft bg-canvas px-2">
        {tabIds.map((id) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`h-full cursor-pointer px-2.5 text-[12px] font-medium ${
              tab === id ? 'border-b-2 border-accent text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {t(`dock.${id}`)}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {tab === 'terminal' && <AgentPermissionsMenu />}
          <button
            type="button"
            onClick={onHide}
            title={t('dock.hide')}
            aria-label={t('dock.hide')}
            className="flex h-5 w-5 cursor-pointer items-center justify-center text-text-faint hover:text-text"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2.5 7L6 3.5L9.5 7"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className={tab === 'terminal' ? 'h-full' : 'hidden'}>
          <TerminalGroup />
        </div>
        <div className={tab === 'logs' ? 'h-full' : 'hidden'}>
          <LogsPage />
        </div>
      </div>
    </div>
  )
}
