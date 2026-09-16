import { describe, expect, it } from 'vitest'
import {
  isChatMessage,
  isChatSession,
  isChatStreamEvent,
  isPendingToolApproval,
  isToolApprovalDecision
} from './chat'
import type { ChatMessage, ChatSession, ChatToolCall } from './chat'

const VALID_SESSION: ChatSession = {
  id: 'session-1',
  title: 'Untitled',
  modelId: 'deepseek/deepseek-v4.1-flash',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messageCount: 2,
  totalCostUsd: 0.01,
  busy: false
}

const VALID_TOOL_CALL: ChatToolCall = {
  id: 'call-1',
  name: 'queue_job',
  arguments: '{"jobId":"job-1"}',
  status: 'done',
  result: 'ok',
  isError: false,
  durationMs: 120
}

const VALID_MESSAGE: ChatMessage = {
  id: 'msg-1',
  sessionId: 'session-1',
  role: 'assistant',
  content: 'Hello',
  reasoning: null,
  reasoningDetails: null,
  toolCalls: [VALID_TOOL_CALL],
  toolCallId: null,
  modelId: 'deepseek/deepseek-v4.1-flash',
  usage: { promptTokens: 10, completionTokens: 20, costUsd: 0.002 },
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('isChatSession', () => {
  it('accepts a well-formed session', () => {
    expect(isChatSession(VALID_SESSION)).toBe(true)
  })

  it.each([
    null,
    {},
    { ...VALID_SESSION, id: '' },
    { ...VALID_SESSION, messageCount: '2' },
    { ...VALID_SESSION, totalCostUsd: Number.NaN },
    { ...VALID_SESSION, busy: 'false' }
  ])('rejects malformed sessions: %j', (value) => {
    expect(isChatSession(value)).toBe(false)
  })
})

describe('isChatMessage', () => {
  it('accepts a well-formed assistant message with tool calls and usage', () => {
    expect(isChatMessage(VALID_MESSAGE)).toBe(true)
  })

  it('accepts a minimal user message with every nullable field null', () => {
    expect(
      isChatMessage({
        id: 'msg-2',
        sessionId: 'session-1',
        role: 'user',
        content: 'Hi',
        reasoning: null,
        reasoningDetails: null,
        toolCalls: null,
        toolCallId: null,
        modelId: null,
        usage: null,
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z'
      })
    ).toBe(true)
  })

  it('is lenient when optional/nullable fields are simply absent', () => {
    const { reasoning, reasoningDetails, toolCalls, toolCallId, modelId, usage, error, ...rest } = VALID_MESSAGE
    void reasoning
    void reasoningDetails
    void toolCalls
    void toolCallId
    void modelId
    void usage
    void error
    expect(isChatMessage(rest)).toBe(true)
  })

  it('rejects an unknown role and missing ids', () => {
    expect(isChatMessage({ ...VALID_MESSAGE, role: 'system' })).toBe(false)
    expect(isChatMessage({ ...VALID_MESSAGE, id: '' })).toBe(false)
    expect(isChatMessage({ ...VALID_MESSAGE, sessionId: '' })).toBe(false)
  })

  it('rejects a malformed tool call inside toolCalls', () => {
    expect(isChatMessage({ ...VALID_MESSAGE, toolCalls: [{ id: 'x' }] })).toBe(false)
    expect(isChatMessage({ ...VALID_MESSAGE, toolCalls: [{ ...VALID_TOOL_CALL, status: 'bogus' }] })).toBe(false)
  })

  it('rejects a malformed usage or error shape', () => {
    expect(isChatMessage({ ...VALID_MESSAGE, usage: { promptTokens: '10' } })).toBe(false)
    expect(isChatMessage({ ...VALID_MESSAGE, error: { code: 42 } })).toBe(false)
  })
})

describe('isChatStreamEvent', () => {
  it('accepts every variant with its required fields', () => {
    expect(isChatStreamEvent({ type: 'turn_started', sessionId: 's1', messageId: 'm1' })).toBe(true)
    expect(isChatStreamEvent({ type: 'content_delta', sessionId: 's1', messageId: 'm1', delta: 'hi' })).toBe(true)
    expect(isChatStreamEvent({ type: 'reasoning_delta', sessionId: 's1', messageId: 'm1', delta: 'hmm' })).toBe(true)
    expect(
      isChatStreamEvent({ type: 'tool_calls_proposed', sessionId: 's1', messageId: 'm1', toolCalls: [VALID_TOOL_CALL] })
    ).toBe(true)
    expect(
      isChatStreamEvent({ type: 'tool_call_updated', sessionId: 's1', messageId: 'm1', toolCall: VALID_TOOL_CALL })
    ).toBe(true)
    expect(
      isChatStreamEvent({
        type: 'tool_approval_requested',
        sessionId: 's1',
        messageId: 'm1',
        toolCallId: 'call-1',
        name: 'queue_job',
        arguments: '{}'
      })
    ).toBe(true)
    expect(isChatStreamEvent({ type: 'message_completed', sessionId: 's1', message: VALID_MESSAGE })).toBe(true)
    expect(isChatStreamEvent({ type: 'turn_completed', sessionId: 's1', usage: null })).toBe(true)
    expect(
      isChatStreamEvent({
        type: 'turn_completed',
        sessionId: 's1',
        usage: { promptTokens: 1, completionTokens: 1, costUsd: null }
      })
    ).toBe(true)
    expect(
      isChatStreamEvent({ type: 'turn_failed', sessionId: 's1', messageId: null, error: { code: 'unexpected' } })
    ).toBe(true)
    expect(isChatStreamEvent({ type: 'session_updated', session: VALID_SESSION })).toBe(true)
    expect(isChatStreamEvent({ type: 'session_deleted', sessionId: 's1' })).toBe(true)
  })

  it.each([
    null,
    {},
    { type: 'bogus' },
    { type: 'turn_started', sessionId: 's1' },
    { type: 'content_delta', sessionId: 's1', messageId: 'm1', delta: 42 },
    { type: 'tool_calls_proposed', sessionId: 's1', messageId: 'm1', toolCalls: [{ id: 'x' }] },
    { type: 'message_completed', sessionId: 's1', message: { id: '' } },
    { type: 'turn_failed', sessionId: 's1', messageId: null, error: 'boom' },
    { type: 'session_updated', session: { id: '' } },
    { type: 'session_deleted', sessionId: '' }
  ])('rejects malformed stream events: %j', (value) => {
    expect(isChatStreamEvent(value)).toBe(false)
  })
})

describe('isToolApprovalDecision', () => {
  it.each(['allow_once', 'allow_always', 'deny'])('accepts %s', (decision) => {
    expect(isToolApprovalDecision(decision)).toBe(true)
  })

  it.each([undefined, '', 'allow', true, null])('rejects an unknown decision: %j', (decision) => {
    expect(isToolApprovalDecision(decision)).toBe(false)
  })
})

describe('isPendingToolApproval', () => {
  const VALID = { sessionId: 's1', messageId: 'm1', toolCallId: 'call-1', name: 'queue_job', arguments: '{}' }

  it('accepts a well-formed pending approval', () => {
    expect(isPendingToolApproval(VALID)).toBe(true)
  })

  it.each([
    null,
    {},
    { ...VALID, sessionId: '' },
    { ...VALID, toolCallId: '' },
    { ...VALID, name: '' },
    { ...VALID, arguments: 42 }
  ])('rejects malformed pending approvals: %j', (value) => {
    expect(isPendingToolApproval(value)).toBe(false)
  })
})
