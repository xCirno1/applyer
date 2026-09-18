// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatSession } from '@shared/types/chat'

const listSessions = vi.fn()
const listPendingApprovals = vi.fn()
const listMessages = vi.fn()
const send = vi.fn()
const stop = vi.fn()
const respondToolApproval = vi.fn()
const createSession = vi.fn()
const renameSession = vi.fn()
const deleteSession = vi.fn()
const setSessionModel = vi.fn()
const eventHandlers: ((event: unknown) => void)[] = []

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

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  for (const mock of [
    listSessions,
    listPendingApprovals,
    listMessages,
    send,
    stop,
    respondToolApproval,
    createSession,
    renameSession,
    deleteSession,
    setSessionModel
  ]) {
    mock.mockReset()
  }
  listSessions.mockResolvedValue([])
  listPendingApprovals.mockResolvedValue([])
  listMessages.mockResolvedValue({ messages: [], hasMore: false })
  eventHandlers.length = 0
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      chat: {
        listSessions,
        listPendingApprovals,
        listMessages,
        send,
        stop,
        respondToolApproval,
        createSession,
        renameSession,
        deleteSession,
        setSessionModel,
        onEvent: (fn: (event: unknown) => void) => {
          eventHandlers.push(fn)
          return () => {
            const i = eventHandlers.indexOf(fn)
            if (i >= 0) eventHandlers.splice(i, 1)
          }
        }
      }
    }
  })
})

