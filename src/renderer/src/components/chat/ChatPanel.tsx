import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatSession } from '@shared/types/chat'
import { isOpenRouterAuthStatus, type OpenRouterConnection, type OpenRouterSettings } from '@shared/types/openrouter'
import { MAX_CHAT_SESSIONS, useChatStore } from '../../state/chatStore'
import { callIpc } from '../../lib/ipcCall'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'
import Tooltip from '../ui/Tooltip'
import ConfirmDialog from '../ui/ConfirmDialog'
import AgentPermissionsMenu from '../terminal/AgentPermissionsMenu'
import ChatSessionList from './ChatSessionList'
import ChatThread from './ChatThread'
import ChatComposer from './ChatComposer'
import { insertIntoChat } from './chatBridge'
import { formatCost } from './chatPanelLogic'

interface ConnectionCheck {
  connection: OpenRouterConnection
  settings: OpenRouterSettings | null
}

/**
 * The OpenRouter agent's home: the panel `App.tsx`'s `MainShell` mounts on
 * the right of the rail screens in `openrouter` mode, laid out the way a
 * sidebar chat client is. Top to bottom: a header strip (title, agent
 * access menu, new chat, the session list toggle, agent settings, hide);
 * either the session list (`ChatSessionList`) or the open session's
 * thread (`ChatThread`, with `ChatWelcome` in an empty one); the composer
 * (`ChatComposer`, whose footer holds `ChatModelMenu`); and a status line
 * (connection, this chat's cost, how many tools ask first).
 *
 * `active` is whether the panel is actually on screen, not merely
 * mounted: the OpenRouter connection is cheap enough that a poll would be
 * overkill, so it's re-checked on mount, each time this becomes true
 * again (coming back from Settings, where the account may just have been
 * connected), and on every auth status push. The panel never unmounts on
 * a mode switch (see `MainShell`), so this is also what keeps a hidden
 * panel from doing that work.
 */
