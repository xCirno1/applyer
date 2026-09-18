import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatMessages,
  listChatSessions,
  renameChatSession,
  setChatSessionModel
} from '../db/repositories/chatRepository'
import { getOpenRouterSettings } from '../db/repositories/settingsRepository'
import { isSessionBusy } from '../openrouter/sessionActivity'
import { logActivity } from '../db/repositories/activityLogRepository'
import { broadcastChatEvent } from './chatBroadcast'
import { CHAT_MESSAGES_PAGE_SIZE, isToolApprovalDecision } from '@shared/types/chat'
import type { ChatSession, ListChatMessagesQuery, ListChatMessagesResult, PendingToolApproval } from '@shared/types/chat'
import { respondToolApproval, sendChatMessage, stopChatTurn } from '../openrouter/agentRunner'
import { listPendingApprovals } from '../openrouter/toolApprovalGate'

/*
 * CRUD for chat sessions and their message history: list/create/rename/
 * delete a session, pin a session to a different model, and page through
 * one session's messages, plus the four
 * handlers that actually drive a turn (`send`, `stop`,
 * `respondToolApproval`, `listPendingApprovals`) by delegating straight to
 * `agentRunner.ts`/`toolApprovalGate.ts`: this file's job for those four
 * is only payload validation, the turn itself lives there.
 *
 * Every handler validates its own payload rather than trusting the
 * renderer's TypeScript types, the same way `ipc/settings.ts` does. The
 * IPC boundary is JSON over a wire, not a function call, so a stale
 * preload build or a malformed replay can hand a handler anything.
 */

const sessionNotFound = { ok: false, error: appError('chatSessionNotFound') } as const

const MAX_MODEL_ID_LENGTH = 200

/** Overlays the in-memory "is a turn running" flag the repository itself has no notion of. */
function withBusy(session: ChatSession): ChatSession {
  return { ...session, busy: isSessionBusy(session.id) }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function registerChatIpc(): void {
  ipcMain.handle(IPC.chat.listSessions, (): ChatSession[] => listChatSessions().map(withBusy))

  ipcMain.handle(IPC.chat.createSession, (_event, payload: unknown) => {
    const title =
      typeof payload === 'object' && payload !== null && typeof (payload as { title?: unknown }).title === 'string'
        ? (payload as { title: string }).title
        : undefined
    let session: ChatSession
    try {
      // `createChatSession` throws only when the given title is over
      // `CHAT_SESSION_TITLE_MAX_CHARS`; anything else (a DB error reading
      // the row back) is genuinely unexpected.
      session = createChatSession({ title, modelId: getOpenRouterSettings().modelId })
    } catch {
      return { ok: false, error: appError('chatTitleTooLong') }
    }
    broadcastChatEvent({ type: 'session_updated', session })
    logActivity('info', `Chat session created: ${session.title}`)
    return { ok: true, session: withBusy(session) }
  })

  ipcMain.handle(IPC.chat.renameSession, (_event, payload: unknown) => {
    const sessionId =
      typeof payload === 'object' && payload !== null ? (payload as { sessionId?: unknown }).sessionId : undefined
    const title = typeof payload === 'object' && payload !== null ? (payload as { title?: unknown }).title : undefined
    if (!isNonEmptyString(sessionId) || typeof title !== 'string') return sessionNotFound
    if (!getChatSession(sessionId)) return sessionNotFound
    try {
      const session = renameChatSession(sessionId, title)
      if (!session) return sessionNotFound
      broadcastChatEvent({ type: 'session_updated', session })
      return { ok: true, session: withBusy(session) }
    } catch {
      // renameChatSession throws only for a title over the limit.
      return { ok: false, error: appError('chatTitleTooLong') }
    }
  })

  ipcMain.handle(IPC.chat.setSessionModel, (_event, payload: unknown) => {
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    const { sessionId, modelId } = record
    if (!isNonEmptyString(sessionId)) return sessionNotFound
    // A model id is OpenRouter's own `vendor/model` slug; anything longer
    // than this is not one, whatever the renderer thinks it read from the
    // catalog.
    if (!isNonEmptyString(modelId) || modelId.length > MAX_MODEL_ID_LENGTH) {
      return { ok: false, error: appError('invalidOpenRouterSettings') }
    }
    if (!getChatSession(sessionId)) return sessionNotFound
    if (isSessionBusy(sessionId)) return { ok: false, error: appError('chatSessionBusy') }
    try {
      const session = setChatSessionModel(sessionId, modelId)
      if (!session) return sessionNotFound
      broadcastChatEvent({ type: 'session_updated', session })
      return { ok: true, session: withBusy(session) }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.chat.deleteSession, (_event, payload: unknown) => {
    const sessionId =
      typeof payload === 'object' && payload !== null ? (payload as { sessionId?: unknown }).sessionId : undefined
    if (!isNonEmptyString(sessionId)) return sessionNotFound
    if (!getChatSession(sessionId)) return sessionNotFound
    if (isSessionBusy(sessionId)) return { ok: false, error: appError('chatSessionBusy') }
    try {
      if (!deleteChatSession(sessionId)) return sessionNotFound
      broadcastChatEvent({ type: 'session_deleted', sessionId })
      logActivity('info', 'Chat session deleted')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.chat.listMessages, (_event, payload: unknown): ListChatMessagesResult => {
    const raw = typeof payload === 'object' && payload !== null ? (payload as Partial<ListChatMessagesQuery>) : {}
    if (!isNonEmptyString(raw.sessionId)) return { messages: [], hasMore: false }
    const query: ListChatMessagesQuery = {
      sessionId: raw.sessionId,
      before: typeof raw.before === 'string' ? raw.before : undefined,
      limit: typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? raw.limit : CHAT_MESSAGES_PAGE_SIZE
    }
    try {
      return listChatMessages(query)
    } catch (err) {
      logActivity('error', 'Failed to list chat messages', { error: String(err) })
      return { messages: [], hasMore: false }
    }
  })

  ipcMain.handle(IPC.chat.send, async (_event, payload: unknown) => {
    const sessionId = typeof payload === 'object' && payload !== null ? (payload as { sessionId?: unknown }).sessionId : undefined
    const text = typeof payload === 'object' && payload !== null ? (payload as { text?: unknown }).text : undefined
    if (!isNonEmptyString(sessionId) || typeof text !== 'string') return sessionNotFound
    try {
      return await sendChatMessage(sessionId, text)
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.chat.stop, (_event, payload: unknown) => {
    const sessionId = typeof payload === 'object' && payload !== null ? (payload as { sessionId?: unknown }).sessionId : undefined
    if (!isNonEmptyString(sessionId)) return sessionNotFound
    try {
      return stopChatTurn(sessionId)
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.chat.respondToolApproval, (_event, payload: unknown) => {
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    const { sessionId, toolCallId, decision } = record
    if (!isNonEmptyString(sessionId) || !isNonEmptyString(toolCallId) || !isToolApprovalDecision(decision)) {
      return { ok: false, error: appError('chatToolApprovalNotWaiting') }
    }
    try {
      return respondToolApproval(sessionId, toolCallId, decision)
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.chat.listPendingApprovals, (): PendingToolApproval[] => listPendingApprovals())
}
