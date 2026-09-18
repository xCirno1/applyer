import { randomUUID } from 'crypto'
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm'
import { getDb } from '../index'
import { chatMessages, chatSessions } from '../schema'
import { readSecureField, writeSecureField } from '../encryption'
import { getStorageMode } from './settingsRepository'
import { logActivity } from './activityLogRepository'
import { isAppError } from '@shared/types/errorCodes'
import {
  CHAT_MESSAGES_PAGE_SIZE,
  CHAT_SESSION_TITLE_MAX_CHARS,
  isChatRole,
  isChatToolCallStatus,
  type ChatMessage,
  type ChatSession,
  type ChatToolCall,
  type ChatUsage,
  type ListChatMessagesQuery,
  type ListChatMessagesResult
} from '@shared/types/chat'
import type { ExportChatSession } from '@shared/types/dataTransfer'
import type { StorageMode } from '@shared/types/profile'

/*
 * Storage for chat sessions and their messages (see `shared/types/chat.ts`).
 * A session is OpenRouter mode's equivalent of a terminal tab; a message is
 * one turn's worth of content, reasoning, and proposed tool calls.
 *
 * Four columns per message are secure fields, written and read through
 * `writeSecureField`/`readSecureField` exactly the way `profileRepository`
 * and `resumeRepository` treat their own sensitive payloads: `content` and
 * `reasoning` because a chat is a free-form conversation that can restate
 * anything the user pastes into it, and `reasoningDetails`/`toolCalls`
 * because a tool call's arguments and result routinely carry profile data
 * (the MCP tools this agent calls are the same ones a human uses). `usage`
 * and `error` stay plain JSON, since token counts and an error code carry
 * nothing personal.
 *
 * Every JSON-bearing column here is hand-parsed rather than trusted: a cell
 * that fails to decrypt, fails to parse, or parses into the wrong shape
 * becomes `null` (or, for `toolCalls`, drops just the offending entries)
 * with a logged warning rather than throwing a read out of a list. A chat
 * session is not something the rest of the app depends on being valid the
 * way a resume or a profile is: losing one malformed message must never
 * take the whole session list down with it.
 */

type SessionRow = typeof chatSessions.$inferSelect
type MessageRow = typeof chatMessages.$inferSelect

function currentMode(): StorageMode {
  // Fails closed, same as profileRepository/resumeRepository: if a storage
  // mode was somehow never chosen, default to the more protective option
  // rather than silently writing plaintext.
  return getStorageMode() ?? 'encrypted'
}

/** Trims and caps a title; empty becomes the default. Throws (a plain Error, mapped by the IPC layer to `chatTitleTooLong`) rather than silently truncating, so the caller knows the title it asked for was not the one that got saved. */
function normalizeTitle(title: string | undefined | null): string {
  const trimmed = (title ?? '').trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return 'New chat'
  if (trimmed.length > CHAT_SESSION_TITLE_MAX_CHARS) {
    throw new Error(`Chat title is too long (max ${CHAT_SESSION_TITLE_MAX_CHARS} characters).`)
  }
  return trimmed
}

function isValidUsage(value: unknown): value is ChatUsage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChatUsage>
  return (
    typeof candidate.promptTokens === 'number' &&
    Number.isFinite(candidate.promptTokens) &&
    typeof candidate.completionTokens === 'number' &&
    Number.isFinite(candidate.completionTokens) &&
    (candidate.costUsd == null || typeof candidate.costUsd === 'number')
  )
}

function isValidToolCall(value: unknown): value is ChatToolCall {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChatToolCall>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.arguments === 'string' &&
    isChatToolCallStatus(candidate.status) &&
    (candidate.result == null || typeof candidate.result === 'string') &&
    typeof candidate.isError === 'boolean' &&
    (candidate.durationMs == null || (typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)))
  )
}

/** Decrypts then JSON.parses a secure array field; any failure at either step is logged and treated as absent. */
function decodeSecureJsonArray(raw: string | null, what: string): unknown[] | null {
  if (raw === null) return null
  let serialized: string | null
  try {
    serialized = readSecureField(raw)
  } catch (err) {
    logActivity('warn', `Failed to decrypt chat message ${what}`, { error: String(err) })
    return null
  }
  if (!serialized) return null
  try {
    const parsed = JSON.parse(serialized)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    logActivity('warn', `Chat message ${what} was not valid JSON; dropping it`)
    return null
  }
}