export default function ChatPanel({
  active,
  onHide,
  onOpenSettings
}: {
  active: boolean
  onHide: () => void
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('chat')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  const [check, setCheck] = useState<ConnectionCheck | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null)
  const [deleting, setDeleting] = useState(false)

  const sessions = useChatStore((s) => s.sessions)
  const sessionsLoadedOnce = useChatStore((s) => s.sessionsLoadedOnce)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === s.activeSessionId) ?? null)
  const messagesState = useChatStore((s) => (s.activeSessionId ? s.messagesBySession[s.activeSessionId] ?? null : null))
  const runtime = useChatStore((s) => (s.activeSessionId ? s.runtimeBySession[s.activeSessionId] ?? null : null))
  const selectSession = useChatStore((s) => s.selectSession)
  const createSession = useChatStore((s) => s.createSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const loadEarlier = useChatStore((s) => s.loadEarlier)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const respondApproval = useChatStore((s) => s.respondApproval)

  const loadCheck = useCallback(async (): Promise<ConnectionCheck> => {
    const [connection, settings] = await Promise.all([
      callIpc('openrouter.getConnection', () => window.api.openrouter.getConnection(), {
        connected: false as const,
        keychainAvailable: false
      }),
      callIpc('openrouter.getSettings', () => window.api.openrouter.getSettings(), null)
    ])
    return { connection, settings }
  }, [])
  const refreshCheck = useCallback((): Promise<void> => loadCheck().then(setCheck), [loadCheck])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void loadCheck().then((next) => {
      if (!cancelled) setCheck(next)
    })
    return () => {
      cancelled = true
    }
  }, [active, loadCheck])

  useEffect(
    () =>
      window.api.openrouter.onAuthStatus((status) => {
        if (!isOpenRouterAuthStatus(status)) {
          console.warn('Ignored malformed OpenRouter auth status', status)
          return
        }
        // `connected` is a fresh key; `idle` after a disconnect (or a
        // cancelled attempt) is the other transition worth re-reading.
        if (status.state === 'connected' || status.state === 'idle') void refreshCheck()
      }),
    [refreshCheck]
  )

  // A chat turn that came back 401 is the first the panel hears of a
  // revoked key; main dropped its cached connection on that failure, so
  // re-reading now shows the rejected state (and Settings' Reconnect).
  const keyRejectedByTurn = useChatStore((s) =>
    Object.values(s.runtimeBySession).some((runtime) => runtime.lastError?.error.code === 'openrouterKeyRejected')
  )
  useEffect(() => {
    if (keyRejectedByTurn) void refreshCheck()
  }, [keyRejectedByTurn, refreshCheck])

  const keyRejected = check?.connection.connected === true && check.connection.keyRejected
  const connected = (check?.connection.connected ?? false) && !keyRejected
  const modelConfigured = Boolean(check?.settings && check.settings.modelId.trim().length > 0)
  const ready = connected && modelConfigured
  const askCount = check?.settings?.toolApproval.askFor.length ?? 0
  const showList = listOpen || activeSessionId === null
  const atMax = sessions.length >= MAX_CHAT_SESSIONS

  // A ready panel with no sessions at all opens straight into a fresh one,
  // the way a chat client opens on an empty conversation rather than an
  // empty list. Once per empty state (the ref), so a create that fails
  // surfaces its toast once instead of retrying on every render.
  const autoCreatedRef = useRef(false)
  useEffect(() => {
    if (!active || !ready || !sessionsLoadedOnce) return
    if (sessions.length > 0) {
      autoCreatedRef.current = false
      return
    }
    if (autoCreatedRef.current) return
    autoCreatedRef.current = true
    void createSession().then((result) => {
      if (!result.ok) toast.error(errorMessage(result.error))
    })
  }, [active, ready, sessionsLoadedOnce, sessions.length, createSession, toast, errorMessage])

  const handleAdd = async (): Promise<void> => {
    const result = await createSession()
    if (!result.ok) {
      toast.error(errorMessage(result.error))
      return
    }
    setListOpen(false)
  }

  const handleSelect = async (id: string): Promise<void> => {
    await selectSession(id)
    setListOpen(false)
  }

  const handleRename = async (id: string, title: string): Promise<void> => {
    const result = await renameSession(id, title)
    if (!result.ok && result.error) toast.error(errorMessage(result.error))
  }

  const requestDelete = (session: ChatSession): void => {
    if (session.messageCount > 0) {
      setDeleteTarget(session)
      return
    }
    void deleteSession(session.id).then((result) => {
      if (!result.ok && result.error) toast.error(errorMessage(result.error))
    })
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await deleteSession(deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (!result.ok && result.error) toast.error(errorMessage(result.error))
  }

  const handleSend = async (text: string): Promise<boolean> => {
    const result = await send(text)
    if (!result.ok && result.error) toast.error(errorMessage(result.error))
    return result.ok
  }

  const pickStarter = (text: string): void => {
    insertIntoChat(text)
  }

  let body: ReactNode
  if (check === null || !sessionsLoadedOnce) {
    body = (
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  } else if (!ready) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="max-w-xs text-[12px] text-text-muted">
          {keyRejected ? t('emptyState.keyRejected') : connected ? t('emptyState.noModel') : t('emptyState.notConnected')}
        </p>
        <Button size="sm" variant="primary" onClick={onOpenSettings}>
          {t('emptyState.openSettings')}
        </Button>
      </div>
    )
  } else if (showList) {
    body = (
      <ChatSessionList
        sessions={sessions}
        activeId={activeSessionId}
        atMax={atMax}
        onSelect={(id) => void handleSelect(id)}
        onAdd={() => void handleAdd()}
        onRequestDelete={requestDelete}
        onRename={(id, title) => void handleRename(id, title)}
      />
    )
  } else {
    body = (
      <>
        {activeSession && (
          <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border-soft px-3">
            <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{activeSession.title}</span>
            {activeSession.totalCostUsd > 0 && (
              <span className="shrink-0 text-[11px] text-text-faint">{t('status.cost', { cost: formatCost(activeSession.totalCostUsd) })}</span>
            )}
          </div>
        )}
        <ChatThread
          sessionId={activeSessionId ?? ''}
          messagesState={messagesState}
          runtime={runtime}
          onLoadEarlier={() => {
            if (activeSessionId) void loadEarlier(activeSessionId)
          }}
          onRespondApproval={respondApproval}
          onPickStarter={pickStarter}
        />
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-inset">
      <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border-soft bg-canvas px-2">
        <span className="mr-auto pl-1 text-[11px] font-semibold uppercase tracking-wide text-text">{t('panel.title')}</span>
        {ready && <AgentPermissionsMenu />}
        <HeaderButton
          label={atMax ? t('sessions.atMax', { count: sessions.length }) : t('panel.newChat')}
          onClick={() => void handleAdd()}
          disabled={!ready || atMax}
        >
          <PlusIcon />
        </HeaderButton>
        <HeaderButton
          label={showList && activeSessionId ? t('panel.backToChat') : t('panel.showSessions')}
          onClick={() => setListOpen((v) => !v)}
          disabled={!ready || activeSessionId === null}
          pressed={showList}
        >
          <ListIcon />
        </HeaderButton>
        <HeaderButton label={t('panel.settings')} onClick={onOpenSettings}>
          <GearIcon />
        </HeaderButton>
        <HeaderButton label={t('panel.hide')} onClick={onHide}>
          <CloseIcon />
        </HeaderButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{body}</div>

      {ready && (
        <ChatComposer
          session={showList ? null : activeSession}
          busy={runtime?.busy ?? false}
          onSend={handleSend}
          onStop={() => void stop()}
          onBridgeInsert={() => setListOpen(false)}
        />
      )}

      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-border-soft bg-canvas px-3 text-[11px] text-text-faint">
        <span className={`min-w-0 truncate ${connected ? '' : 'text-warning'}`}>
          {connected
            ? check?.connection.connected && check.connection.keyInfo?.label
              ? t('status.connectedAs', { label: check.connection.keyInfo.label })
              : t('status.connected')
            : keyRejected
              ? t('status.keyRejected')
              : t('status.notConnected')}
        </span>
        {check?.settings && (
          <Tooltip label={t('status.approvalsHint')}>
            <button type="button" onClick={onOpenSettings} className="ml-auto shrink-0 cursor-pointer hover:text-text">
              {askCount > 0 ? t('status.approvals', { count: askCount }) : t('status.approvalsNone')}
            </button>
          </Tooltip>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('sessions.deleteConfirmTitle')}
        message={t('sessions.deleteConfirmMessage', { title: deleteTarget?.title ?? '' })}
        confirmLabel={t('sessions.deleteConfirmAction')}
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function HeaderButton({
  label,
  onClick,
  disabled = false,
  pressed,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center hover:text-text disabled:cursor-not-allowed disabled:opacity-40 ${
        pressed ? 'text-text' : 'text-text-faint'
      }`}
    >
      {children}
    </button>
  )
}

function PlusIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function ListIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1.5 3h9M1.5 6h9M1.5 9h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function GearIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function CloseIcon(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
