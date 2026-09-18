// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import type { ChatMessage, ChatSession, ChatStreamEvent, ChatToolCall } from '@shared/types/chat'
import {
  applyInitialMessagesPage,
  applyOlderMessagesPage,
  applyPendingApprovals,
  appendLocalMessage,
  emptyChatFoldState,
  foldChatEvent,
  pickInitialSession,
  readStoredActiveSessionId,
  removeSessionState,
  setSessionMessagesLoading,
  setSessions,
  upsertSession,
  writeStoredActiveSessionId,
  type ChatFoldState
} from './chatStoreLogic'

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 's1',
    title: 'Session 1',
    modelId: 'openai/gpt-5',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    messageCount: 0,
    totalCostUsd: 0,
    busy: false,
    ...overrides
  }
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    role: 'assistant',
    content: '',
    reasoning: null,
    reasoningDetails: null,
    toolCalls: null,
    toolCallId: null,
    modelId: null,
    usage: null,
    error: null,
    createdAt: '2026-09-16T00:00:01.000Z',
    ...overrides
  }
}

function toolCall(overrides: Partial<ChatToolCall> = {}): ChatToolCall {
  return {
    id: 'tc1',
    name: 'search_jobs',
    arguments: '{}',
    status: 'pending_approval',
    result: null,
    isError: false,
    durationMs: null,
    ...overrides
  }
}

function loadedState(sessionId = 's1'): ChatFoldState {
  return {
    sessions: [session({ id: sessionId })],
    messagesBySession: { [sessionId]: { messages: [], hasMore: false, loading: false, loadedOnce: true } },
    runtimeBySession: {}
  }
}

describe('upsertSession', () => {
  it('prepends a session unseen before', () => {
    const result = upsertSession([], session())
    expect(result).toEqual([session()])
  })

  it('replaces an existing session in place rather than moving it', () => {
    const other = session({ id: 's0' })
    const updated = session({ title: 'Renamed' })
    const result = upsertSession([other, session()], updated)
    expect(result).toEqual([other, updated])
  })
})

describe('foldChatEvent: session list events', () => {
  it('session_updated upserts regardless of load state', () => {
    const state = emptyChatFoldState()
    const next = foldChatEvent(state, { type: 'session_updated', session: session() })
    expect(next.sessions).toEqual([session()])
  })

  it('session_deleted removes the session and its message/runtime slices', () => {
    const state: ChatFoldState = {
      sessions: [session()],
      messagesBySession: { s1: { messages: [message()], hasMore: false, loading: false, loadedOnce: true } },
      runtimeBySession: { s1: { streaming: null, pendingApprovals: [], busy: true, lastError: null } }
    }
    const next = foldChatEvent(state, { type: 'session_deleted', sessionId: 's1' })
    expect(next.sessions).toEqual([])
    expect(next.messagesBySession.s1).toBeUndefined()
    expect(next.runtimeBySession.s1).toBeUndefined()
  })
})