function decodeReasoningDetails(raw: string | null): unknown[] | null {
  const parsed = decodeSecureJsonArray(raw, 'reasoningDetails')
  return parsed && parsed.length > 0 ? parsed : null
}

/** A tool call entry that fails validation is dropped rather than nulling the whole list, so one corrupted entry doesn't hide every other proposed call. */
function decodeToolCalls(raw: string | null): ChatToolCall[] | null {
  const parsed = decodeSecureJsonArray(raw, 'toolCalls')
  if (!parsed) return null
  const valid = parsed.filter(isValidToolCall)
  if (valid.length !== parsed.length) {
    logActivity('warn', 'Dropped one or more malformed tool call entries from a chat message')
  }
  return valid.length > 0 ? valid : null
}

function decodePlainJson<T>(raw: string | null, guard: (value: unknown) => value is T, what: string): T | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    if (guard(parsed)) return parsed
    logActivity('warn', `Chat message ${what} did not match the expected shape; dropping it`)
    return null
  } catch {
    logActivity('warn', `Chat message ${what} was not valid JSON; dropping it`)
    return null
  }
}

function encodeSecureJsonArray(value: unknown[] | null, mode: StorageMode): string | null {
  if (value === null || value.length === 0) return null
  return writeSecureField(JSON.stringify(value), mode)
}

function toSession(row: SessionRow, messageCount: number): ChatSession {
  return {
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount,
    totalCostUsd: row.totalCostUsd,
    // Overlaid by the IPC layer from `sessionActivity.ts`; the repository
    // has no notion of an in-flight turn.
    busy: false
  }
}

function toMessage(row: MessageRow): ChatMessage {
  const role = isChatRole(row.role) ? row.role : 'assistant'
  if (role !== row.role) {
    logActivity('warn', `Chat message ${row.id} had an unrecognized role "${row.role}"; treating it as assistant`)
  }
  return {
    id: row.id,
    sessionId: row.sessionId,
    role,
    content: readSecureField(row.content) ?? '',
    reasoning: readSecureField(row.reasoning),
    reasoningDetails: decodeReasoningDetails(row.reasoningDetails),
    toolCalls: decodeToolCalls(row.toolCalls),
    toolCallId: row.toolCallId,
    modelId: row.modelId,
    usage: decodePlainJson(row.usage, isValidUsage, 'usage'),
    error: decodePlainJson(row.error, isAppError, 'error'),
    createdAt: row.createdAt
  }
}

function sessionRow(id: string): SessionRow | undefined {
  return getDb().select().from(chatSessions).where(eq(chatSessions.id, id)).get()
}

function messageCountOf(sessionId: string): number {
  return (
    getDb()
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .get()?.count ?? 0
  )
}

export interface CreateChatSessionInput {
  title?: string
  modelId: string
}

export function createChatSession(input: CreateChatSessionInput): ChatSession {
  const db = getDb()
  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    title: normalizeTitle(input.title),
    modelId: input.modelId,
    createdAt: now,
    updatedAt: now,
    totalCostUsd: 0
  }
  db.insert(chatSessions).values(row).run()
  return toSession(row, 0)
}

/** Ordered by most recently active first, with each session's message count folded in by one grouped query rather than N+1. */
export function listChatSessions(): ChatSession[] {
  const db = getDb()
  const counts = new Map(
    db
      .select({ sessionId: chatMessages.sessionId, count: sql<number>`count(*)` })
      .from(chatMessages)
      .groupBy(chatMessages.sessionId)
      .all()
      .map((row) => [row.sessionId, row.count])
  )
  return db
    .select()
    .from(chatSessions)
    .orderBy(desc(chatSessions.updatedAt))
    .all()
    .map((row) => toSession(row, counts.get(row.id) ?? 0))
}

export function getChatSession(id: string): ChatSession | null {
  const row = sessionRow(id)
  return row ? toSession(row, messageCountOf(id)) : null
}

