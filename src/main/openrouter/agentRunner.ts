import { appError, unexpectedError, type AppError } from '@shared/types/errorCodes'
import {
  CHAT_INPUT_MAX_CHARS,
  type ChatSession,
  type ChatToolCall,
  type ChatUsage,
  type ToolApprovalDecision
} from '@shared/types/chat'
import {
  addChatSessionCost,
  getChatSession,
  insertChatMessage,
  listAllChatMessages,
  listMessagesWithActiveToolCalls,
  renameChatSession,
  touchChatSession,
  updateChatMessage
} from '../db/repositories/chatRepository'
import { getAgentMode, getOpenRouterSettings, getResumeSettings, setOpenRouterSettings } from '../db/repositories/settingsRepository'
import { readOpenRouterKey } from './keyStore'
import { getModelCatalog as realGetModelCatalog } from './modelCatalog'
import { streamChatCompletion as realStreamChatCompletion } from './streamChat'
import { callTool as realCallTool, listToolDefinitions as realListToolDefinitions } from './mcpBridge'
import {
  cancelApprovalsForSession as realCancelApprovalsForSession,
  listPendingApprovals as realListPendingApprovals,
  requestApproval as realRequestApproval,
  resolveApproval as realResolveApproval
} from './toolApprovalGate'
import { isSessionBusy, markSessionBusy, markSessionIdle } from './sessionActivity'
import { buildChatSystemPrompt } from './systemPrompt'
import { buildModelMessages } from './contextWindow'
import { broadcastChatEvent } from '../ipc/chatBroadcast'
import { invalidateOpenRouterConnectionCache } from '../ipc/openrouter'
import { logActivity } from '../db/repositories/activityLogRepository'
import { appLogger } from '../logger'

/**
 * The chat-mode equivalent of a CLI coding agent's read-eval-print loop:
 * one user message in, a streamed model reply out, any tool calls the
 * model asked for run against Applyer's own MCP server in-process
 * (`mcpBridge.ts`) with an approval gate (`toolApprovalGate.ts`) for
 * anything in the user's `toolApproval.askFor` list, and every step of
 * that persisted to `chatRepository` and pushed live to the renderer as a
 * `ChatStreamEvent` (see that type's doc comment for the exact sequence a
 * turn produces).
 *
 * `sendChatMessage` deliberately does not await the turn it starts: it
 * validates, persists the user's message, and returns as soon as that is
 * durable, the same way a terminal's input box doesn't block on the CLI
 * agent finishing its reply. Everything from `turn_started` onward happens
 * on a detached promise tracked in `runningTurns`, which is how a tool call
 * can sit for minutes waiting on a user's approval without holding the IPC
 * call open that whole time. Tests that need to know a turn has actually
 * finished use `__waitForTurnForTests`, which awaits that same promise.
 *
 * `deps` exists purely so tests can script a fake `streamChatCompletion`
 * and `callTool` (a stream that proposes tool calls, a denied approval, a
 * mid-tool abort, a mid-stream error, the max-rounds cap) without a real
 * network call or a real MCP round trip; production code never touches it
 * beyond the module's own default wiring.
 */

export const MAX_TOOL_ROUNDS = 40
/** How long content/reasoning deltas are batched before being pushed to the renderer, so a fast stream doesn't flood IPC with one message per token. */
export const DELTA_COALESCE_MS = 40
/** Tokens held back from the model's own context window for its reply; `contextWindow.ts` trims history to stay under `contextLength - reserveTokens`. */
export const CONTEXT_RESERVE_TOKENS = 4000
/** Used only when the session's model can't be found in the (possibly stale or unreachable) catalog, a conservative context size that keeps trimming from ever running unbounded. */
export const FALLBACK_CONTEXT_LENGTH = 128000

