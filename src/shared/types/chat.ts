import { isAppError, type AppError } from './errorCodes'

/**
 * A chat session is OpenRouter mode's equivalent of a terminal tab: one
 * conversation with an in-app agent that calls Applyer's MCP tools
 * in-process. Sessions and their messages persist in SQLite (part of
 * export/import, see `dataTransfer.ts`), so closing the dock or switching
 * back to CLI mode never loses history.
 *
 * `ChatStreamEvent` is the one push channel a turn uses end to end: it opens
 * with `turn_started`, narrates content/reasoning as it streams, proposes
 * and updates tool calls (including pausing on `tool_approval_requested`
 * for anything in `ToolApprovalPolicy.askFor`), and always ends in either
 * `turn_completed` or `turn_failed`: a message that failed mid-stream still
 * gets a `message_completed` first, with whatever content/tool calls made it
 * out and `ChatMessage.error` set, so a dropped connection never silently
 * discards a partial answer.
 *
 * Every guard here is deliberately lenient about optional/null fields
 * (`== null` accepts both, since a value coming back from JSON over IPC can
 * drop a key entirely rather than send it as `null`) and strict about ids,
 * roles, and other identity fields, the same split `isChatSession` and
 * friends elsewhere in this codebase use.
 */

export interface ChatSession {
  id: string
  title: string
  modelId: string
  createdAt: string
  updatedAt: string
  messageCount: number
  totalCostUsd: number
  /** true while a turn is running (main-process state, not persisted) */
  busy: boolean
}

export type ChatRole = 'user' | 'assistant' | 'tool'

export type ChatToolCallStatus = 'pending_approval' | 'running' | 'done' | 'error' | 'denied' | 'cancelled'

export interface ChatToolCall {
  id: string
  name: string
  /** raw JSON string as the model produced it */
  arguments: string
  status: ChatToolCallStatus
  /** text form of the MCP result, present once done/error */
  result: string | null
  isError: boolean
  durationMs: number | null
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  costUsd: number | null
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: ChatRole
  content: string
  /** model reasoning text, when the model streams it */
  reasoning: string | null
  /** opaque OpenRouter `reasoning_details` blocks to send back verbatim on the next request (interleaved thinking); assistant only */
  reasoningDetails: unknown[] | null
  toolCalls: ChatToolCall[] | null // assistant only
  toolCallId: string | null // tool only
  modelId: string | null
  usage: ChatUsage | null
  error: AppError | null // a turn that failed part way keeps what streamed, with the error
  createdAt: string
}

export type ChatStreamEvent =
  | { type: 'turn_started'; sessionId: string; messageId: string }
  | { type: 'content_delta'; sessionId: string; messageId: string; delta: string }
  | { type: 'reasoning_delta'; sessionId: string; messageId: string; delta: string }
  | { type: 'tool_calls_proposed'; sessionId: string; messageId: string; toolCalls: ChatToolCall[] }
  | { type: 'tool_call_updated'; sessionId: string; messageId: string; toolCall: ChatToolCall }
  | { type: 'tool_approval_requested'; sessionId: string; messageId: string; toolCallId: string; name: string; arguments: string }
  | { type: 'message_completed'; sessionId: string; message: ChatMessage }
  | { type: 'turn_completed'; sessionId: string; usage: ChatUsage | null }
  | { type: 'turn_failed'; sessionId: string; messageId: string | null; error: AppError }
  | { type: 'session_updated'; session: ChatSession }
  | { type: 'session_deleted'; sessionId: string }

export type ToolApprovalDecision = 'allow_once' | 'allow_always' | 'deny'

export interface PendingToolApproval {
  sessionId: string
  messageId: string
  toolCallId: string
  name: string
  arguments: string
}

export interface ListChatMessagesQuery {
  sessionId: string
  /** page backwards: messages strictly older than this message id */
  before?: string
  limit?: number
}

export interface ListChatMessagesResult {
  messages: ChatMessage[]
  hasMore: boolean
}

export const CHAT_MESSAGES_PAGE_SIZE = 50
export const CHAT_INPUT_MAX_CHARS = 20000
export const CHAT_SESSION_TITLE_MAX_CHARS = 80

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const CHAT_ROLES: ReadonlySet<ChatRole> = new Set(['user', 'assistant', 'tool'])

/** Exported so the import-bundle zod schema can delegate to it rather than restating the union (same pattern as `isAtsProvider`). */
export function isChatRole(value: unknown): value is ChatRole {
  return typeof value === 'string' && CHAT_ROLES.has(value as ChatRole)
}

const CHAT_TOOL_CALL_STATUSES: ReadonlySet<ChatToolCallStatus> = new Set([
  'pending_approval',
  'running',
  'done',
  'error',
  'denied',
  'cancelled'
])

/** Exported for the same reason as `isChatRole`. */
export function isChatToolCallStatus(value: unknown): value is ChatToolCallStatus {
  return typeof value === 'string' && CHAT_TOOL_CALL_STATUSES.has(value as ChatToolCallStatus)
}