export function renameChatSession(id: string, title: string): ChatSession | null {
  const db = getDb()
  const existing = sessionRow(id)
  if (!existing) return null
  const normalized = normalizeTitle(title)
  const updatedAt = new Date().toISOString()
  db.update(chatSessions).set({ title: normalized, updatedAt }).where(eq(chatSessions.id, id)).run()
  return getChatSession(id)
}

/** Bumps `updatedAt` without changing anything else, since every message written to a session should keep it at the top of the list. */
export function touchChatSession(id: string): ChatSession | null {
  const db = getDb()
  if (!sessionRow(id)) return null
  db.update(chatSessions)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(chatSessions.id, id))
    .run()
  return getChatSession(id)
}

export function setChatSessionModel(id: string, modelId: string): ChatSession | null {
  const db = getDb()
  if (!sessionRow(id)) return null
  db.update(chatSessions)
    .set({ modelId, updatedAt: new Date().toISOString() })
    .where(eq(chatSessions.id, id))
    .run()
  return getChatSession(id)
}

/** Adds to the running cost total (never resets it); a turn with no billable usage passes 0 and this is a no-op past the touch. */
export function addChatSessionCost(id: string, usd: number): ChatSession | null {
  const db = getDb()
  const existing = sessionRow(id)
  if (!existing) return null
  db.update(chatSessions)
    .set({ totalCostUsd: existing.totalCostUsd + usd, updatedAt: new Date().toISOString() })
    .where(eq(chatSessions.id, id))
    .run()
  return getChatSession(id)
}

/** Cascades to the session's messages through the FK. */
export function deleteChatSession(id: string): boolean {
  return getDb().delete(chatSessions).where(eq(chatSessions.id, id)).run().changes > 0
}

export type InsertChatMessageInput = Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }

/**
 * Assigns the next `seq` for the session inside a transaction, so two
 * writers (a stray double-send, a retried stream) can never collide on the
 * same sequence number. `id` may be supplied by the caller: the streaming
 * runner announces a message's id in `turn_started` before the row exists,
 * so it needs to control that id rather than discover it afterwards.
 */
export function insertChatMessage(input: InsertChatMessageInput): ChatMessage {
  const db = getDb()
  const mode = currentMode()
  return db.transaction((tx) => {
    const last = tx
      .select({ max: sql<number | null>`max(${chatMessages.seq})` })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, input.sessionId))
      .get()
    const seq = (last?.max ?? 0) + 1
    const id = input.id ?? randomUUID()
    const createdAt = new Date().toISOString()
    tx.insert(chatMessages)
      .values({
        id,
        sessionId: input.sessionId,
        seq,
        role: input.role,
        content: writeSecureField(input.content, mode) ?? '',
        reasoning: writeSecureField(input.reasoning, mode),
        reasoningDetails: encodeSecureJsonArray(input.reasoningDetails, mode),
        toolCalls: encodeSecureJsonArray(input.toolCalls, mode),
        toolCallId: input.toolCallId,
        modelId: input.modelId,
        usage: input.usage ? JSON.stringify(input.usage) : null,
        error: input.error ? JSON.stringify(input.error) : null,
        createdAt
      })
      .run()
    const row = tx.select().from(chatMessages).where(eq(chatMessages.id, id)).get()
    if (!row) throw new Error('Failed to read back the inserted chat message')
    return toMessage(row)
  })
}

export type UpdateChatMessagePatch = Partial<
  Pick<ChatMessage, 'content' | 'reasoning' | 'reasoningDetails' | 'toolCalls' | 'usage' | 'error' | 'modelId'>
>