export interface AgentRunnerDeps {
  streamChatCompletion: typeof realStreamChatCompletion
  listToolDefinitions: typeof realListToolDefinitions
  callTool: typeof realCallTool
  requestApproval: typeof realRequestApproval
  resolveApproval: typeof realResolveApproval
  listPendingApprovals: typeof realListPendingApprovals
  cancelApprovalsForSession: typeof realCancelApprovalsForSession
  getModelCatalog: typeof realGetModelCatalog
}

const defaultDeps: AgentRunnerDeps = {
  streamChatCompletion: realStreamChatCompletion,
  listToolDefinitions: realListToolDefinitions,
  callTool: realCallTool,
  requestApproval: realRequestApproval,
  resolveApproval: realResolveApproval,
  listPendingApprovals: realListPendingApprovals,
  cancelApprovalsForSession: realCancelApprovalsForSession,
  getModelCatalog: realGetModelCatalog
}

let deps: AgentRunnerDeps = defaultDeps

/** Test-only: overrides one or more dependencies; anything not given keeps the real implementation. */
export function __setAgentRunnerDepsForTests(overrides: Partial<AgentRunnerDeps>): void {
  deps = { ...defaultDeps, ...overrides }
}

/** Test-only: restores every dependency to the real implementation. */
export function __resetAgentRunnerDepsForTests(): void {
  deps = defaultDeps
}

const abortControllers = new Map<string, AbortController>()
const runningTurns = new Map<string, Promise<void>>()

/** Test-only: resolves once the session's in-flight turn (if any) has finished, the detached promise `sendChatMessage` kicks off but does not itself await. */
export function __waitForTurnForTests(sessionId: string): Promise<void> {
  return runningTurns.get(sessionId) ?? Promise.resolve()
}

function broadcastSessionUpdated(sessionId: string): void {
  const session = getChatSession(sessionId)
  if (session) broadcastChatEvent({ type: 'session_updated', session: { ...session, busy: isSessionBusy(sessionId) } })
}

function addUsage(total: ChatUsage | null, delta: ChatUsage | null): ChatUsage | null {
  if (!delta) return total
  if (!total) return { ...delta }
  return {
    promptTokens: total.promptTokens + delta.promptTokens,
    completionTokens: total.completionTokens + delta.completionTokens,
    costUsd: total.costUsd == null && delta.costUsd == null ? null : (total.costUsd ?? 0) + (delta.costUsd ?? 0)
  }
}

/** The default title `createChatSession` gives a brand-new session; renamed to the message's own first line once the user actually says something. */
const DEFAULT_SESSION_TITLE = 'New chat'

function maybeRenameFromFirstMessage(session: ChatSession, text: string): void {
  if (session.title !== DEFAULT_SESSION_TITLE) return
  const firstLine = text.split('\n', 1)[0]!.trim()
  if (firstLine.length === 0) return
  const renamed = renameChatSession(session.id, firstLine.slice(0, 40))
  if (renamed) broadcastSessionUpdated(session.id)
}

async function resolveContextLength(modelId: string): Promise<number> {
  const result = await deps.getModelCatalog()
  if (!result.ok) return FALLBACK_CONTEXT_LENGTH
  const model = result.catalog.models.find((candidate) => candidate.id === modelId)
  return model?.contextLength ?? FALLBACK_CONTEXT_LENGTH
}

/**
 * One full turn: builds the model's context, streams a reply, and keeps
 * looping through tool-call rounds (bounded by `MAX_TOOL_ROUNDS`) until the
 * model stops asking for tools, the stream errors, or the turn is stopped.
 * Never throws: every path that can fail ends the turn with a broadcast
 * event instead, and the `finally` block guarantees the session is marked
 * idle even if something inside genuinely does throw.
 */
