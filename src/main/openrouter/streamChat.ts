import { appError, type AppError } from '@shared/types/errorCodes'
import type { ChatUsage } from '@shared/types/chat'
import type { ReasoningEffort } from '@shared/types/openrouter'
import { appLogger } from '../logger'
import { OPENROUTER_API_BASE, mapOpenRouterHttpError, openRouterHeaders, type FetchLike } from './api'

/**
 * The one part of talking to OpenRouter that isn't a plain request/response
 * (that's `api.ts`): a chat completion streams back as Server-Sent Events,
 * and the caller (the chat IPC layer, owned by a different agent) wants to
 * paint tokens as they arrive rather than wait for the whole answer.
 *
 * Everything OpenAI-shaped (`OpenAiMessage`/`OpenAiTool`/`OpenAiToolCall`)
 * is defined here rather than in `@shared/types` because it never crosses
 * the IPC boundary; it's the wire format for *this* HTTP call, built from
 * `ChatMessage`/MCP tool definitions on the way in and torn back down into
 * `ChatMessage` fields on the way out.
 *
 * The SSE parser is a plain function over the fetch `Response`'s body
 * stream: split on newlines (tolerating `\r\n` and a `data:` payload that
 * arrives split across two network chunks), skip blank lines and `:`
 * keep-alive comments, and tolerate the stream just ending without a final
 * `[DONE]` (a dropped connection after the last real chunk is not the same
 * failure as a chunk that says so explicitly).
 */

export type OpenAiRole = 'system' | 'user' | 'assistant' | 'tool'

export interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAiMessage {
  role: OpenAiRole
  content: string | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
  reasoning_details?: unknown[]
}

export interface OpenAiTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'error' | null

export interface StreamChatRequest {
  apiKey: string
  modelId: string
  messages: OpenAiMessage[]
  tools: OpenAiTool[]
  reasoningEffort: ReasoningEffort
}

export interface StreamedToolCall {
  id: string
  name: string
  /** raw JSON text as accumulated from the stream so far, may not be valid JSON until the call is complete */
  arguments: string
}

export interface StreamChatHandlers {
  onContent: (delta: string) => void
  onReasoning: (delta: string) => void
  onToolCallUpdate?: (toolCalls: StreamedToolCall[]) => void
}

export interface StreamChatOptions {
  signal: AbortSignal
  fetch?: FetchLike
}

interface StreamPartial {
  content: string
  reasoning: string
  toolCalls: StreamedToolCall[]
}

export type StreamResult =
  | {
      ok: true
      content: string
      reasoning: string
      reasoningDetails: unknown[] | null
      toolCalls: StreamedToolCall[]
      finishReason: ChatFinishReason
      usage: ChatUsage | null
    }
  | { ok: false; error: AppError; partial: StreamPartial; aborted?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFinishReason(value: string): value is Exclude<ChatFinishReason, null> {
  return value === 'stop' || value === 'tool_calls' || value === 'length' || value === 'error'
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

/**
 * Reads a `ReadableStream<Uint8Array>` as SSE, calling `onData` once per
 * event with the (possibly multi-line, newline-joined) `data:` payload.
 * Deliberately tolerant of where chunk boundaries fall: a real HTTP
 * response can split a single line, or even a single UTF-8 code point,
 * across two `read()` calls.
 */
async function forEachSseEvent(body: ReadableStream<Uint8Array>, onData: (payload: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let dataLines: string[] = []

  const flushEvent = (): void => {
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n')
    dataLines = []
    onData(payload)
  }

  const processLine = (rawLine: string): void => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.length === 0) {
      flushEvent()
      return
    }
    if (line.startsWith(':')) return // keep-alive comment, e.g. ": OPENROUTER PROCESSING"
    if (line.startsWith('data:')) {
      const rest = line.slice(5)
      dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest)
      return
    }
    // event:, id:, retry: and anything else OpenRouter doesn't send for
    // this endpoint; deliberately ignored rather than treated as data.
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        processLine(buffer.slice(0, newlineIndex))
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) processLine(buffer)
    flushEvent()
  } finally {
    reader.releaseLock()
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return response.statusText || `HTTP ${response.status}`
    try {
      const parsed: unknown = JSON.parse(text)
      if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
        return parsed.error.message
      }
    } catch {
      // Not JSON; fall through to the raw text.
    }
    return text.slice(0, 500)
  } catch (err) {
    return err instanceof Error ? err.message : (response.statusText || `HTTP ${response.status}`)
  }
}

