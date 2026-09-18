import type { AppError } from '@shared/types/errorCodes'
import type {
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  ChatToolCall,
  ListChatMessagesResult,
  PendingToolApproval
} from '@shared/types/chat'

/**
 * Pure event-folding for the chat panel, split out of `chatStore.ts` the same
 * way `workspaceLayout.ts` is split from `useWorkspaceLayout.ts`: no
 * zustand, no IPC, so every `ChatStreamEvent` transition is exercisable
 * without mounting anything.
 *
 * Sessions and their messages are two different lifetimes. `sessions` is
 * the tab strip's list, kept current for every session regardless of
 * whether its messages were ever fetched (a background turn still has to
 * flip its tab's busy indicator and update its cost). `messagesBySession`
 * only gains an entry once `selectSession` has fetched a session's first
 * page - until then that session is "unloaded", and per the chat store's
 * contract, an event for it does nothing beyond whatever `sessions` update
 * above already covers (deltas, proposed/updated tool calls, and approval
 * requests for a session nobody has opened yet are simply not worth
 * buffering: the moment it is opened, `listMessages` returns whatever the
 * main process has since persisted). `runtimeBySession` (the in-flight
 * streaming message, pending approvals, busy) is created lazily per
 * session and, unlike `messagesBySession`, is also populated by
 * `applyPendingApprovals` - the one-shot rehydration on mount - so a
 * session's approval card is ready the instant it *is* opened, without
 * waiting for a live event that already happened before this window did.
 *
 * Nothing here ever drops an already-loaded message: pagination is
 * strictly user-driven (`loadEarlier`), so there is no unbounded background
 * growth to cap against in the first place.
 */

export interface StreamingMessage {
  messageId: string
  content: string
  reasoning: string
  toolCalls: ChatToolCall[]
}

export interface SessionMessagesState {
  messages: ChatMessage[]
  hasMore: boolean
  loading: boolean
  loadedOnce: boolean
}

export interface SessionRuntimeState {
  streaming: StreamingMessage | null
  pendingApprovals: PendingToolApproval[]
  busy: boolean
  /**
   * The last `turn_failed` since the last `turn_started`. A stream error
   * also lands on the assistant message (`message.error`), but a turn can
   * fail with no message to carry it (the key cleared mid-turn, the
   * round cap), and the thread has to show that somewhere.
   */
  lastError: TurnFailure | null
}

export interface TurnFailure {
  error: AppError
  /** The assistant message the failure belongs to, when there is one; the thread skips the line if that message already shows the same error. */
  messageId: string | null
}

export interface ChatFoldState {
  sessions: ChatSession[]
  messagesBySession: Record<string, SessionMessagesState>
  runtimeBySession: Record<string, SessionRuntimeState>
}

/** Sane ceiling on concurrent chat sessions, same shape as the terminal's `MAX_TERMINALS`. */
export const MAX_CHAT_SESSIONS = 12

export function emptySessionMessages(): SessionMessagesState {
  return { messages: [], hasMore: false, loading: false, loadedOnce: false }
}

export function emptyRuntime(): SessionRuntimeState {
  return { streaming: null, pendingApprovals: [], busy: false, lastError: null }
}

export function emptyChatFoldState(): ChatFoldState {
  return { sessions: [], messagesBySession: {}, runtimeBySession: {} }
}

function runtimeFor(state: ChatFoldState, sessionId: string): SessionRuntimeState {
  return state.runtimeBySession[sessionId] ?? emptyRuntime()
}

function withRuntime(state: ChatFoldState, sessionId: string, patch: Partial<SessionRuntimeState>): ChatFoldState {
  return {
    ...state,
    runtimeBySession: { ...state.runtimeBySession, [sessionId]: { ...runtimeFor(state, sessionId), ...patch } }
  }
}

/** Replace-by-id, or prepend when the session is new to this window (a session created elsewhere). */
export function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  const index = sessions.findIndex((s) => s.id === session.id)
  if (index === -1) return [session, ...sessions]
  const next = [...sessions]
  next[index] = session
  return next
}

/**
 * Folds one validated `ChatStreamEvent` into state. Every branch of the
 * union is handled explicitly (see the `default` case's exhaustiveness
 * check) - a genuinely unrecognised event never reaches here, since
 * `isChatStreamEvent` already dropped it at the IPC boundary; that is also
 * where the "ignored with a console warning" behaviour lives, since this
 * function stays a pure reducer with no side effects.
 */