function isChatToolCall(value: unknown): value is ChatToolCall {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChatToolCall>
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.name) &&
    typeof candidate.arguments === 'string' &&
    isChatToolCallStatus(candidate.status) &&
    (candidate.result == null || typeof candidate.result === 'string') &&
    typeof candidate.isError === 'boolean' &&
    (candidate.durationMs == null || (typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)))
  )
}

function isChatUsage(value: unknown): value is ChatUsage {
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

export function isChatSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChatSession>
  return (
    isNonEmptyString(candidate.id) &&
    typeof candidate.title === 'string' &&
    typeof candidate.modelId === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    typeof candidate.messageCount === 'number' &&
    Number.isFinite(candidate.messageCount) &&
    typeof candidate.totalCostUsd === 'number' &&
    Number.isFinite(candidate.totalCostUsd) &&
    typeof candidate.busy === 'boolean'
  )
}

export function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChatMessage>
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.sessionId) &&
    isChatRole(candidate.role) &&
    typeof candidate.content === 'string' &&
    (candidate.reasoning == null || typeof candidate.reasoning === 'string') &&
    (candidate.reasoningDetails == null || Array.isArray(candidate.reasoningDetails)) &&
    (candidate.toolCalls == null || (Array.isArray(candidate.toolCalls) && candidate.toolCalls.every(isChatToolCall))) &&
    (candidate.toolCallId == null || typeof candidate.toolCallId === 'string') &&
    (candidate.modelId == null || typeof candidate.modelId === 'string') &&
    (candidate.usage == null || isChatUsage(candidate.usage)) &&
    (candidate.error == null || isAppError(candidate.error)) &&
    typeof candidate.createdAt === 'string'
  )
}

export function isToolApprovalDecision(value: unknown): value is ToolApprovalDecision {
  return value === 'allow_once' || value === 'allow_always' || value === 'deny'
}

export function isPendingToolApproval(value: unknown): value is PendingToolApproval {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PendingToolApproval>
  return (
    isNonEmptyString(candidate.sessionId) &&
    isNonEmptyString(candidate.messageId) &&
    isNonEmptyString(candidate.toolCallId) &&
    isNonEmptyString(candidate.name) &&
    typeof candidate.arguments === 'string'
  )
}

export function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown }
  switch (candidate.type) {
    case 'turn_started': {
      const event = value as { sessionId?: unknown; messageId?: unknown }
      return isNonEmptyString(event.sessionId) && isNonEmptyString(event.messageId)
    }
    case 'content_delta':
    case 'reasoning_delta': {
      const event = value as { sessionId?: unknown; messageId?: unknown; delta?: unknown }
      return isNonEmptyString(event.sessionId) && isNonEmptyString(event.messageId) && typeof event.delta === 'string'
    }
    case 'tool_calls_proposed': {
      const event = value as { sessionId?: unknown; messageId?: unknown; toolCalls?: unknown }
      return (
        isNonEmptyString(event.sessionId) &&
        isNonEmptyString(event.messageId) &&
        Array.isArray(event.toolCalls) &&
        event.toolCalls.every(isChatToolCall)
      )
    }
    case 'tool_call_updated': {
      const event = value as { sessionId?: unknown; messageId?: unknown; toolCall?: unknown }
      return isNonEmptyString(event.sessionId) && isNonEmptyString(event.messageId) && isChatToolCall(event.toolCall)
    }
    case 'tool_approval_requested': {
      const event = value as {
        sessionId?: unknown
        messageId?: unknown
        toolCallId?: unknown
        name?: unknown
        arguments?: unknown
      }
      return (
        isNonEmptyString(event.sessionId) &&
        isNonEmptyString(event.messageId) &&
        isNonEmptyString(event.toolCallId) &&
        isNonEmptyString(event.name) &&
        typeof event.arguments === 'string'
      )
    }
    case 'message_completed': {
      const event = value as { sessionId?: unknown; message?: unknown }
      return isNonEmptyString(event.sessionId) && isChatMessage(event.message)
    }
    case 'turn_completed': {
      const event = value as { sessionId?: unknown; usage?: unknown }
      return isNonEmptyString(event.sessionId) && (event.usage == null || isChatUsage(event.usage))
    }
    case 'turn_failed': {
      const event = value as { sessionId?: unknown; messageId?: unknown; error?: unknown }
      return (
        isNonEmptyString(event.sessionId) &&
        (event.messageId == null || typeof event.messageId === 'string') &&
        isAppError(event.error)
      )
    }
    case 'session_updated': {
      const event = value as { session?: unknown }
      return isChatSession(event.session)
    }
    case 'session_deleted': {
      const event = value as { sessionId?: unknown }
      return isNonEmptyString(event.sessionId)
    }
    default:
      return false
  }
}