export async function streamChatCompletion(
  request: StreamChatRequest,
  handlers: StreamChatHandlers,
  options: StreamChatOptions
): Promise<StreamResult> {
  const fetchImpl = options.fetch ?? fetch

  const requestBody: Record<string, unknown> = {
    model: request.modelId,
    messages: request.messages,
    stream: true,
    usage: { include: true }
  }
  if (request.tools.length > 0) {
    requestBody.tools = request.tools
    requestBody.tool_choice = 'auto'
  }
  if (request.reasoningEffort !== 'default') {
    requestBody.reasoning = { effort: request.reasoningEffort }
  }

  let content = ''
  let reasoning = ''
  const reasoningDetails: unknown[] = []
  let hasReasoningDetails = false
  const toolCallsByIndex = new Map<number, StreamedToolCall>()
  let finishReason: ChatFinishReason = null
  let usage: ChatUsage | null = null
  let streamError: AppError | null = null

  const currentToolCalls = (): StreamedToolCall[] =>
    [...toolCallsByIndex.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({ ...call }))

  const partial = (): StreamPartial => ({ content, reasoning, toolCalls: currentToolCalls() })

  let response: Response
  try {
    response = await fetchImpl(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...openRouterHeaders(request.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal
    })
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, aborted: true, error: appError('openrouterStreamError', { message: 'Cancelled.' }), partial: partial() }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: appError('openrouterStreamError', { message }), partial: partial() }
  }

  if (!response.ok) {
    const message = await readErrorBody(response)
    return { ok: false, error: mapOpenRouterHttpError(response.status, message, request.modelId), partial: partial() }
  }

  if (!response.body) {
    return { ok: false, error: appError('openrouterStreamError', { message: 'The response had no body.' }), partial: partial() }
  }

  let doneReceived = false

  const handleEvent = (payload: string): void => {
    if (doneReceived) return
    const trimmed = payload.trim()
    if (trimmed === '[DONE]') {
      doneReceived = true
      return
    }
    if (trimmed.length === 0) return

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      appLogger.warn(`OpenRouter stream: could not parse an SSE payload (first 200 chars): ${trimmed.slice(0, 200)}`)
      return
    }
    if (!isRecord(parsed)) return

    if (isRecord(parsed.error)) {
      const message = typeof parsed.error.message === 'string' ? parsed.error.message : 'The model stream reported an error.'
      const code = parsed.error.code
      streamError = mapOpenRouterHttpError(typeof code === 'number' ? code : 0, message, request.modelId)
      doneReceived = true
      return
    }

    const choices = Array.isArray(parsed.choices) ? parsed.choices : []
    const choice = choices.length > 0 ? choices[0] : undefined
    if (isRecord(choice)) {
      const delta = isRecord(choice.delta) ? choice.delta : undefined
      if (delta) {
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          content += delta.content
          handlers.onContent(delta.content)
        }
        if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
          reasoning += delta.reasoning
          handlers.onReasoning(delta.reasoning)
        }
        if (Array.isArray(delta.reasoning_details)) {
          reasoningDetails.push(...delta.reasoning_details)
          hasReasoningDetails = true
        }
        if (Array.isArray(delta.tool_calls)) {
          let changed = false
          for (const rawCall of delta.tool_calls) {
            if (!isRecord(rawCall) || typeof rawCall.index !== 'number') continue
            const existing = toolCallsByIndex.get(rawCall.index) ?? { id: '', name: '', arguments: '' }
            if (typeof rawCall.id === 'string' && rawCall.id.length > 0) existing.id = rawCall.id
            if (isRecord(rawCall.function)) {
              if (typeof rawCall.function.name === 'string' && rawCall.function.name.length > 0) {
                existing.name = rawCall.function.name
              }
              if (typeof rawCall.function.arguments === 'string') {
                existing.arguments += rawCall.function.arguments
              }
            }
            toolCallsByIndex.set(rawCall.index, existing)
            changed = true
          }
          if (changed) handlers.onToolCallUpdate?.(currentToolCalls())
        }
      }
      if (typeof choice.finish_reason === 'string' && isFinishReason(choice.finish_reason)) {
        finishReason = choice.finish_reason
        if (finishReason === 'error' && !streamError) {
          streamError = appError('openrouterProviderStreamError')
        }
      }
    }

    if (isRecord(parsed.usage)) {
      const promptTokens = typeof parsed.usage.prompt_tokens === 'number' ? parsed.usage.prompt_tokens : 0
      const completionTokens = typeof parsed.usage.completion_tokens === 'number' ? parsed.usage.completion_tokens : 0
      const costUsd = typeof parsed.usage.cost === 'number' ? parsed.usage.cost : null
      // A usage frame can arrive twice (an accounting frame, then a final
      // one); the later one simply replaces the earlier, it never adds.
      usage = { promptTokens, completionTokens, costUsd }
    }
  }

  try {
    await forEachSseEvent(response.body, handleEvent)
  } catch (err) {
    if (isAbortError(err) || options.signal.aborted) {
      return { ok: false, aborted: true, error: appError('openrouterStreamError', { message: 'Cancelled.' }), partial: partial() }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: appError('openrouterStreamError', { message }), partial: partial() }
  }

  if (options.signal.aborted) {
    return { ok: false, aborted: true, error: appError('openrouterStreamError', { message: 'Cancelled.' }), partial: partial() }
  }

  if (streamError) {
    return { ok: false, error: streamError, partial: partial() }
  }

  let generatedCounter = 0
  const toolCalls = currentToolCalls().map((call) => ({
    id: call.id.length > 0 ? call.id : `call_${generatedCounter++}`,
    name: call.name,
    arguments: call.arguments
  }))

  // A 200 response whose stream produced no content, no tool calls and no
  // explicit error is still a failure: nothing downstream can do anything
  // with it, and silently completing the turn would look like the model
  // chose to say nothing rather than that something went wrong upstream.
  if (content.length === 0 && toolCalls.length === 0) {
    return {
      ok: false,
      error: appError('openrouterStreamError', { message: 'The model returned an empty response.' }),
      partial: { content, reasoning, toolCalls }
    }
  }

  return {
    ok: true,
    content,
    reasoning,
    reasoningDetails: hasReasoningDetails ? reasoningDetails : null,
    toolCalls,
    finishReason,
    usage
  }
}