export function foldChatEvent(state: ChatFoldState, event: ChatStreamEvent): ChatFoldState {
  if (event.type === 'session_updated') {
    return { ...state, sessions: upsertSession(state.sessions, event.session) }
  }
  if (event.type === 'session_deleted') {
    const messagesBySession = { ...state.messagesBySession }
    delete messagesBySession[event.sessionId]
    const runtimeBySession = { ...state.runtimeBySession }
    delete runtimeBySession[event.sessionId]
    return {
      sessions: state.sessions.filter((s) => s.id !== event.sessionId),
      messagesBySession,
      runtimeBySession
    }
  }

  const { sessionId } = event
  const loaded = state.messagesBySession[sessionId] !== undefined
  if (!loaded) return state

  switch (event.type) {
    case 'turn_started':
      return withRuntime(state, sessionId, {
        busy: true,
        lastError: null,
        streaming: { messageId: event.messageId, content: '', reasoning: '', toolCalls: [] }
      })

    case 'content_delta': {
      const runtime = runtimeFor(state, sessionId)
      if (!runtime.streaming || runtime.streaming.messageId !== event.messageId) return state
      return withRuntime(state, sessionId, { streaming: { ...runtime.streaming, content: runtime.streaming.content + event.delta } })
    }

    case 'reasoning_delta': {
      const runtime = runtimeFor(state, sessionId)
      if (!runtime.streaming || runtime.streaming.messageId !== event.messageId) return state
      return withRuntime(state, sessionId, {
        streaming: { ...runtime.streaming, reasoning: runtime.streaming.reasoning + event.delta }
      })
    }

    case 'tool_calls_proposed': {
      const runtime = runtimeFor(state, sessionId)
      if (!runtime.streaming || runtime.streaming.messageId !== event.messageId) return state
      return withRuntime(state, sessionId, { streaming: { ...runtime.streaming, toolCalls: event.toolCalls } })
    }

    case 'tool_call_updated': {
      const runtime = runtimeFor(state, sessionId)
      // A call moving off `pending_approval` (approved, denied, or resolved
      // some other way) is no longer something the composer needs to ask
      // about, whether or not it's the call this message's approval card
      // came from.
      const pendingApprovals = runtime.pendingApprovals.filter((a) => a.toolCallId !== event.toolCall.id)
      let next = withRuntime(state, sessionId, { pendingApprovals })
      const nextRuntime = runtimeFor(next, sessionId)

      if (nextRuntime.streaming && nextRuntime.streaming.messageId === event.messageId) {
        const exists = nextRuntime.streaming.toolCalls.some((c) => c.id === event.toolCall.id)
        const toolCalls = exists
          ? nextRuntime.streaming.toolCalls.map((c) => (c.id === event.toolCall.id ? event.toolCall : c))
          : [...nextRuntime.streaming.toolCalls, event.toolCall]
        next = withRuntime(next, sessionId, { streaming: { ...nextRuntime.streaming, toolCalls } })
      }

      // The call's message may already be persisted (a tool that keeps
      // running briefly after `message_completed` narrated the assistant's
      // turn) - patch it there too so the card reflects the final status.
      const messagesState = next.messagesBySession[sessionId]
      if (messagesState) {
        const messages = messagesState.messages.map((m) =>
          m.toolCalls?.some((c) => c.id === event.toolCall.id)
            ? { ...m, toolCalls: m.toolCalls.map((c) => (c.id === event.toolCall.id ? event.toolCall : c)) }
            : m
        )
        next = { ...next, messagesBySession: { ...next.messagesBySession, [sessionId]: { ...messagesState, messages } } }
      }
      return next
    }

    case 'tool_approval_requested': {
      const runtime = runtimeFor(state, sessionId)
      const approval: PendingToolApproval = {
        sessionId,
        messageId: event.messageId,
        toolCallId: event.toolCallId,
        name: event.name,
        arguments: event.arguments
      }
      if (runtime.pendingApprovals.some((a) => a.toolCallId === approval.toolCallId)) return state
      return withRuntime(state, sessionId, { pendingApprovals: [...runtime.pendingApprovals, approval] })
    }

    case 'message_completed': {
      const runtime = runtimeFor(state, sessionId)
      const messagesState = state.messagesBySession[sessionId] ?? emptySessionMessages()
      const messages = messagesState.messages.some((m) => m.id === event.message.id)
        ? messagesState.messages.map((m) => (m.id === event.message.id ? event.message : m))
        : [...messagesState.messages, event.message]
      const resolvedIds = new Set((event.message.toolCalls ?? []).map((c) => c.id))

      let next = withRuntime(state, sessionId, {
        streaming: runtime.streaming?.messageId === event.message.id ? null : runtime.streaming,
        pendingApprovals: runtime.pendingApprovals.filter((a) => !resolvedIds.has(a.toolCallId))
      })
      next = { ...next, messagesBySession: { ...next.messagesBySession, [sessionId]: { ...messagesState, messages } } }
      return next
    }

    case 'turn_completed':
      return withRuntime(state, sessionId, { busy: false, streaming: null })

    case 'turn_failed':
      return withRuntime(state, sessionId, {
        busy: false,
        streaming: null,
        lastError: { error: event.error, messageId: event.messageId }
      })

    default: {
      // Exhaustiveness check: a new ChatStreamEvent variant not yet handled
      // above is a compile error here rather than a silently swallowed event.
      const exhaustive: never = event
      return exhaustive
    }
  }
}