/** Patches only the fields given; a field left out of the patch keeps its stored value (streaming deltas rewrite `content` many times without touching `toolCalls`, and vice versa). */
export function updateChatMessage(id: string, patch: UpdateChatMessagePatch): ChatMessage | null {
  const db = getDb()
  const existing = db.select().from(chatMessages).where(eq(chatMessages.id, id)).get()
  if (!existing) return null
  const mode = currentMode()
  const set: Partial<typeof chatMessages.$inferInsert> = {}
  if (patch.content !== undefined) set.content = writeSecureField(patch.content, mode) ?? ''
  if (patch.reasoning !== undefined) set.reasoning = writeSecureField(patch.reasoning, mode)
  if (patch.reasoningDetails !== undefined) set.reasoningDetails = encodeSecureJsonArray(patch.reasoningDetails, mode)
  if (patch.toolCalls !== undefined) set.toolCalls = encodeSecureJsonArray(patch.toolCalls, mode)
  if (patch.usage !== undefined) set.usage = patch.usage ? JSON.stringify(patch.usage) : null
  if (patch.error !== undefined) set.error = patch.error ? JSON.stringify(patch.error) : null
  if (patch.modelId !== undefined) set.modelId = patch.modelId
  if (Object.keys(set).length === 0) return toMessage(existing)
  db.update(chatMessages).set(set).where(eq(chatMessages.id, id)).run()
  const row = db.select().from(chatMessages).where(eq(chatMessages.id, id)).get()
  return row ? toMessage(row) : null
}

export function getChatMessage(id: string): ChatMessage | null {
  const row = getDb().select().from(chatMessages).where(eq(chatMessages.id, id)).get()
  return row ? toMessage(row) : null
}

/**
 * Pages backwards from the newest message. Without `before`, the newest
 * page (still returned oldest-first within that page, for straightforward
 * rendering); with `before`, everything strictly older than that message's
 * `seq`. An unknown `before` id is treated as "no page" rather than an
 * error, since the message it named may have raced a delete, with a warning
 * rather than a throw, since a stale reference from the renderer is
 * expected occasionally, not a bug worth crashing the dock over.
 */
export function listChatMessages(query: ListChatMessagesQuery): ListChatMessagesResult {
  const db = getDb()
  const limit = Math.min(Math.max(1, query.limit ?? CHAT_MESSAGES_PAGE_SIZE), CHAT_MESSAGES_PAGE_SIZE)

  let beforeSeq: number | null = null
  if (query.before !== undefined) {
    const beforeRow = db
      .select({ seq: chatMessages.seq })
      .from(chatMessages)
      .where(and(eq(chatMessages.sessionId, query.sessionId), eq(chatMessages.id, query.before)))
      .get()
    if (!beforeRow) {
      logActivity('warn', `listChatMessages: unknown "before" message id ${query.before}; returning no page`)
      return { messages: [], hasMore: false }
    }
    beforeSeq = beforeRow.seq
  }

  const where =
    beforeSeq === null
      ? eq(chatMessages.sessionId, query.sessionId)
      : and(eq(chatMessages.sessionId, query.sessionId), lt(chatMessages.seq, beforeSeq))

  // Fetch newest-first (one past the limit, to answer hasMore without a
  // second count query), then reverse to ascending for the caller.
  const rows = db.select().from(chatMessages).where(where).orderBy(desc(chatMessages.seq)).limit(limit + 1).all()
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit).reverse()
  return { messages: page.map(toMessage), hasMore }
}

/** Every message of a session, oldest first: how the runner rebuilds the model's context. */
export function listAllChatMessages(sessionId: string): ChatMessage[] {
  return getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.seq))
    .all()
    .map(toMessage)
}

/**
 * Every assistant message, across every session, carrying at least one tool
 * call still `pending_approval` or `running`, used once at startup
 * (`agentRunner.recoverInterruptedTurns`) to find turns that were streaming
 * or waiting on an approval when the app last quit, so they can be marked
 * `cancelled` rather than sit forever in a status that promises a turn
 * still in progress. A full-table scan over `chatMessages` (there is no
 * indexed way to query inside the encrypted `toolCalls` column), but this
 * runs once per process lifetime, not per turn.
 */
export function listMessagesWithActiveToolCalls(): ChatMessage[] {
  return getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.role, 'assistant'))
    .all()
    .map(toMessage)
    .filter((message) =>
      message.toolCalls?.some((call) => call.status === 'pending_approval' || call.status === 'running')
    )
}

