import { create } from 'zustand'
import { callIpc } from '../lib/ipcCall'
import { appError, type AppError } from '@shared/types/errorCodes'
import {
  CHAT_MESSAGES_PAGE_SIZE,
  isChatSession,
  isChatStreamEvent,
  type ChatMessage,
  type ChatSession,
  type ToolApprovalDecision
} from '@shared/types/chat'
import {
  MAX_CHAT_SESSIONS,
  appendLocalMessage,
  applyInitialMessagesPage,
  applyOlderMessagesPage,
  applyPendingApprovals,
  emptyChatFoldState,
  foldChatEvent,
  pickInitialSession,
  readStoredActiveSessionId,
  removeSessionState,
  setSessionMessagesLoading,
  setSessions,
  upsertSession,
  writeStoredActiveSessionId,
  type ChatFoldState,
  type SessionMessagesState,
  type SessionRuntimeState
} from './chatStoreLogic'

export { MAX_CHAT_SESSIONS }

/**
 * The chat panel's state: sessions (the session list), each session's
 * persisted message page(s), and each session's live turn (streaming text,
 * pending approvals, busy). The event-folding itself is `chatStoreLogic.ts`'s pure
 * `foldChatEvent` - this module is only the IPC glue around it: fetching
 * pages, dispatching mutations, and turning `window.api.chat.onEvent` into
 * calls to that reducer, mirroring `agentModeStore.ts`'s
 * subscribe-from-MainShell shape and `runsStore.ts`'s optimistic-mutation
 * conventions.
 *
 * `activeSessionId` is the one session whose messages this window has
 * fetched-and-is-showing; switching sessions fetches on first visit and
 * reuses the kept slice afterwards, same as `resumesStore`'s selected
 * variant.
 *
 * Every mutation that main also narrates with a `session_updated` /
 * `session_deleted` broadcast goes through `upsertSession` /
 * `removeSessionState` rather than a bare prepend or filter: the broadcast
 * is sent before the invoke resolves, so it routinely lands *first*, and a
 * prepend on top of it is exactly how a single "New chat" click once
 * produced the same session twice in the list.
 */

const BRIDGE_FAILURE_ERROR: AppError = appError('unexpected')

interface ChatState extends ChatFoldState {
  activeSessionId: string | null
  sessionsLoading: boolean
  sessionsLoadedOnce: boolean
  /** Session ids currently applying send/stop/rename/delete, so their controls can disable. */
  actingSessionIds: Record<string, boolean>

  load: () => Promise<void>
  selectSession: (sessionId: string | null) => Promise<void>
  createSession: () => Promise<{ ok: true; session: ChatSession } | { ok: false; error: AppError }>
  renameSession: (sessionId: string, title: string) => Promise<{ ok: boolean; error?: AppError }>
  setSessionModel: (sessionId: string, modelId: string) => Promise<{ ok: boolean; error?: AppError }>
  deleteSession: (sessionId: string) => Promise<{ ok: boolean; error?: AppError }>
  loadEarlier: (sessionId: string) => Promise<void>
  send: (text: string) => Promise<{ ok: boolean; error?: AppError }>
  stop: () => Promise<void>
  respondApproval: (toolCallId: string, decision: ToolApprovalDecision) => Promise<void>
  subscribe: () => () => void
}

function messagesFor(state: ChatFoldState, sessionId: string | null): SessionMessagesState | null {
  return sessionId ? state.messagesBySession[sessionId] ?? null : null
}

function runtimeFor(state: ChatFoldState, sessionId: string | null): SessionRuntimeState | null {
  return sessionId ? state.runtimeBySession[sessionId] ?? null : null
}

/** Selectors kept alongside the store so callers read a stable shape rather than reaching into the maps by hand. */
export function useActiveSessionMessages(): SessionMessagesState | null {
  return useChatStore((s) => messagesFor(s, s.activeSessionId))
}

export function useActiveSessionRuntime(): SessionRuntimeState | null {
  return useChatStore((s) => runtimeFor(s, s.activeSessionId))
}