/** The first page of a session's history, freshly fetched (either the initial load or a refresh). */
export function applyInitialMessagesPage(
  state: ChatFoldState,
  sessionId: string,
  result: ListChatMessagesResult
): ChatFoldState {
  return {
    ...state,
    messagesBySession: {
      ...state.messagesBySession,
      [sessionId]: { messages: result.messages, hasMore: result.hasMore, loading: false, loadedOnce: true }
    }
  }
}

/** An older page, prepended ahead of whatever is already loaded (deduped, in case of overlap). */
export function applyOlderMessagesPage(
  state: ChatFoldState,
  sessionId: string,
  result: ListChatMessagesResult
): ChatFoldState {
  const existing = state.messagesBySession[sessionId] ?? emptySessionMessages()
  const known = new Set(existing.messages.map((m) => m.id))
  const older = result.messages.filter((m) => !known.has(m.id))
  return {
    ...state,
    messagesBySession: {
      ...state.messagesBySession,
      [sessionId]: { messages: [...older, ...existing.messages], hasMore: result.hasMore, loading: false, loadedOnce: true }
    }
  }
}

export function setSessionMessagesLoading(state: ChatFoldState, sessionId: string, loading: boolean): ChatFoldState {
  const existing = state.messagesBySession[sessionId] ?? emptySessionMessages()
  return { ...state, messagesBySession: { ...state.messagesBySession, [sessionId]: { ...existing, loading } } }
}

/** Optimistic insert of the user's own message, sent before any stream event narrates it. */
export function appendLocalMessage(state: ChatFoldState, sessionId: string, message: ChatMessage): ChatFoldState {
  const existing = state.messagesBySession[sessionId] ?? emptySessionMessages()
  if (existing.messages.some((m) => m.id === message.id)) return state
  return {
    ...state,
    messagesBySession: { ...state.messagesBySession, [sessionId]: { ...existing, messages: [...existing.messages, message] } }
  }
}

/**
 * One-shot rehydration for `listPendingApprovals()`, called on mount: the
 * app may have been reloaded mid-turn, so approvals a live event will never
 * repeat have to be seeded directly into `runtimeBySession`, for sessions
 * whether or not they happen to be loaded yet.
 */
export function applyPendingApprovals(state: ChatFoldState, approvals: PendingToolApproval[]): ChatFoldState {
  const bySession = new Map<string, PendingToolApproval[]>()
  for (const approval of approvals) {
    const list = bySession.get(approval.sessionId) ?? []
    list.push(approval)
    bySession.set(approval.sessionId, list)
  }
  let next = state
  for (const [sessionId, list] of bySession) {
    next = withRuntime(next, sessionId, { pendingApprovals: list })
  }
  return next
}

export function setSessions(state: ChatFoldState, sessions: ChatSession[]): ChatFoldState {
  return { ...state, sessions }
}

export function removeSessionState(state: ChatFoldState, sessionId: string): ChatFoldState {
  const messagesBySession = { ...state.messagesBySession }
  delete messagesBySession[sessionId]
  const runtimeBySession = { ...state.runtimeBySession }
  delete runtimeBySession[sessionId]
  return { sessions: state.sessions.filter((s) => s.id !== sessionId), messagesBySession, runtimeBySession }
}

const ACTIVE_SESSION_STORAGE_KEY = 'chat:activeSessionId:v1'

/** Which session tab was open last, so a reload doesn't drop back to "no session selected". */
export function readStoredActiveSessionId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)
  } catch {
    // Disabled storage or a security exception - not worth surfacing, the session just isn't remembered.
    return null
  }
}

export function writeStoredActiveSessionId(sessionId: string | null): void {
  try {
    if (sessionId === null) window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
    else window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId)
  } catch {
    // Same reasoning as the read - the session still works for this run.
  }
}

/** The session to land on after `listSessions()`: the remembered one if it still exists, else the most recent. */
export function pickInitialSession(sessions: ChatSession[], storedId: string | null): string | null {
  if (storedId && sessions.some((s) => s.id === storedId)) return storedId
  return sessions[0]?.id ?? null
}
