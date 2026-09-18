import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import { __resetElectronMock } from '../../../test/mocks/electron'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

const mocks = vi.hoisted(() => ({ broadcastChatEvent: vi.fn() }))
vi.mock('../ipc/chatBroadcast', () => ({ broadcastChatEvent: mocks.broadcastChatEvent }))

import {
  sendChatMessage,
  stopChatTurn,
  respondToolApproval,
  recoverInterruptedTurns,
  __setAgentRunnerDepsForTests,
  __resetAgentRunnerDepsForTests,
  __waitForTurnForTests,
  MAX_TOOL_ROUNDS
} from './agentRunner'
import { createChatSession, getChatMessage, insertChatMessage, listAllChatMessages } from '../db/repositories/chatRepository'
import { getOpenRouterSettings, setAgentMode, setOpenRouterSettings, setStorageMode } from '../db/repositories/settingsRepository'
import { storeOpenRouterKey } from './keyStore'
import type { ChatMessage } from '@shared/types/chat'
import type { OpenAiTool } from './streamChat'
import type { StreamResult } from './streamChat'
import type { PendingToolApproval, ToolApprovalDecision } from '@shared/types/chat'

/**
 * A minimal, test-scoped stand-in for `toolApprovalGate.ts`: a real gate
 * would work too, but this lets a test resolve or cancel a specific
 * pending approval on demand without racing the module's own promise
 * bookkeeping.
 */
function createFakeGate(): {
  requestApproval: (request: PendingToolApproval) => Promise<{ decision: ToolApprovalDecision; cancelled: boolean }>
  resolveApproval: (toolCallId: string, decision: ToolApprovalDecision) => boolean
  cancelApprovalsForSession: (sessionId: string) => void
  listPendingApprovals: () => PendingToolApproval[]
} {
  const pending = new Map<string, { request: PendingToolApproval; resolve: (r: { decision: ToolApprovalDecision; cancelled: boolean }) => void }>()
  return {
    requestApproval: (request) =>
      new Promise((resolve) => {
        pending.set(request.toolCallId, { request, resolve })
      }),
    resolveApproval: (toolCallId, decision) => {
      const entry = pending.get(toolCallId)
      if (!entry) return false
      pending.delete(toolCallId)
      entry.resolve({ decision, cancelled: false })
      return true
    },
    cancelApprovalsForSession: (sessionId) => {
      for (const [id, entry] of pending) {
        if (entry.request.sessionId !== sessionId) continue
        pending.delete(id)
        entry.resolve({ decision: 'deny', cancelled: true })
      }
    },
    listPendingApprovals: () => [...pending.values()].map((entry) => entry.request)
  }
}

function okResult(overrides: Partial<Extract<StreamResult, { ok: true }>> = {}): StreamResult {
  return {
    ok: true,
    content: '',
    reasoning: '',
    reasoningDetails: null,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.001 },
    ...overrides
  }
}

function errorResult(overrides: Partial<Extract<StreamResult, { ok: false }>> = {}): StreamResult {
  return {
    ok: false,
    aborted: false,
    error: { code: 'openrouterStreamError' },
    partial: { content: '', reasoning: '', toolCalls: [] },
    ...overrides
  }
}

const NO_TOOLS: OpenAiTool[] = []

function setUpConnectedSession(modelId = 'test/model'): { sessionId: string } {
  setStorageMode('plaintext')
  setAgentMode('openrouter')
  storeOpenRouterKey('test-key')
  setOpenRouterSettings({ modelId, reasoningEffort: 'default', toolApproval: { askFor: [] } })
  const session = createChatSession({ title: 'New chat', modelId })
  return { sessionId: session.id }
}

function eventTypes(): string[] {
  return mocks.broadcastChatEvent.mock.calls.map(([event]) => (event as { type: string }).type)
}

/**
 * `__setAgentRunnerDepsForTests` merges its overrides onto the *real*
 * default deps, not onto whatever is currently installed (see its doc
 * comment), so every call in this file needs `listToolDefinitions` and
 * `getModelCatalog` stubbed too, or a later call would silently fall back
 * to the real MCP bridge / a real network fetch. This wraps every call so
 * a test only has to name what it actually cares about.
 */
function setDeps(overrides: Partial<Parameters<typeof __setAgentRunnerDepsForTests>[0]> = {}): void {
  __setAgentRunnerDepsForTests({
    listToolDefinitions: async () => NO_TOOLS,
    getModelCatalog: async () => ({ ok: false, error: { code: 'openrouterRequestFailed' } }),
    ...overrides
  })
}

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
  mocks.broadcastChatEvent.mockReset()
  setDeps()
})

