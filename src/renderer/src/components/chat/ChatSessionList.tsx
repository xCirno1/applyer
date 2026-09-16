import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatSession } from '@shared/types/chat'
import ContextMenu, { type ContextMenuState } from '../ui/ContextMenu'
import Spinner from '../ui/Spinner'
import Button from '../ui/Button'
import { useFormatters } from '../../i18n/format'
import { filterSessions, formatCost, relativeAge } from './chatPanelLogic'

/** How often the "5 min ago" column re-reads the clock; it never has to be more precise than its own smallest unit. */
const AGE_REFRESH_MS = 30_000

/**
 * The chat panel's session list, shown in place of the thread when the
 * user opens it from the header (or when no session is selected): a
 * filter field over one row per session, most recently active first,
 * mirroring how a sidebar chat client lists its conversations. A row is
 * the title, when it was last active, and how much it has cost; the
 * per-row actions (rename in place, delete) sit in a right-click menu
 * and behind a hover-revealed delete button, same conventions as
 * `terminal/TerminalTabBar.tsx`. No drag-to-reorder: sessions already
 * have a meaningful order (`chatStore` keeps them by `updatedAt`), so
 * there's nothing a manual reorder would preserve.
 */
export default function ChatSessionList({
  sessions,
  activeId,
  atMax,
  onSelect,
  onAdd,
  onRequestDelete,
  onRename
}: {
  sessions: ChatSession[]
  activeId: string | null
  atMax: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onRequestDelete: (session: ChatSession) => void
  onRename: (id: string, title: string) => void
}): ReactElement {
  const { t, i18n } = useTranslation('chat')
  const { date } = useFormatters()
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), AGE_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const relativeFormatter = useMemo(() => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }), [i18n.language])
  const ageLabel = (iso: string): string => {
    const age = relativeAge(iso, now)
    return age ? relativeFormatter.format(age.value, age.unit) : date(iso)
  }

  const visible = filterSessions(sessions, query)

  const startRename = (session: ChatSession): void => {
    setRenamingId(session.id)
    setDraftTitle(session.title)
  }

  const commitRename = (): void => {
    if (renamingId && draftTitle.trim()) onRename(renamingId, draftTitle.trim())
    setRenamingId(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-soft px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t('sessions.heading')}</span>
        <input
          type="search"
          aria-label={t('sessions.search')}
          placeholder={t('sessions.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto h-5 w-36 min-w-0 border border-border bg-canvas-soft px-1.5 text-[11px] text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-[12px] text-text-muted">{t('sessions.empty')}</p>
          <Button size="sm" variant="primary" onClick={onAdd} disabled={atMax}>
            {t('panel.newChat')}
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="p-6 text-center text-[12px] text-text-faint">{t('sessions.noMatches')}</p>
      ) : (
        <ul role="listbox" aria-label={t('sessions.listLabel')} className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((session) => {
            const active = session.id === activeId
            return (
              <li
                key={session.id}
                role="option"
                aria-selected={active}
                tabIndex={0}
                onClick={() => onSelect(session.id)}
                onDoubleClick={() => startRename(session)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenuState({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      { type: 'action', key: 'rename', label: t('sessions.rename'), onSelect: () => startRename(session) },
                      { type: 'action', key: 'delete', label: t('sessions.delete'), onSelect: () => onRequestDelete(session) }
                    ]
                  })
                }}
                onKeyDown={(e) => {
                  if (renamingId === session.id) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(session.id)
                  } else if (e.key === 'F2') {
                    e.preventDefault()
                    startRename(session)
                  } else if (e.key === 'Delete') {
                    e.preventDefault()
                    onRequestDelete(session)
                  }
                }}
                className={`group flex cursor-pointer flex-col gap-0.5 border-b border-l-2 border-border-soft py-1.5 pr-2 pl-2.5 ${
                  active ? 'border-l-accent bg-canvas-soft' : 'border-l-transparent hover:bg-canvas-soft'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {session.busy && <Spinner className="h-2.5 w-2.5 shrink-0 text-accent" />}
                  {renamingId === session.id ? (
                    <input
                      autoFocus
                      aria-label={t('sessions.renameLabel', { title: session.title })}
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        else if (e.key === 'Escape') setRenamingId(null)
                        e.stopPropagation()
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="h-5 min-w-0 flex-1 border border-accent bg-canvas px-1 text-[12px] text-text outline-none"
                    />
                  ) : (
                    <span className={`min-w-0 flex-1 truncate text-[12px] ${active ? 'text-text' : 'text-text-muted group-hover:text-text'}`}>
                      {session.title}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRequestDelete(session)
                    }}
                    aria-label={t('sessions.deleteLabel', { title: session.title })}
                    className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-text-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"
                  >
                    <CloseIcon />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
                  <span>{session.busy ? t('sessions.working') : ageLabel(session.updatedAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t('sessions.messageCount', { count: session.messageCount })}</span>
                  {session.totalCostUsd > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatCost(session.totalCostUsd)}</span>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

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