/** Full sessions and messages for export, oldest session activity last touched first (same order the dock's tab list shows them in). */
export function listAllChatSessionsForExport(): ExportChatSession[] {
  return listChatSessions().map((session) => ({
    title: session.title,
    modelId: session.modelId,
    createdAt: session.createdAt,
    messages: listAllChatMessages(session.id).map((message) => ({
      role: message.role,
      content: message.content,
      reasoning: message.reasoning,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      modelId: message.modelId,
      usage: message.usage,
      createdAt: message.createdAt
    }))
  }))
}

/** An exported call still `pending_approval` or `running` has no turn to finish it here; it lands as cancelled, the way `recoverInterruptedTurns` treats a call a crash left behind. */
function settleImportedToolCalls(toolCalls: ChatToolCall[] | null): ChatToolCall[] | null {
  if (!toolCalls) return null
  return toolCalls.map((call) => (call.status === 'pending_approval' || call.status === 'running' ? { ...call, status: 'cancelled' } : call))
}

/**
 * Imports sessions as fresh rows (new ids, sequential `seq` from 1) with
 * their messages in the given order. A session is skipped, not partially
 * imported, when any of its messages fails validation: `insertChatMessage`
 * assumes well-formed input, and a half-written session with gaps in its
 * transcript would be worse than one left out entirely. Returns the
 * sessions actually imported, as the rows now stored, so the caller can
 * announce them to an already-open chat panel.
 */
export function importChatSessions(sessions: ExportChatSession[]): ChatSession[] {
  const db = getDb()
  const imported: ChatSession[] = []
  for (const session of sessions) {
    try {
      db.transaction((tx) => {
        const now = new Date().toISOString()
        const sessionId = randomUUID()
        const mode = currentMode()
        tx.insert(chatSessions)
          .values({
            id: sessionId,
            title: normalizeTitle(session.title),
            modelId: session.modelId,
            createdAt: session.createdAt || now,
            updatedAt: now,
            totalCostUsd: session.messages.reduce((sum, message) => sum + (message.usage?.costUsd ?? 0), 0)
          })
          .run()
        session.messages.forEach((message, index) => {
          if (!isChatRole(message.role)) throw new Error(`Invalid chat message role "${message.role}"`)
          tx.insert(chatMessages)
            .values({
              id: randomUUID(),
              sessionId,
              seq: index + 1,
              role: message.role,
              content: writeSecureField(message.content, mode) ?? '',
              reasoning: writeSecureField(message.reasoning, mode),
              reasoningDetails: null,
              toolCalls: encodeSecureJsonArray(settleImportedToolCalls(message.toolCalls), mode),
              toolCallId: message.toolCallId,
              modelId: message.modelId,
              usage: message.usage ? JSON.stringify(message.usage) : null,
              error: null,
              createdAt: message.createdAt || now
            })
            .run()
        })
        const stored = getChatSession(sessionId)
        if (stored) imported.push(stored)
      })
    } catch (err) {
      logActivity('warn', `Skipped a chat session on import: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return imported
}

export function countChatRows(): { sessions: number; messages: number } {
  const db = getDb()
  const sessions = db.select({ count: sql<number>`count(*)` }).from(chatSessions).get()?.count ?? 0
  const messages = db.select({ count: sql<number>`count(*)` }).from(chatMessages).get()?.count ?? 0
  return { sessions, messages }
}

/**
 * Re-encrypts every secure column of every message for a storage-mode
 * switch, in a transaction like `rewriteResumeStorageMode`. Decodes with
 * whatever the stored marker says (never the *current* setting) and
 * re-encodes with the requested mode; sessions carry no secure columns of
 * their own, so only messages need rewriting.
 */
export function rewriteChatStorageMode(mode: StorageMode): void {
  const db = getDb()
  db.transaction((tx) => {
    for (const row of tx.select().from(chatMessages).all()) {
      tx.update(chatMessages)
        .set({
          content: writeSecureField(readSecureField(row.content), mode) ?? '',
          reasoning: writeSecureField(readSecureField(row.reasoning), mode),
          reasoningDetails: row.reasoningDetails
            ? writeSecureField(readSecureField(row.reasoningDetails), mode)
            : null,
          toolCalls: row.toolCalls ? writeSecureField(readSecureField(row.toolCalls), mode) : null
        })
        .where(eq(chatMessages.id, row.id))
        .run()
    }
  })
}