afterEach(() => {
  __resetAgentRunnerDepsForTests()
})

describe('sendChatMessage: validation', () => {
  it('rejects an unknown session', async () => {
    const result = await sendChatMessage('nope', 'hi')
    expect(result).toEqual({ ok: false, error: { code: 'chatSessionNotFound' } })
  })

  it('rejects an empty or whitespace-only message', async () => {
    const { sessionId } = setUpConnectedSession()
    const result = await sendChatMessage(sessionId, '   ')
    expect(result).toMatchObject({ ok: false, error: { code: 'chatMessageTooLong' } })
  })

  it('rejects a message over the character limit', async () => {
    const { sessionId } = setUpConnectedSession()
    const result = await sendChatMessage(sessionId, 'x'.repeat(20001))
    expect(result).toMatchObject({ ok: false, error: { code: 'chatMessageTooLong' } })
  })

  it('rejects when no OpenRouter key is stored', async () => {
    setStorageMode('plaintext')
    setAgentMode('openrouter')
    const session = createChatSession({ title: 'New chat', modelId: 'test/model' })
    const result = await sendChatMessage(session.id, 'hello')
    expect(result).toMatchObject({ ok: false, error: { code: 'openrouterNotConnected' } })
  })

  it('rejects when agent mode is not openrouter', async () => {
    setStorageMode('plaintext')
    storeOpenRouterKey('test-key')
    setAgentMode('cli')
    const session = createChatSession({ title: 'New chat', modelId: 'test/model' })
    const result = await sendChatMessage(session.id, 'hello')
    expect(result).toMatchObject({ ok: false, error: { code: 'openrouterNotConnected' } })
  })

  it('rejects a second send while the session is already busy', async () => {
    const { sessionId } = setUpConnectedSession()
    setDeps({ streamChatCompletion: vi.fn(() => new Promise<StreamResult>(() => {})) })
    await sendChatMessage(sessionId, 'first')
    const second = await sendChatMessage(sessionId, 'second')
    expect(second).toMatchObject({ ok: false, error: { code: 'chatSessionBusy' } })
    stopChatTurn(sessionId)
  })
})

describe('sendChatMessage: a plain reply with no tool calls', () => {
  it('produces the documented event sequence and persists the assistant reply', async () => {
    const { sessionId } = setUpConnectedSession()
    setDeps({
      streamChatCompletion: vi.fn(async (_req, handlers) => {
        handlers.onContent('Hello ')
        handlers.onContent('there')
        return okResult({ content: 'Hello there' })
      })
    })

    const sendResult = await sendChatMessage(sessionId, 'hi')
    expect(sendResult.ok).toBe(true)
    await __waitForTurnForTests(sessionId)

    expect(eventTypes()).toEqual([
      'session_updated', // busy: true, from sendChatMessage
      'session_updated', // renamed from the default title to the message's first line
      'turn_started',
      'content_delta',
      'message_completed',
      'turn_completed',
      'session_updated' // busy: false, from the turn's finally block
    ])

    const history = listAllChatMessages(sessionId)
    expect(history).toHaveLength(2) // user + assistant
    expect(history[1]).toMatchObject({ role: 'assistant', content: 'Hello there' })
  })

  it('renames a still-default-titled session to the first line of the message', async () => {
    const { sessionId } = setUpConnectedSession()
    setDeps({ streamChatCompletion: vi.fn().mockResolvedValue(okResult({ content: 'ok' })) })
    await sendChatMessage(sessionId, 'Find me backend roles\nin Sydney please')
    await __waitForTurnForTests(sessionId)
    const renamedEvent = mocks.broadcastChatEvent.mock.calls
      .map(([event]) => event as { type: string; session?: { title: string } })
      .find((event) => event.type === 'session_updated' && event.session?.title === 'Find me backend roles')
    expect(renamedEvent).toBeDefined()
  })
})