export const useChatStore = create<ChatState>((set, get) => ({
  ...emptyChatFoldState(),
  activeSessionId: null,
  sessionsLoading: false,
  sessionsLoadedOnce: false,
  actingSessionIds: {},

  load: async () => {
    set({ sessionsLoading: true })
    const [sessions, approvals] = await Promise.all([
      callIpc('chat.listSessions', () => window.api.chat.listSessions(), [] as ChatSession[]),
      callIpc('chat.listPendingApprovals', () => window.api.chat.listPendingApprovals(), [])
    ])
    const validSessions = sessions.filter((session) => {
      if (isChatSession(session)) return true
      console.warn('Ignored malformed chat session', session)
      return false
    })
    let state = setSessions(get(), validSessions)
    state = applyPendingApprovals(state, approvals)
    set({ ...state, sessionsLoading: false, sessionsLoadedOnce: true })

    const initialId = pickInitialSession(validSessions, readStoredActiveSessionId())
    if (initialId) await get().selectSession(initialId)
  },

  selectSession: async (sessionId) => {
    writeStoredActiveSessionId(sessionId)
    set({ activeSessionId: sessionId })
    if (!sessionId) return
    const existing = get().messagesBySession[sessionId]
    if (existing?.loadedOnce) return

    set((state) => setSessionMessagesLoading(state, sessionId, true))
    const result = await callIpc(
      'chat.listMessages',
      () => window.api.chat.listMessages({ sessionId, limit: CHAT_MESSAGES_PAGE_SIZE }),
      { messages: [], hasMore: false }
    )
    // Applied even if the user has since switched to another tab: the
    // fetch already happened, and keeping the result means switching back
    // to this session won't re-fetch it.
    set((state) => applyInitialMessagesPage(state, sessionId, result))
  },

  loadEarlier: async (sessionId) => {
    const current = get().messagesBySession[sessionId]
    if (!current || current.loading || !current.hasMore) return
    const oldest = current.messages[0]
    set((state) => setSessionMessagesLoading(state, sessionId, true))
    const result = await callIpc(
      'chat.listMessages',
      () => window.api.chat.listMessages({ sessionId, before: oldest?.id, limit: CHAT_MESSAGES_PAGE_SIZE }),
      { messages: [], hasMore: false }
    )
    set((state) => applyOlderMessagesPage(state, sessionId, result))
  },

  createSession: async () => {
    if (get().sessions.length >= MAX_CHAT_SESSIONS) {
      return { ok: false, error: appError('unexpected', { message: 'Session limit reached' }) }
    }
    const result = await callIpc('chat.createSession', () => window.api.chat.createSession(), {
      ok: false as const,
      error: BRIDGE_FAILURE_ERROR
    })
    if (result.ok) {
      set((state) => ({ ...state, sessions: upsertSession(state.sessions, result.session) }))
      await get().selectSession(result.session.id)
    }
    return result
  },

  renameSession: async (sessionId, title) => {
    set((state) => ({ actingSessionIds: { ...state.actingSessionIds, [sessionId]: true } }))
    const result = await callIpc(
      'chat.renameSession',
      () => window.api.chat.renameSession(sessionId, title),
      { ok: false as const, error: BRIDGE_FAILURE_ERROR }
    )
    set((state) => {
      const actingSessionIds = { ...state.actingSessionIds }
      delete actingSessionIds[sessionId]
      return {
        actingSessionIds,
        sessions: result.ok ? upsertSession(state.sessions, result.session) : state.sessions
      }
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  },

  setSessionModel: async (sessionId, modelId) => {
    set((state) => ({ actingSessionIds: { ...state.actingSessionIds, [sessionId]: true } }))
    const result = await callIpc(
      'chat.setSessionModel',
      () => window.api.chat.setSessionModel(sessionId, modelId),
      { ok: false as const, error: BRIDGE_FAILURE_ERROR }
    )
    set((state) => {
      const actingSessionIds = { ...state.actingSessionIds }
      delete actingSessionIds[sessionId]
      return {
        actingSessionIds,
        sessions: result.ok ? upsertSession(state.sessions, result.session) : state.sessions
      }
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  },

  deleteSession: async (sessionId) => {
    set((state) => ({ actingSessionIds: { ...state.actingSessionIds, [sessionId]: true } }))
    const result = await callIpc(
      'chat.deleteSession',
      () => window.api.chat.deleteSession(sessionId),
      { ok: false as const, error: BRIDGE_FAILURE_ERROR }
    )
    // A session main no longer has is, for this window, already deleted:
    // dropping it locally is the right outcome, not an error toast.
    if (!result.ok && result.error.code !== 'chatSessionNotFound') {
      set((state) => {
        const actingSessionIds = { ...state.actingSessionIds }
        delete actingSessionIds[sessionId]
        return { actingSessionIds }
      })
      return result
    }
    set((state) => {
      const actingSessionIds = { ...state.actingSessionIds }
      delete actingSessionIds[sessionId]
      return { ...removeSessionState(state, sessionId), actingSessionIds }
    })
    if (get().activeSessionId === sessionId) {
      const next = get().sessions[0]?.id ?? null
      await get().selectSession(next)
    }
    return { ok: true }
  },

  send: async (text) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return { ok: false, error: appError('chatSessionNotFound') }
    const result = await callIpc(
      'chat.send',
      () => window.api.chat.send(sessionId, text),
      { ok: false as const, error: BRIDGE_FAILURE_ERROR }
    )
    if (result.ok) {
      const userMessage: ChatMessage = {
        id: result.messageId,
        sessionId,
        role: 'user',
        content: text,
        reasoning: null,
        reasoningDetails: null,
        toolCalls: null,
        toolCallId: null,
        modelId: null,
        usage: null,
        error: null,
        createdAt: new Date().toISOString()
      }
      set((state) => appendLocalMessage(state, sessionId, userMessage))
      return { ok: true }
    }
    // The session this window was showing is gone on main's side (deleted
    // from elsewhere, or a list that fell out of sync): refetch the list so
    // the panel lands on a session that actually exists.
    if (result.error.code === 'chatSessionNotFound') {
      set((state) => removeSessionState(state, sessionId))
      writeStoredActiveSessionId(null)
      void get().load()
    }
    return { ok: false, error: result.error }
  },

  stop: async () => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    await callIpc('chat.stop', () => window.api.chat.stop(sessionId), { ok: false as const, error: BRIDGE_FAILURE_ERROR })
    // No optimistic change here: the running turn answers with its own
    // `tool_call_updated` (cancelled) and `turn_failed`/`turn_completed`
    // events, which is what actually clears `busy`.
  },

  respondApproval: async (toolCallId, decision) => {
    const state = get()
    const sessionId =
      Object.entries(state.runtimeBySession).find(([, runtime]) =>
        runtime.pendingApprovals.some((a) => a.toolCallId === toolCallId)
      )?.[0] ?? state.activeSessionId
    if (!sessionId) return
    await callIpc(
      'chat.respondToolApproval',
      () => window.api.chat.respondToolApproval({ sessionId, toolCallId, decision }),
      { ok: false as const, error: BRIDGE_FAILURE_ERROR }
    )
  },

  subscribe: () => {
    void get().load()
    return window.api.chat.onEvent((event) => {
      if (!isChatStreamEvent(event)) {
        console.warn('Ignored malformed chat stream event', event)
        return
      }
      set((state) => foldChatEvent(state, event))
    })
  }
}))