describe('chatStore', () => {
  it('loads sessions and auto-selects + fetches the first one', async () => {
    listSessions.mockResolvedValue([session()])
    listMessages.mockResolvedValue({ messages: [{ id: 'm1', sessionId: 's1', role: 'assistant', content: 'hi', reasoning: null, reasoningDetails: null, toolCalls: null, toolCallId: null, modelId: null, usage: null, error: null, createdAt: '2026-09-16T00:00:01.000Z' }], hasMore: false })
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    const state = useChatStore.getState()
    expect(state.sessions).toEqual([session()])
    expect(state.activeSessionId).toBe('s1')
    expect(state.messagesBySession.s1?.loadedOnce).toBe(true)
    expect(state.messagesBySession.s1?.messages).toHaveLength(1)
  })

  it('drops a malformed session from listSessions with a warning rather than crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    listSessions.mockResolvedValue([session(), { id: 'bad' }])
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    expect(useChatStore.getState().sessions).toEqual([session()])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('selectSession only fetches a session once', async () => {
    listSessions.mockResolvedValue([session()])
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    listMessages.mockClear()
    await useChatStore.getState().selectSession('s1')
    expect(listMessages).not.toHaveBeenCalled()
  })

  it('send() appends an optimistic user message on success', async () => {
    listSessions.mockResolvedValue([session()])
    send.mockResolvedValue({ ok: true, messageId: 'u1' })
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    const result = await useChatStore.getState().send('hello there')
    expect(result.ok).toBe(true)
    const messages = useChatStore.getState().messagesBySession.s1?.messages ?? []
    expect(messages.some((m) => m.id === 'u1' && m.role === 'user' && m.content === 'hello there')).toBe(true)
  })

  it('send() does nothing but report failure when there is no active session', async () => {
    const { useChatStore } = await import('./chatStore')
    const result = await useChatStore.getState().send('hello')
    expect(result.ok).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('folds a validated stream event and warns + drops a malformed one', async () => {
    listSessions.mockResolvedValue([session()])
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    useChatStore.getState().subscribe()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    eventHandlers.forEach((fn) => fn({ type: 'not_a_real_event' }))
    expect(warn).toHaveBeenCalled()
    expect(useChatStore.getState().runtimeBySession.s1?.busy).toBeFalsy()

    eventHandlers.forEach((fn) => fn({ type: 'turn_started', sessionId: 's1', messageId: 'm1' }))
    expect(useChatStore.getState().runtimeBySession.s1?.busy).toBe(true)
    warn.mockRestore()
  })

  it('createSession refuses past the session cap', async () => {
    const many = Array.from({ length: 12 }, (_, i) => session({ id: `s${i}` }))
    listSessions.mockResolvedValue(many)
    const { useChatStore, MAX_CHAT_SESSIONS } = await import('./chatStore')
    await useChatStore.getState().load()
    expect(useChatStore.getState().sessions).toHaveLength(MAX_CHAT_SESSIONS)
    const result = await useChatStore.getState().createSession()
    expect(result.ok).toBe(false)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('createSession lists the new session once even when its session_updated broadcast lands before the reply', async () => {
    const created = session({ id: 'new', title: 'New chat' })
    const { useChatStore } = await import('./chatStore')
    useChatStore.getState().subscribe()
    // subscribe() kicks off its own load(); let that settle so its (empty)
    // session list can't land on top of the created one.
    await new Promise((resolve) => setTimeout(resolve, 0))
    createSession.mockImplementation(async () => {
      // main broadcasts before its handler returns, so the event is folded
      // while the invoke is still pending.
      eventHandlers.forEach((fn) => fn({ type: 'session_updated', session: created }))
      return { ok: true, session: created }
    })
    const result = await useChatStore.getState().createSession()
    expect(result.ok).toBe(true)
    expect(useChatStore.getState().sessions.map((s) => s.id)).toEqual(['new'])
    expect(useChatStore.getState().activeSessionId).toBe('new')
  })

  it('deleteSession treats chatSessionNotFound as already gone rather than an error', async () => {
    listSessions.mockResolvedValue([session({ id: 's1' }), session({ id: 's2' })])
    deleteSession.mockResolvedValue({ ok: false, error: { code: 'chatSessionNotFound', params: {} } })
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    const result = await useChatStore.getState().deleteSession('s1')
    expect(result.ok).toBe(true)
    expect(useChatStore.getState().sessions.map((s) => s.id)).toEqual(['s2'])
    expect(useChatStore.getState().activeSessionId).toBe('s2')
  })

  it('send() drops a session main no longer knows and reloads the list', async () => {
    listSessions.mockResolvedValue([session({ id: 'stale' })])
    send.mockResolvedValue({ ok: false, error: { code: 'chatSessionNotFound', params: {} } })
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    listSessions.mockResolvedValue([session({ id: 'fresh' })])
    const result = await useChatStore.getState().send('hello')
    expect(result.ok).toBe(false)
    await vi.waitFor(() => expect(useChatStore.getState().sessions.map((s) => s.id)).toEqual(['fresh']))
    expect(useChatStore.getState().activeSessionId).toBe('fresh')
  })

  it('setSessionModel replaces the session in place with the reply', async () => {
    listSessions.mockResolvedValue([session({ id: 's1' })])
    setSessionModel.mockResolvedValue({ ok: true, session: session({ id: 's1', modelId: 'x/y' }) })
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    const result = await useChatStore.getState().setSessionModel('s1', 'x/y')
    expect(result.ok).toBe(true)
    expect(setSessionModel).toHaveBeenCalledWith('s1', 'x/y')
    expect(useChatStore.getState().sessions).toHaveLength(1)
    expect(useChatStore.getState().sessions[0]?.modelId).toBe('x/y')
    expect(useChatStore.getState().actingSessionIds.s1).toBeUndefined()
  })

  it('deleteSession removes the session and selects another when the active one is deleted', async () => {
    listSessions.mockResolvedValue([session({ id: 's1' }), session({ id: 's2' })])
    deleteSession.mockResolvedValue({ ok: true })
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    expect(useChatStore.getState().activeSessionId).toBe('s1')
    await useChatStore.getState().deleteSession('s1')
    expect(useChatStore.getState().sessions.map((s) => s.id)).toEqual(['s2'])
    expect(useChatStore.getState().activeSessionId).toBe('s2')
  })

  it('respondApproval targets the session that actually holds the pending call', async () => {
    listSessions.mockResolvedValue([session({ id: 's1' }), session({ id: 's2' })])
    listPendingApprovals.mockResolvedValue([{ sessionId: 's2', messageId: 'm1', toolCallId: 'tc1', name: 'queue_job', arguments: '{}' }])
    respondToolApproval.mockResolvedValue({ ok: true })
    const { useChatStore } = await import('./chatStore')
    await useChatStore.getState().load()
    // Active session is s1, but the approval belongs to s2.
    await useChatStore.getState().respondApproval('tc1', 'allow_once')
    expect(respondToolApproval).toHaveBeenCalledWith({ sessionId: 's2', toolCallId: 'tc1', decision: 'allow_once' })
  })
})