describe('sendChatMessage: tool calls', () => {
  it('runs an allowed tool call, updates its status, and loops to a final reply', async () => {
    const { sessionId } = setUpConnectedSession()
    let round = 0
    setDeps({
      streamChatCompletion: vi.fn(async () => {
        round++
        if (round === 1) {
          return okResult({ toolCalls: [{ id: 'call1', name: 'queue_job', arguments: '{"url":"https://x.com"}' }] })
        }
        return okResult({ content: 'Queued it.' })
      }),
      callTool: vi.fn().mockResolvedValue({ text: '{"ok":true}', isError: false })
    })

    await sendChatMessage(sessionId, 'queue this job')
    await __waitForTurnForTests(sessionId)

    expect(eventTypes()).toEqual([
      'session_updated', // busy: true
      'session_updated', // renamed from the default title
      'turn_started',
      'tool_calls_proposed',
      'tool_call_updated', // done
      'message_completed', // round 1 final, with the resolved tool call
      'turn_started', // round 2
      'message_completed',
      'turn_completed',
      'session_updated' // busy: false
    ])

    const history = listAllChatMessages(sessionId)
    const toolMessage = history.find((m) => m.role === 'tool')
    expect(toolMessage?.content).toBe('{"ok":true}')
    expect(toolMessage?.toolCallId).toBe('call1')
    const assistantWithCall = history.find((m) => m.toolCalls?.some((c) => c.id === 'call1'))
    expect(assistantWithCall?.toolCalls?.[0]).toMatchObject({ status: 'done', result: '{"ok":true}' })
  })

  it('asks for approval when the tool is in toolApproval.askFor, and records a denial', async () => {
    const { sessionId } = setUpConnectedSession()
    setOpenRouterSettings({ modelId: 'test/model', reasoningEffort: 'default', toolApproval: { askFor: ['queue_job'] } })
    const gate = createFakeGate()
    let round = 0
    setDeps({
      streamChatCompletion: vi.fn(async () => {
        round++
        if (round === 1) return okResult({ toolCalls: [{ id: 'call1', name: 'queue_job', arguments: '{}' }] })
        return okResult({ content: 'Understood, not queuing.' })
      }),
      requestApproval: gate.requestApproval,
      resolveApproval: gate.resolveApproval,
      cancelApprovalsForSession: gate.cancelApprovalsForSession,
      listPendingApprovals: gate.listPendingApprovals
    })

    const sendPromise = sendChatMessage(sessionId, 'queue this job')
    await sendPromise
    // Wait for the approval request to actually be broadcast before answering it.
    await vi.waitFor(() => expect(eventTypes()).toContain('tool_approval_requested'))
    const respondResult = respondToolApproval(sessionId, 'call1', 'deny')
    expect(respondResult).toEqual({ ok: true })

    await __waitForTurnForTests(sessionId)

    expect(eventTypes()).toContain('tool_approval_requested')
    const history = listAllChatMessages(sessionId)
    const toolMessage = history.find((m) => m.role === 'tool')
    expect(toolMessage?.content).toBe(JSON.stringify({ error: 'The user denied this tool call.' }))
    const assistantWithCall = history.find((m) => m.toolCalls?.some((c) => c.id === 'call1'))
    expect(assistantWithCall?.toolCalls?.[0]).toMatchObject({ status: 'denied' })
  })

  it('allow_always releases the later calls to the same tool in the same batch instead of asking again', async () => {
    const { sessionId } = setUpConnectedSession()
    setOpenRouterSettings({ modelId: 'test/model', reasoningEffort: 'default', toolApproval: { askFor: ['queue_job'] } })
    const gate = createFakeGate()
    let round = 0
    setDeps({
      streamChatCompletion: vi.fn(async () => {
        round++
        if (round === 1) {
          return okResult({
            toolCalls: [
              { id: 'call1', name: 'queue_job', arguments: '{}' },
              { id: 'call2', name: 'queue_job', arguments: '{}' }
            ]
          })
        }
        return okResult({ content: 'Both queued.' })
      }),
      callTool: vi.fn().mockResolvedValue({ text: '{"ok":true}', isError: false }),
      requestApproval: gate.requestApproval,
      resolveApproval: gate.resolveApproval,
      cancelApprovalsForSession: gate.cancelApprovalsForSession,
      listPendingApprovals: gate.listPendingApprovals
    })

    await sendChatMessage(sessionId, 'queue both')
    await vi.waitFor(() => expect(eventTypes()).toContain('tool_approval_requested'))
    expect(respondToolApproval(sessionId, 'call1', 'allow_always')).toEqual({ ok: true })
    await __waitForTurnForTests(sessionId)

    expect(eventTypes().filter((type) => type === 'tool_approval_requested')).toHaveLength(1)
    expect(getOpenRouterSettings().toolApproval.askFor).toEqual([])
    const assistantWithCalls = listAllChatMessages(sessionId).find((m) => m.toolCalls && m.toolCalls.length === 2)
    expect(assistantWithCalls?.toolCalls?.map((c) => c.status)).toEqual(['done', 'done'])
  })

  it('two allow_always answers in one round keep both tools off the ask list', async () => {
    const { sessionId } = setUpConnectedSession()
    setOpenRouterSettings({ modelId: 'test/model', reasoningEffort: 'default', toolApproval: { askFor: ['queue_job', 'exclude_job'] } })
    const gate = createFakeGate()
    let round = 0
    setDeps({
      streamChatCompletion: vi.fn(async () => {
        round++
        if (round === 1) {
          return okResult({
            toolCalls: [
              { id: 'call1', name: 'queue_job', arguments: '{}' },
              { id: 'call2', name: 'exclude_job', arguments: '{}' }
            ]
          })
        }
        return okResult({ content: 'Done.' })
      }),
      callTool: vi.fn().mockResolvedValue({ text: '{"ok":true}', isError: false }),
      requestApproval: gate.requestApproval,
      resolveApproval: gate.resolveApproval,
      cancelApprovalsForSession: gate.cancelApprovalsForSession,
      listPendingApprovals: gate.listPendingApprovals
    })

    await sendChatMessage(sessionId, 'queue one, exclude the other')
    await vi.waitFor(() => expect(gate.listPendingApprovals().map((p) => p.toolCallId)).toEqual(['call1']))
    expect(respondToolApproval(sessionId, 'call1', 'allow_always')).toEqual({ ok: true })
    await vi.waitFor(() => expect(gate.listPendingApprovals().map((p) => p.toolCallId)).toEqual(['call2']))
    expect(respondToolApproval(sessionId, 'call2', 'allow_always')).toEqual({ ok: true })
    await __waitForTurnForTests(sessionId)

    expect(getOpenRouterSettings().toolApproval.askFor).toEqual([])
  })

  it('respondToolApproval refuses an id nobody is waiting on', () => {
    const result = respondToolApproval('some-session', 'unknown-call', 'allow_once')
    expect(result).toEqual({ ok: false, error: { code: 'chatToolApprovalNotWaiting' } })
  })

  it('cancels the remaining tool calls and ends the turn when stopped mid-round', async () => {
    const { sessionId } = setUpConnectedSession()
    let releaseFirstCall: (() => void) | null = null
    setDeps({
      streamChatCompletion: vi.fn().mockResolvedValue(
        okResult({
          toolCalls: [
            { id: 'call1', name: 'search_jobs', arguments: '{}' },
            { id: 'call2', name: 'search_jobs', arguments: '{}' }
          ]
        })
      ),
      callTool: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseFirstCall = () => resolve({ text: '{"ok":true}', isError: false })
          })
      )
    })

    await sendChatMessage(sessionId, 'search for jobs')
    await vi.waitFor(() => expect(releaseFirstCall).not.toBeNull())
    const stopResult = stopChatTurn(sessionId)
    expect(stopResult).toEqual({ ok: true })
    releaseFirstCall!()

    await __waitForTurnForTests(sessionId)

    expect(eventTypes()).toContain('turn_completed')
    expect(eventTypes()).not.toContain('turn_failed')
    const history = listAllChatMessages(sessionId)
    const assistantWithCalls = history.find((m) => m.toolCalls && m.toolCalls.length === 2)
    expect(assistantWithCalls?.toolCalls?.[0]).toMatchObject({ id: 'call1', status: 'done' })
    expect(assistantWithCalls?.toolCalls?.[1]).toMatchObject({ id: 'call2', status: 'cancelled' })
    // Only the executed call gets a persisted tool message; the cancelled one does not.
    expect(history.filter((m) => m.role === 'tool')).toHaveLength(1)
  })
})

