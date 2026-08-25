import { useRef, useState, type DragEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalTab } from './useTerminalTabs'
import ContextMenu, { type ContextMenuState } from '../ui/ContextMenu'

export default function TerminalTabBar({
  tabs,
  activeId,
  atMax,
  onSelect,
  onClose,
  onAdd,
  onReorder,
  onMoveToEnd,
  renamingId,
  draftTitle,
  onStartRename,
  onDraftTitleChange,
  onCommitRename,
  onCancelRename
}: {
  tabs: TerminalTab[]
  activeId: string | null
  atMax: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  onReorder: (dragId: string, targetId: string) => void
  onMoveToEnd: (dragId: string) => void
  renamingId: string | null
  draftTitle: string
  onStartRename: (t: TerminalTab) => void
  onDraftTitleChange: (title: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
}): ReactElement {
  const { t: translate } = useTranslation('workspace')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null)
  // Chromium sometimes still fires a trailing `click` on whatever's under the
  // cursor after a completed native drag-and-drop gesture (most reliably on
  // short drags, e.g. nudging a tab toward the end of the strip). Left
  // unguarded, that phantom click can hit a tab's `onSelect` or — worse, if
  // the drop landed on/near the "+" button — `onAdd`, spawning a genuinely
  // new pty and retyping the auto-start command, which looks exactly like
  // the whole terminal "restarted". Capture-phase on the whole bar so it
  // swallows the ghost click before ANY child's onClick runs, not just tabs.
  const suppressClickRef = useRef(false)

  const handleDragStart = (e: DragEvent<HTMLDivElement>, t: TerminalTab): void => {
    e.dataTransfer.setData('text/plain', t.id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(t.id)
    suppressClickRef.current = true
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>, t: TerminalTab): void => {
    if (!draggingId || draggingId === t.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(t.id)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>, t: TerminalTab): void => {
    e.preventDefault()
    e.stopPropagation() // handled here — don't let the bar-level "drop past the end" handler also fire
    const dragId = e.dataTransfer.getData('text/plain')
    if (dragId && dragId !== t.id) onReorder(dragId, t.id)
    setDraggingId(null)
    setDragOverId(null)
  }

  const handleDragEnd = (): void => {
    setDraggingId(null)
    setDragOverId(null)
    // A same-gesture ghost click (if the browser fires one) lands before a
    // real future click ever could, so a macrotask delay is enough to only
    // swallow that one and not any genuine subsequent click.
    setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  return (
    <div
      className="flex h-6 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-soft bg-canvas-inset px-1"
      onClickCapture={(e) => {
        if (!suppressClickRef.current) return
        suppressClickRef.current = false
        e.stopPropagation()
      }}
      onDragOver={(e) => {
        if (!draggingId) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        // Only reached when the drop didn't land on a specific tab (which
        // stops propagation itself) — i.e. the empty space after the last
        // tab, or the "+" button. Treat that as "move to the end", since
        // there's no other tab there to drop "onto".
        e.preventDefault()
        const dragId = e.dataTransfer.getData('text/plain')
        if (dragId) onMoveToEnd(dragId)
        setDraggingId(null)
        setDragOverId(null)
      }}
    >
      {tabs.map((t) => (
        <div
          key={t.id}
          draggable={renamingId !== t.id}
          onDragStart={(e) => handleDragStart(e, t)}
          onDragOver={(e) => handleDragOver(e, t)}
          onDragLeave={() => setDragOverId((id) => (id === t.id ? null : id))}
          onDrop={(e) => handleDrop(e, t)}
          onDragEnd={handleDragEnd}
          onClick={() => onSelect(t.id)}
          onDoubleClick={() => onStartRename(t)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenuState({
              x: e.clientX,
              y: e.clientY,
              items: [{ type: 'action', key: 'rename', label: translate('terminal.rename'), onSelect: () => onStartRename(t) }]
            })
          }}
          className={`group flex h-full shrink-0 cursor-pointer items-center gap-1 border-r border-border-soft border-l-2 px-2 text-[11px] ${
            dragOverId === t.id ? 'border-l-accent' : 'border-l-transparent'
          } ${draggingId === t.id ? 'opacity-40' : ''} ${
            t.id === activeId ? 'bg-canvas-raised text-text' : 'text-text-muted hover:text-text'
          }`}
        >
          {renamingId === t.id ? (
            <input
              autoFocus
              aria-label={translate('terminal.renameLabel', { title: t.title })}
              value={draftTitle}
              onChange={(e) => onDraftTitleChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitRename()
                else if (e.key === 'Escape') onCancelRename()
              }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="h-4 w-24 border border-accent bg-canvas-soft px-1 text-[11px] text-text outline-none"
            />
          ) : (
            <span className="max-w-24 truncate">{t.title}</span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
            aria-label={translate('terminal.closeLabel', { title: t.title })}
            className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center text-text-faint opacity-0 hover:text-text group-hover:opacity-100"
          >
            <CloseIcon />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        disabled={atMax}
        title={atMax ? translate('terminal.atMax', { count: tabs.length }) : translate('terminal.new')}
        aria-label={translate('terminal.new')}
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center text-text-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PlusIcon />
      </button>

      <ContextMenu state={menuState} onClose={() => setMenuState(null)} />
    </div>
  )
}

function CloseIcon(): ReactElement {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
