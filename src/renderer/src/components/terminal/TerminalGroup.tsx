import { useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import TerminalPane, { type TerminalPaneHandle } from './TerminalPane'
import TerminalTabBar from './TerminalTabBar'
import { useTerminalTabs } from './useTerminalTabs'
import Button from '../ui/Button'
import { useShortcutHandler } from '../../providers/ShortcutsContext'

/**
 * Multiple concurrent terminal sessions as sub-tabs of the dock's Terminal
 * tab. Every open tab renders its own `TerminalPane` (and therefore owns its
 * own pty session) at all times — only the active one is shown, the rest are
 * hidden via CSS rather than unmounted, same reasoning as the outer
 * Terminal/Activity-Log dock switch: a remount would kill the session.
 * Actually closing a tab does unmount it (and with it, dispose the session)
 * since that's the whole point of closing. Panes are mapped from
 * `useTerminalTabs`' `paneOrder` (append-only, untouched by reordering) —
 * see the comment there for why that has to be a separate list from `tabs`'
 * reorderable display order.
 */
export default function TerminalGroup(): ReactElement {
  const { t } = useTranslation('workspace')
  const {
    tabs,
    activeId,
    paneOrder,
    atMax,
    addTerminal,
    closeTerminal,
    setActiveId,
    renameTerminal,
    reorderTerminal,
    moveTerminalToEnd
  } = useTerminalTabs()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  // Keyed by pane id rather than a single "active pane" ref, since every
  // open tab's `TerminalPane` stays mounted (see the doc comment above) —
  // the `terminal.search` shortcut still only needs to reach whichever one
  // is currently active.
  const paneHandles = useRef(new Map<string, TerminalPaneHandle>())

  const cycleTab = (direction: 1 | -1): void => {
    if (tabs.length === 0) return
    const currentIndex = tabs.findIndex((t) => t.id === activeId)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + tabs.length) % tabs.length
    const next = tabs[nextIndex]
    if (next) setActiveId(next.id)
  }

  const startRename = (id: string, title: string): void => {
    setRenamingId(id)
    setDraftTitle(title)
  }

  const commitRename = (): void => {
    if (renamingId) renameTerminal(renamingId, draftTitle)
    setRenamingId(null)
  }

  useShortcutHandler('terminal.new', addTerminal)
  useShortcutHandler('terminal.close', () => {
    if (activeId) closeTerminal(activeId)
  })
  useShortcutHandler('terminal.nextTab', () => cycleTab(1))
  useShortcutHandler('terminal.prevTab', () => cycleTab(-1))
  useShortcutHandler('terminal.rename', () => {
    const activeTab = tabs.find((t) => t.id === activeId)
    if (activeTab) startRename(activeTab.id, activeTab.title)
  })
  useShortcutHandler('terminal.search', () => {
    if (activeId) paneHandles.current.get(activeId)?.openSearch()
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalTabBar
        tabs={tabs}
        activeId={activeId}
        atMax={atMax}
        onSelect={setActiveId}
        onClose={closeTerminal}
        onAdd={addTerminal}
        onReorder={reorderTerminal}
        onMoveToEnd={moveTerminalToEnd}
        renamingId={renamingId}
        draftTitle={draftTitle}
        onStartRename={(t) => startRename(t.id, t.title)}
        onDraftTitleChange={setDraftTitle}
        onCommitRename={commitRename}
        onCancelRename={() => setRenamingId(null)}
      />
      <div className="min-h-0 flex-1 bg-canvas-raised">
        {tabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <span className="text-[12px] text-text-faint">{t('terminal.none')}</span>
            <Button size="sm" onClick={addTerminal}>
              {t('terminal.new')}
            </Button>
          </div>
        ) : (
          paneOrder.map((id) => (
            <div key={id} className={id === activeId ? 'h-full' : 'hidden'}>
              <TerminalPane
                ref={(handle) => {
                  if (handle) paneHandles.current.set(id, handle)
                  else paneHandles.current.delete(id)
                }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