describe('sendChatMessage: a stop during the last tool call of a round', () => {
  it('keeps that call\'s real outcome but starts no further model round', async () => {
    const { sessionId } = setUpConnectedSession()
    let releaseCall: (() => void) | null = null
    const streamChatCompletion = vi.fn().mockResolvedValue(
      okResult({ toolCalls: [{ id: 'call1', name: 'queue_job', arguments: '{}' }] })
    )
    setDeps({
      streamChatCompletion,
      callTool: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseCall = () => resolve({ text: '{"ok":true}', isError: false })
          })
      )
    })

    await sendChatMessage(sessionId, 'queue this job')
    await vi.waitFor(() => expect(releaseCall).not.toBeNull())
    expect(stopChatTurn(sessionId)).toEqual({ ok: true })
    releaseCall!()
    await __waitForTurnForTests(sessionId)

    expect(streamChatCompletion).toHaveBeenCalledTimes(1)
    expect(eventTypes()).toContain('turn_completed')
    expect(eventTypes()).not.toContain('turn_failed')
    const history = listAllChatMessages(sessionId)
    const assistantWithCall = history.find((m) => m.toolCalls?.some((c) => c.id === 'call1'))
    expect(assistantWithCall?.toolCalls?.[0]).toMatchObject({ status: 'done', result: '{"ok":true}' })
    expect(history.filter((m) => m.role === 'tool')).toHaveLength(1)
  })
})

