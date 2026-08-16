import type { ReactElement } from 'react'
import TerminalPane from './TerminalPane'
import TerminalTabBar from './TerminalTabBar'
import { useTerminalTabs } from './useTerminalTabs'
import Button from '../ui/Button'

/**
 * Multiple concurrent terminal sessions as sub-tabs of the dock's Terminal
 * tab. Every open tab renders its own `TerminalPane` (and therefore owns its
 * own pty session) at all times — only the active one is shown, the rest are
 * hidden via CSS rather than unmounted, same reasoning as the outer
 * Terminal/Activity-Log dock switch: a remount would kill the session.
 * Actually closing a tab does unmount it (and with it, dispose the session)
 * since that's the whole point of closing.
 */
export default function TerminalGroup(): ReactElement {
  const { tabs, activeId, atMax, addTerminal, closeTerminal, setActiveId } = useTerminalTabs()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalTabBar
        tabs={tabs}
        activeId={activeId}
        atMax={atMax}
        onSelect={setActiveId}
        onClose={closeTerminal}
        onAdd={addTerminal}
      />
      <div className="min-h-0 flex-1 bg-canvas-raised">
        {tabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <span className="text-[12px] text-text-faint">No terminals open.</span>
            <Button size="sm" onClick={addTerminal}>
              New terminal
            </Button>
          </div>
        ) : (
          tabs.map((t) => (
            <div key={t.id} className={t.id === activeId ? 'h-full' : 'hidden'}>
              <TerminalPane />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
