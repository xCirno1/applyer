import type { ChatMessage, ChatToolCallStatus } from '@shared/types/chat'
import type { OpenAiMessage } from './streamChat'

/**
 * Turns a session's stored `ChatMessage` history into the wire-format
 * messages `streamChatCompletion` sends, with the system prompt first
 * (`agentRunner` builds it fresh per turn, since it carries today's date).
 *
 * Two problems this solves that a plain 1:1 map over the rows can't:
 *
 * 1. A denied or cancelled tool call may have no stored `tool` message:
 *    the OpenAI wire format requires one for every `tool_calls` entry an
 *    assistant message proposed, or the next request is simply rejected.
 *    `mapTurn` synthesizes a small JSON error for exactly the calls a
 *    turn's own messages never answered, so the transcript sent upstream
 *    is always well-formed regardless of how the turn actually ended.
 * 2. The conversation can outgrow the model's context window. Rather than
 *    truncate mid-message (which would corrupt a tool result the model is
 *    relying on, or cut off content mid-sentence), whole turns are dropped
 *    from the oldest end, a "turn" being a user message and everything up
 *    to, but not including, the next user message, since that is the unit
 *    a user actually re-reads and the model actually reasons about as one
 *    exchange. The newest turn is kept no matter how large it is: dropping
 *    it would mean answering the user's current message with none of its
 *    own content, which is worse than a request that runs over budget.
 *
 * Token counts here are an estimate (`chars / 4` plus a small per-message
 * constant for role/framing overhead), not a real tokenizer. OpenRouter
 * fronts many different models with different tokenizers, so there is no
 * single exact count to compute. The estimate only has to be conservative
 * enough that trimming kicks in before a request is hard-rejected for
 * being too long, not exact.
 */

export const MAX_TOOL_RESULT_CHARS = 60000

const CHARS_PER_TOKEN = 4
/** Small constant per message for the role/framing tokens a real tokenizer would add on top of the raw text; keeps a long run of short tool calls from being undercounted. */
const MESSAGE_OVERHEAD_TOKENS = 4

export interface BuildModelMessagesOptions {
  systemPrompt: string
  contextLength: number
  reserveTokens: number
}

/** Appends a trailing note rather than silently cutting a tool result off, so the model knows the rest of the payload was dropped rather than that the tool's answer actually ended there. */
function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content
  const omitted = content.length - MAX_TOOL_RESULT_CHARS
  return `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[... ${omitted} more character${omitted === 1 ? '' : 's'} truncated]`
}

function toOpenAiMessage(message: ChatMessage): OpenAiMessage {
  if (message.role === 'user') {
    return { role: 'user', content: message.content }
  }
  if (message.role === 'tool') {
    return { role: 'tool', content: truncateToolResult(message.content), tool_call_id: message.toolCallId ?? '' }
  }
  const openAi: OpenAiMessage = { role: 'assistant', content: message.content }
  if (message.toolCalls && message.toolCalls.length > 0) {
    openAi.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments }
    }))
  }
  if (message.reasoningDetails && message.reasoningDetails.length > 0) {
    openAi.reasoning_details = message.reasoningDetails
  }
  return openAi
}

/**
 * What a call the model proposed gets when nothing in this turn's own
 * messages ever answered it: the same JSON-error shape a real tool failure
 * would produce, so the model reacts to it as an ordinary failed call
 * (apologize, try something else, ask the user) instead of seeing a
 * dangling `tool_calls` entry with no response, which is what a `deny` or
 * a mid-tool `stop` can otherwise leave behind.
 */
const SYNTHETIC_DENIAL_RESULT = JSON.stringify({ error: 'denied by user' })

/** True for the statuses that can legitimately end a turn with no tool message ever written: `denied` (though the runner does persist one itself; this is the safety net for whenever it hasn't) and `cancelled` (a mid-tool stop, which never gets to write one at all). */
function canBeUnanswered(status: ChatToolCallStatus): boolean {
  return status === 'denied' || status === 'cancelled'
}

/** One turn (a user message plus everything up to, but not including, the next user message) mapped to wire messages, with a synthesized tool response for any proposed call this turn's real messages never answered. */
function mapTurn(turn: ChatMessage[]): OpenAiMessage[] {
  const answeredCallIds = new Set(
    turn
      .filter((message): message is ChatMessage & { toolCallId: string } => message.role === 'tool' && !!message.toolCallId)
      .map((message) => message.toolCallId)
  )
  const mapped: OpenAiMessage[] = []
  for (const message of turn) {
    mapped.push(toOpenAiMessage(message))
    if (message.role !== 'assistant' || !message.toolCalls) continue
    for (const call of message.toolCalls) {
      if (!canBeUnanswered(call.status) || answeredCallIds.has(call.id)) continue
      mapped.push({ role: 'tool', content: SYNTHETIC_DENIAL_RESULT, tool_call_id: call.id })
      answeredCallIds.add(call.id)
    }
  }
  return mapped
}

/** Splits full session history into turns: a leading run of non-user messages (malformed data; should not happen in practice) becomes its own leading turn rather than being dropped. */
function groupIntoTurns(history: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = []
  let current: ChatMessage[] = []
  for (const message of history) {
    if (message.role === 'user') {
      if (current.length > 0) turns.push(current)
      current = [message]
    } else {
      current.push(message)
    }
  }
  if (current.length > 0) turns.push(current)
  return turns
}

function estimateTokens(message: OpenAiMessage): number {
  let chars = message.content?.length ?? 0
  if (message.tool_calls) {
    for (const call of message.tool_calls) chars += call.function.name.length + call.function.arguments.length
  }
  if (message.reasoning_details) chars += JSON.stringify(message.reasoning_details).length
  if (message.tool_call_id) chars += message.tool_call_id.length
  return Math.ceil(chars / CHARS_PER_TOKEN) + MESSAGE_OVERHEAD_TOKENS
}

function totalTokens(messages: readonly OpenAiMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0)
}

export function buildModelMessages(history: ChatMessage[], options: BuildModelMessagesOptions): OpenAiMessage[] {
  const system: OpenAiMessage = { role: 'system', content: options.systemPrompt }
  const turns = groupIntoTurns(history).map(mapTurn)
  const budget = options.contextLength - options.reserveTokens

  // The newest turn (turns.length === 1) is kept no matter how far over
  // budget it puts the request; only turns older than it are ever dropped.
  while (turns.length > 1 && totalTokens([system, ...turns.flat()]) > budget) {
    turns.shift()
  }

  return [system, ...turns.flat()]
}