describe('sendChatMessage: a mid-stream error', () => {
  it('stores the error on the message and broadcasts message_completed then turn_failed', async () => {
    const { sessionId } = setUpConnectedSession()
    setDeps({
      streamChatCompletion: vi.fn().mockResolvedValue(
        errorResult({ error: { code: 'openrouterStreamError', params: { message: 'boom' } }, partial: { content: 'partial', reasoning: '', toolCalls: [] } })
      )
    })

    await sendChatMessage(sessionId, 'hi')
    await __waitForTurnForTests(sessionId)

    const types = eventTypes()
    expect(types.indexOf('message_completed')).toBeGreaterThanOrEqual(0)
    expect(types.indexOf('turn_failed')).toBeGreaterThan(types.indexOf('message_completed'))
    expect(types).not.toContain('turn_completed')

    const history = listAllChatMessages(sessionId)
    expect(history[1]).toMatchObject({ role: 'assistant', content: 'partial', error: { code: 'openrouterStreamError' } })
  })

  it('an aborted stream (no tool calls yet) ends the turn as completed, not failed', async () => {
    const { sessionId } = setUpConnectedSession()
    setDeps({
      streamChatCompletion: vi.fn().mockResolvedValue(
        errorResult({ aborted: true, partial: { content: 'partial reply', reasoning: '', toolCalls: [] } })
      )
    })

    await sendChatMessage(sessionId, 'hi')
    await __waitForTurnForTests(sessionId)

    const types = eventTypes()
    expect(types).toContain('turn_completed')
    expect(types).not.toContain('turn_failed')
    const history = listAllChatMessages(sessionId)
    expect(history[1]).toMatchObject({ content: 'partial reply', error: null })
  })
})

describe('sendChatMessage: the max-rounds cap', () => {
  it('fails the turn once the agent keeps calling tools past MAX_TOOL_ROUNDS', async () => {
    const { sessionId } = setUpConnectedSession()
    let round = 0
    setDeps({
      streamChatCompletion: vi.fn(async () => {
        round++
        return okResult({ toolCalls: [{ id: `call${round}`, name: 'search_jobs', arguments: '{}' }] })
      }),
      callTool: vi.fn().mockResolvedValue({ text: '{"ok":true}', isError: false })
    })

    await sendChatMessage(sessionId, 'keep searching forever')
    await __waitForTurnForTests(sessionId)

    expect(round).toBe(MAX_TOOL_ROUNDS)
    const types = eventTypes()
    expect(types.at(-2)).toBe('turn_failed')
    const failedEvent = mocks.broadcastChatEvent.mock.calls
      .map(([event]) => event as { type: string; error?: { code: string } })
      .find((event) => event.type === 'turn_failed')
    expect(failedEvent?.error?.code).toBe('openrouterStreamError')
  }, 15000)
})

describe('recoverInterruptedTurns', () => {
  it('cancels pending_approval and running tool calls left over from a previous process', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'New chat', modelId: 'm' })
    const message: ChatMessage = insertChatMessage({
      sessionId: session.id,
      role: 'assistant',
      content: '',
      reasoning: null,
      reasoningDetails: null,
      toolCalls: [
        { id: 'a', name: 'x', arguments: '{}', status: 'pending_approval', result: null, isError: false, durationMs: null },
        { id: 'b', name: 'x', arguments: '{}', status: 'running', result: null, isError: false, durationMs: null },
        { id: 'c', name: 'x', arguments: '{}', status: 'done', result: 'ok', isError: false, durationMs: 5 }
      ],
      toolCallId: null,
      modelId: null,
      usage: null,
      error: null
    })

    recoverInterruptedTurns()

    const reloaded = getChatMessage(message.id)
    expect(reloaded?.toolCalls?.map((c) => c.status)).toEqual(['cancelled', 'cancelled', 'done'])
  })
})