describe('foldChatEvent: unloaded sessions', () => {
  it('drops turn_started for a session with no messagesBySession entry', () => {
    const state = emptyChatFoldState()
    const next = foldChatEvent(state, { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    expect(next).toEqual(state)
  })

  it('drops content_delta, tool_calls_proposed and tool_approval_requested the same way', () => {
    const state = emptyChatFoldState()
    const events: ChatStreamEvent[] = [
      { type: 'content_delta', sessionId: 's1', messageId: 'm1', delta: 'hi' },
      { type: 'tool_calls_proposed', sessionId: 's1', messageId: 'm1', toolCalls: [toolCall()] },
      { type: 'tool_approval_requested', sessionId: 's1', messageId: 'm1', toolCallId: 'tc1', name: 'search_jobs', arguments: '{}' }
    ]
    for (const event of events) {
      expect(foldChatEvent(state, event)).toEqual(state)
    }
  })
})

describe('foldChatEvent: a loaded session', () => {
  it('turn_started opens a streaming message and marks the session busy', () => {
    const next = foldChatEvent(loadedState(), { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    expect(next.runtimeBySession.s1?.busy).toBe(true)
    expect(next.runtimeBySession.s1?.streaming).toEqual({ messageId: 'm1', content: '', reasoning: '', toolCalls: [] })
  })

  it('content_delta and reasoning_delta append to the matching streaming message', () => {
    let state = foldChatEvent(loadedState(), { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    state = foldChatEvent(state, { type: 'content_delta', sessionId: 's1', messageId: 'm1', delta: 'Hello' })
    state = foldChatEvent(state, { type: 'content_delta', sessionId: 's1', messageId: 'm1', delta: ' world' })
    state = foldChatEvent(state, { type: 'reasoning_delta', sessionId: 's1', messageId: 'm1', delta: 'thinking' })
    expect(state.runtimeBySession.s1?.streaming?.content).toBe('Hello world')
    expect(state.runtimeBySession.s1?.streaming?.reasoning).toBe('thinking')
  })

  it('ignores a delta for a message id that is not the current streaming message', () => {
    let state = foldChatEvent(loadedState(), { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    const before = state
    state = foldChatEvent(state, { type: 'content_delta', sessionId: 's1', messageId: 'stale', delta: 'x' })
    expect(state).toEqual(before)
  })

  it('tool_calls_proposed replaces the streaming message tool call list', () => {
    let state = foldChatEvent(loadedState(), { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    state = foldChatEvent(state, { type: 'tool_calls_proposed', sessionId: 's1', messageId: 'm1', toolCalls: [toolCall()] })
    expect(state.runtimeBySession.s1?.streaming?.toolCalls).toEqual([toolCall()])
  })

  it('tool_call_updated patches the streaming tool call and clears its pending approval', () => {
    let state = foldChatEvent(loadedState(), { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    state = foldChatEvent(state, { type: 'tool_calls_proposed', sessionId: 's1', messageId: 'm1', toolCalls: [toolCall()] })
    state = foldChatEvent(state, {
      type: 'tool_approval_requested',
      sessionId: 's1',
      messageId: 'm1',
      toolCallId: 'tc1',
      name: 'search_jobs',
      arguments: '{}'
    })
    expect(state.runtimeBySession.s1?.pendingApprovals).toHaveLength(1)

    const running = toolCall({ status: 'running' })
    state = foldChatEvent(state, { type: 'tool_call_updated', sessionId: 's1', messageId: 'm1', toolCall: running })
    expect(state.runtimeBySession.s1?.streaming?.toolCalls).toEqual([running])
    expect(state.runtimeBySession.s1?.pendingApprovals).toEqual([])
  })

  it('tool_call_updated also patches an already-persisted message holding that call', () => {
    let state = loadedState()
    state = {
      ...state,
      messagesBySession: {
        s1: { messages: [message({ toolCalls: [toolCall({ status: 'running' })] })], hasMore: false, loading: false, loadedOnce: true }
      }
    }
    const done = toolCall({ status: 'done', result: '"ok"', durationMs: 120 })
    state = foldChatEvent(state, { type: 'tool_call_updated', sessionId: 's1', messageId: 'm1', toolCall: done })
    expect(state.messagesBySession.s1?.messages[0]?.toolCalls).toEqual([done])
  })

  it('tool_approval_requested is idempotent for a repeated event', () => {
    let state = loadedState()
    const event: ChatStreamEvent = {
      type: 'tool_approval_requested',
      sessionId: 's1',
      messageId: 'm1',
      toolCallId: 'tc1',
      name: 'search_jobs',
      arguments: '{}'
    }
    state = foldChatEvent(state, event)
    state = foldChatEvent(state, event)
    expect(state.runtimeBySession.s1?.pendingApprovals).toHaveLength(1)
  })

  it('message_completed appends a new message, clears matching streaming/approvals', () => {
    let state = foldChatEvent(loadedState(), { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    state = foldChatEvent(state, {
      type: 'tool_approval_requested',
      sessionId: 's1',
      messageId: 'm1',
      toolCallId: 'tc1',
      name: 'search_jobs',
      arguments: '{}'
    })
    const finalMessage = message({ content: 'done', toolCalls: [toolCall({ status: 'done' })] })
    state = foldChatEvent(state, { type: 'message_completed', sessionId: 's1', message: finalMessage })
    expect(state.messagesBySession.s1?.messages).toEqual([finalMessage])
    expect(state.runtimeBySession.s1?.streaming).toBeNull()
    expect(state.runtimeBySession.s1?.pendingApprovals).toEqual([])
  })

  it('message_completed replaces rather than duplicates when the id repeats', () => {
    let state = loadedState()
    state = {
      ...state,
      messagesBySession: { s1: { messages: [message({ content: 'partial' })], hasMore: false, loading: false, loadedOnce: true } }
    }
    state = foldChatEvent(state, { type: 'message_completed', sessionId: 's1', message: message({ content: 'final' }) })
    expect(state.messagesBySession.s1?.messages).toHaveLength(1)
    expect(state.messagesBySession.s1?.messages[0]?.content).toBe('final')
  })

  it('turn_completed and turn_failed both clear busy and streaming', () => {
    let state = foldChatEvent(loadedState(), { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    state = foldChatEvent(state, { type: 'turn_completed', sessionId: 's1', usage: null })
    expect(state.runtimeBySession.s1?.busy).toBe(false)
    expect(state.runtimeBySession.s1?.streaming).toBeNull()

    state = foldChatEvent(state, { type: 'turn_started', sessionId: 's1', messageId: 'm2' })
    state = foldChatEvent(state, { type: 'turn_failed', sessionId: 's1', messageId: 'm2', error: { code: 'unexpected' } })
    expect(state.runtimeBySession.s1?.busy).toBe(false)
    expect(state.runtimeBySession.s1?.streaming).toBeNull()
  })

  it('turn_failed keeps the failure until the next turn starts', () => {
    let state = foldChatEvent(loadedState(), { type: 'turn_started', sessionId: 's1', messageId: 'm1' })
    state = foldChatEvent(state, { type: 'turn_failed', sessionId: 's1', messageId: null, error: { code: 'openrouterKeyRejected' } })
    expect(state.runtimeBySession.s1?.lastError).toEqual({ error: { code: 'openrouterKeyRejected' }, messageId: null })
    state = foldChatEvent(state, { type: 'turn_started', sessionId: 's1', messageId: 'm2' })
    expect(state.runtimeBySession.s1?.lastError).toBeNull()
    state = foldChatEvent(state, { type: 'turn_completed', sessionId: 's1', usage: null })
    expect(state.runtimeBySession.s1?.lastError).toBeNull()
  })
})

describe('message pagination', () => {
  it('applyInitialMessagesPage seeds the session slice', () => {
    const state = emptyChatFoldState()
    const next = applyInitialMessagesPage(state, 's1', { messages: [message()], hasMore: true })
    expect(next.messagesBySession.s1).toEqual({ messages: [message()], hasMore: true, loading: false, loadedOnce: true })
  })

  it('applyOlderMessagesPage prepends and dedupes by id', () => {
    let state = applyInitialMessagesPage(emptyChatFoldState(), 's1', { messages: [message({ id: 'm2' })], hasMore: true })
    state = applyOlderMessagesPage(state, 's1', { messages: [message({ id: 'm1' }), message({ id: 'm2' })], hasMore: false })
    expect(state.messagesBySession.s1?.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(state.messagesBySession.s1?.hasMore).toBe(false)
  })

  it('setSessionMessagesLoading toggles the flag without touching messages', () => {
    const state = applyInitialMessagesPage(emptyChatFoldState(), 's1', { messages: [message()], hasMore: false })
    const next = setSessionMessagesLoading(state, 's1', true)
    expect(next.messagesBySession.s1?.loading).toBe(true)
    expect(next.messagesBySession.s1?.messages).toEqual([message()])
  })

  it('appendLocalMessage adds an optimistic message once and is idempotent by id', () => {
    let state = applyInitialMessagesPage(emptyChatFoldState(), 's1', { messages: [], hasMore: false })
    const userMessage = message({ id: 'u1', role: 'user', content: 'hello' })
    state = appendLocalMessage(state, 's1', userMessage)
    state = appendLocalMessage(state, 's1', userMessage)
    expect(state.messagesBySession.s1?.messages).toEqual([userMessage])
  })
})

describe('applyPendingApprovals', () => {
  it('groups approvals by session and seeds runtimeBySession even for unloaded sessions', () => {
    const state = emptyChatFoldState()
    const next = applyPendingApprovals(state, [
      { sessionId: 's1', messageId: 'm1', toolCallId: 'tc1', name: 'search_jobs', arguments: '{}' },
      { sessionId: 's2', messageId: 'm2', toolCallId: 'tc2', name: 'queue_job', arguments: '{}' }
    ])
    expect(next.runtimeBySession.s1?.pendingApprovals).toHaveLength(1)
    expect(next.runtimeBySession.s2?.pendingApprovals).toHaveLength(1)
  })
})

describe('setSessions / removeSessionState', () => {
  it('setSessions replaces the whole list', () => {
    const next = setSessions(emptyChatFoldState(), [session()])
    expect(next.sessions).toEqual([session()])
  })

  it('removeSessionState drops the session and both its slices', () => {
    const state: ChatFoldState = {
      sessions: [session()],
      messagesBySession: { s1: { messages: [], hasMore: false, loading: false, loadedOnce: true } },
      runtimeBySession: { s1: { streaming: null, pendingApprovals: [], busy: false, lastError: null } }
    }
    const next = removeSessionState(state, 's1')
    expect(next.sessions).toEqual([])
    expect(next.messagesBySession.s1).toBeUndefined()
    expect(next.runtimeBySession.s1).toBeUndefined()
  })
})

describe('pickInitialSession', () => {
  it('picks the stored session id when it still exists', () => {
    expect(pickInitialSession([session({ id: 'a' }), session({ id: 'b' })], 'b')).toBe('b')
  })

  it('falls back to the first session when the stored id is gone or absent', () => {
    expect(pickInitialSession([session({ id: 'a' })], 'missing')).toBe('a')
    expect(pickInitialSession([session({ id: 'a' })], null)).toBe('a')
  })

  it('returns null when there are no sessions', () => {
    expect(pickInitialSession([], 'a')).toBeNull()
  })
})

describe('stored active session id', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips through localStorage', () => {
    writeStoredActiveSessionId('s1')
    expect(readStoredActiveSessionId()).toBe('s1')
  })

  it('removes the key when written null', () => {
    writeStoredActiveSessionId('s1')
    writeStoredActiveSessionId(null)
    expect(readStoredActiveSessionId()).toBeNull()
  })

  it('returns null when nothing is stored', () => {
    expect(readStoredActiveSessionId()).toBeNull()
  })
})