async function runTurn(sessionId: string): Promise<void> {
  const controller = new AbortController()
  abortControllers.set(sessionId, controller)
  let toolCallsExecuted = 0
  let lastAssistantMessageId: string | null = null
  let turnUsage: ChatUsage | null = null
  // Set at every exit point so the single `finally` log line below always
  // says how the turn actually ended, rather than scattering a "finished"
  // log across every branch that can return.
  let outcome = 'ended with no recognized outcome (a bug in this loop)'

  try {
    const keyInfo = readOpenRouterKey()
    if (!keyInfo) {
      broadcastChatEvent({ type: 'turn_failed', sessionId, messageId: null, error: appError('openrouterNotConnected') })
      outcome = 'failed: the OpenRouter key was cleared mid-turn'
      return
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const session = getChatSession(sessionId)
      if (!session) {
        outcome = 'ended: the session was deleted mid-turn'
        return
      }

      // `let`: an "allow always" answer mid-round rewrites the ask list, and
      // the next call in the same batch has to see the rewritten one.
      let settings = getOpenRouterSettings()
      const resumeSettings = getResumeSettings()
      const contextLength = await resolveContextLength(session.modelId)
      const systemPrompt = buildChatSystemPrompt({ autoTailor: resumeSettings.autoTailor, modelId: session.modelId })
      const history = listAllChatMessages(sessionId)
      const messages = buildModelMessages(history, { systemPrompt, contextLength, reserveTokens: CONTEXT_RESERVE_TOKENS })
      const tools = await deps.listToolDefinitions()

      const assistantRow = insertChatMessage({
        sessionId,
        role: 'assistant',
        content: '',
        reasoning: null,
        reasoningDetails: null,
        toolCalls: null,
        toolCallId: null,
        modelId: session.modelId,
        usage: null,
        error: null
      })
      lastAssistantMessageId = assistantRow.id
      broadcastChatEvent({ type: 'turn_started', sessionId, messageId: assistantRow.id })

      let pendingContent = ''
      let pendingReasoning = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flush = (): void => {
        if (pendingContent.length > 0) {
          broadcastChatEvent({ type: 'content_delta', sessionId, messageId: assistantRow.id, delta: pendingContent })
          pendingContent = ''
        }
        if (pendingReasoning.length > 0) {
          broadcastChatEvent({ type: 'reasoning_delta', sessionId, messageId: assistantRow.id, delta: pendingReasoning })
          pendingReasoning = ''
        }
        flushTimer = null
      }
      const scheduleFlush = (): void => {
        if (!flushTimer) flushTimer = setTimeout(flush, DELTA_COALESCE_MS)
      }

      const result = await deps.streamChatCompletion(
        { apiKey: keyInfo.key, modelId: session.modelId, messages, tools, reasoningEffort: settings.reasoningEffort },
        {
          onContent: (delta) => {
            pendingContent += delta
            scheduleFlush()
          },
          onReasoning: (delta) => {
            pendingReasoning += delta
            scheduleFlush()
          }
        },
        { signal: controller.signal }
      )
      if (flushTimer) clearTimeout(flushTimer)
      flush()

      if (!result.ok) {
        if (result.aborted) {
          const cancelledCalls: ChatToolCall[] = result.partial.toolCalls.map((call) => ({
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            status: 'cancelled',
            result: null,
            isError: false,
            durationMs: null
          }))
          const updated = updateChatMessage(assistantRow.id, {
            content: result.partial.content,
            reasoning: result.partial.reasoning.length > 0 ? result.partial.reasoning : null,
            toolCalls: cancelledCalls.length > 0 ? cancelledCalls : null,
            error: null
          })
          if (updated) broadcastChatEvent({ type: 'message_completed', sessionId, message: updated })
          broadcastChatEvent({ type: 'turn_completed', sessionId, usage: turnUsage })
          outcome = 'stopped: aborted while streaming, before any tool call was proposed'
          return
        }
        const updated = updateChatMessage(assistantRow.id, {
          content: result.partial.content,
          reasoning: result.partial.reasoning.length > 0 ? result.partial.reasoning : null,
          error: result.error
        })
        if (updated) broadcastChatEvent({ type: 'message_completed', sessionId, message: updated })
        // The Settings card and the chat panel's status line read the
        // cached connection; a 401 here means that cache is stale.
        if (result.error.code === 'openrouterKeyRejected') invalidateOpenRouterConnectionCache()
        broadcastChatEvent({ type: 'turn_failed', sessionId, messageId: assistantRow.id, error: result.error })
        outcome = `failed: the model stream errored (${result.error.code})`
        return
      }

      turnUsage = addUsage(turnUsage, result.usage)
      if (result.usage) addChatSessionCost(sessionId, result.usage.costUsd ?? 0)

      const toolCallRecords: ChatToolCall[] = result.toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        status: settings.toolApproval.askFor.includes(call.name) ? 'pending_approval' : 'running',
        result: null,
        isError: false,
        durationMs: null
      }))

      const streamedAssistant = updateChatMessage(assistantRow.id, {
        content: result.content,
        reasoning: result.reasoning.length > 0 ? result.reasoning : null,
        reasoningDetails: result.reasoningDetails,
        usage: result.usage,
        modelId: session.modelId,
        toolCalls: toolCallRecords.length > 0 ? toolCallRecords : null
      })

      if (toolCallRecords.length === 0) {
        if (streamedAssistant) broadcastChatEvent({ type: 'message_completed', sessionId, message: streamedAssistant })
        broadcastChatEvent({ type: 'turn_completed', sessionId, usage: turnUsage })
        outcome = 'completed'
        return
      }

      broadcastChatEvent({ type: 'tool_calls_proposed', sessionId, messageId: assistantRow.id, toolCalls: toolCallRecords })

      /** Marks every call from `from` onward as cancelled, in place, used both for a stop that lands between calls and one the gate reports mid-approval. */
      const cancelFrom = (from: number): void => {
        for (let j = from; j < toolCallRecords.length; j++) {
          const existing = toolCallRecords[j]
          if (existing) toolCallRecords[j] = { ...existing, status: 'cancelled' }
        }
      }

      let stoppedMidTool = false
      for (let i = 0; i < toolCallRecords.length; i++) {
        if (controller.signal.aborted) {
          stoppedMidTool = true
          cancelFrom(i)
          break
        }

        let call = toolCallRecords[i]!

        if (call.status === 'pending_approval') {
          broadcastChatEvent({
            type: 'tool_approval_requested',
            sessionId,
            messageId: assistantRow.id,
            toolCallId: call.id,
            name: call.name,
            arguments: call.arguments
          })
          const resolution = await deps.requestApproval({
            sessionId,
            messageId: assistantRow.id,
            toolCallId: call.id,
            name: call.name,
            arguments: call.arguments
          })

          if (resolution.cancelled) {
            stoppedMidTool = true
            cancelFrom(i)
            break
          }

          if (resolution.decision === 'deny') {
            const denialText = JSON.stringify({ error: 'The user denied this tool call.' })
            call = { ...call, status: 'denied', result: denialText, isError: true }
            toolCallRecords[i] = call
            insertChatMessage({
              sessionId,
              role: 'tool',
              content: denialText,
              reasoning: null,
              reasoningDetails: null,
              toolCalls: null,
              toolCallId: call.id,
              modelId: null,
              usage: null,
              error: null
            })
            broadcastChatEvent({ type: 'tool_call_updated', sessionId, messageId: assistantRow.id, toolCall: call })
            continue
          }

          if (resolution.decision === 'allow_always') {
            settings = { ...settings, toolApproval: { askFor: settings.toolApproval.askFor.filter((name) => name !== call.name) } }
            setOpenRouterSettings(settings)
            // The rest of this batch was stamped `pending_approval` off the
            // old list; "always" means those too, not only future rounds,
            // so they are released now rather than asked about one by one.
            for (let j = i + 1; j < toolCallRecords.length; j++) {
              const later = toolCallRecords[j]
              if (!later || later.name !== call.name || later.status !== 'pending_approval') continue
              toolCallRecords[j] = { ...later, status: 'running' }
              broadcastChatEvent({ type: 'tool_call_updated', sessionId, messageId: assistantRow.id, toolCall: toolCallRecords[j]! })
            }
          }

          call = { ...call, status: 'running' }
          toolCallRecords[i] = call
          broadcastChatEvent({ type: 'tool_call_updated', sessionId, messageId: assistantRow.id, toolCall: call })
        }

        let args: unknown = {}
        let argsError: string | null = null
        try {
          args = call.arguments.trim().length > 0 ? JSON.parse(call.arguments) : {}
        } catch (err) {
          argsError = err instanceof Error ? err.message : String(err)
        }

        const startedAt = Date.now()
        const callOutcome = argsError
          ? { text: JSON.stringify({ error: `Invalid tool call arguments (not valid JSON): ${argsError}` }), isError: true }
          : await deps.callTool(call.name, args)
        const durationMs = Date.now() - startedAt

        call = { ...call, status: callOutcome.isError ? 'error' : 'done', result: callOutcome.text, isError: callOutcome.isError, durationMs }
        toolCallRecords[i] = call
        insertChatMessage({
          sessionId,
          role: 'tool',
          content: callOutcome.text,
          reasoning: null,
          reasoningDetails: null,
          toolCalls: null,
          toolCallId: call.id,
          modelId: null,
          usage: null,
          error: null
        })
        broadcastChatEvent({ type: 'tool_call_updated', sessionId, messageId: assistantRow.id, toolCall: call })
        toolCallsExecuted++
        appLogger.info(`Chat tool call ${call.name} for session ${sessionId} finished as ${call.status} in ${durationMs}ms`)

        // A stop that landed while the tool was running: the call did run,
        // so its real outcome stays recorded above, but nothing after it
        // does, and no further model round starts off its result.
        if (controller.signal.aborted) {
          stoppedMidTool = true
          cancelFrom(i + 1)
          break
        }
      }

      const finalAssistant = updateChatMessage(assistantRow.id, { toolCalls: toolCallRecords })
      if (finalAssistant) broadcastChatEvent({ type: 'message_completed', sessionId, message: finalAssistant })

      if (stoppedMidTool) {
        broadcastChatEvent({ type: 'turn_completed', sessionId, usage: turnUsage })
        outcome = 'stopped: cancelled one or more calls mid-round'
        return
      }
      // Otherwise loop again: the model gets the tool results and replies.
    }

    // Exhausted every round without the model settling on a final answer.
    broadcastChatEvent({
      type: 'turn_failed',
      sessionId,
      messageId: lastAssistantMessageId,
      error: appError('openrouterStreamError', {
        message: `The agent kept calling tools past the ${MAX_TOOL_ROUNDS}-round limit for a single turn without finishing.`
      })
    })
    outcome = `failed: hit the ${MAX_TOOL_ROUNDS}-round limit`
  } catch (err) {
    appLogger.error(`Unexpected error running a chat turn for session ${sessionId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    broadcastChatEvent({ type: 'turn_failed', sessionId, messageId: lastAssistantMessageId, error: unexpectedError(err) })
    outcome = `failed: unexpected error (${err instanceof Error ? err.message : String(err)})`
  } finally {
    markSessionIdle(sessionId)
    touchChatSession(sessionId)
    broadcastSessionUpdated(sessionId)
    abortControllers.delete(sessionId)
    deps.cancelApprovalsForSession(sessionId)
    logActivity('info', `Chat turn finished for session ${sessionId}: ${outcome}`, { toolCalls: toolCallsExecuted })
  }
}

export type SendChatMessageResult = { ok: true; messageId: string } | { ok: false; error: AppError }

/**
 * Validates and persists the user's message, then kicks off `runTurn` on a
 * detached promise (tracked in `runningTurns` for `stopChatTurn` and the
 * test helper above) rather than awaiting it (see this module's doc
 * comment for why). Resolves as soon as the user's own message is durable.
 */
export async function sendChatMessage(sessionId: string, text: string): Promise<SendChatMessageResult> {
  const session = getChatSession(sessionId)
  if (!session) return { ok: false, error: appError('chatSessionNotFound') }
  if (isSessionBusy(sessionId)) return { ok: false, error: appError('chatSessionBusy') }
  if (text.trim().length === 0 || text.length > CHAT_INPUT_MAX_CHARS) {
    return { ok: false, error: appError('chatMessageTooLong', { max: CHAT_INPUT_MAX_CHARS }) }
  }
  if (!readOpenRouterKey()) return { ok: false, error: appError('openrouterNotConnected') }
  if (getAgentMode() !== 'openrouter') return { ok: false, error: appError('openrouterNotConnected') }

  markSessionBusy(sessionId)
  broadcastSessionUpdated(sessionId)

  const userMessage = insertChatMessage({
    sessionId,
    role: 'user',
    content: text,
    reasoning: null,
    reasoningDetails: null,
    toolCalls: null,
    toolCallId: null,
    modelId: null,
    usage: null,
    error: null
  })

  maybeRenameFromFirstMessage(session, text)

  logActivity('info', `Chat turn started for session ${sessionId}`)
  const turn = runTurn(sessionId).finally(() => {
    if (runningTurns.get(sessionId) === turn) runningTurns.delete(sessionId)
  })
  runningTurns.set(sessionId, turn)

  return { ok: true, messageId: userMessage.id }
}

export type StopChatTurnResult = { ok: true } | { ok: false; error: AppError }

/** Aborts the session's in-flight stream (if any) and cancels any tool call it was waiting on approval for. A no-op error, not a throw, when nothing is running. */
export function stopChatTurn(sessionId: string): StopChatTurnResult {
  const controller = abortControllers.get(sessionId)
  if (!controller) return { ok: false, error: appError('chatSessionNotBusy') }
  controller.abort()
  deps.cancelApprovalsForSession(sessionId)
  return { ok: true }
}

export type RespondToolApprovalResult = { ok: true } | { ok: false; error: AppError }

/** Answers a pending `tool_approval_requested`. Refuses (rather than silently resolving someone else's call) unless the given session actually has a matching pending request. */
export function respondToolApproval(sessionId: string, toolCallId: string, decision: ToolApprovalDecision): RespondToolApprovalResult {
  const isWaiting = deps
    .listPendingApprovals()
    .some((request) => request.sessionId === sessionId && request.toolCallId === toolCallId)
  if (!isWaiting) return { ok: false, error: appError('chatToolApprovalNotWaiting') }
  deps.resolveApproval(toolCallId, decision)
  return { ok: true }
}

/**
 * Called once at startup, after the database opens: any tool call a
 * previous process left `pending_approval` or `running` was streaming or
 * waiting on the user when the app quit (a crash, a force-quit, an update
 * relaunch), and is never coming back to finish on its own: nothing
 * still holds that turn's `AbortController` or its promise in
 * `toolApprovalGate`, both of which are in-memory and gone with the old
 * process. Marking them `cancelled` here is what lets `contextWindow.ts`
 * later paper over them with a synthesized denial instead of sending a
 * dangling `tool_calls` entry back to the model.
 */
export function recoverInterruptedTurns(): void {
  const stuck = listMessagesWithActiveToolCalls()
  for (const message of stuck) {
    if (!message.toolCalls) continue
    const patched: ChatToolCall[] = message.toolCalls.map((call) =>
      call.status === 'pending_approval' || call.status === 'running' ? { ...call, status: 'cancelled' } : call
    )
    updateChatMessage(message.id, { toolCalls: patched })
  }
  if (stuck.length > 0) {
    appLogger.info(`Recovered ${stuck.length} chat message(s) with tool calls left running by a previous session`)
  }
}

