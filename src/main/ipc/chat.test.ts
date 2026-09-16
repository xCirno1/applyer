import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { IPC } from '@shared/types/ipcEvents'
import { createTestDb } from '../db/testDb'
import { __invokeIpc, __resetElectronMock } from '../../../test/mocks/electron'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

const mocks = vi.hoisted(() => ({
  broadcastChatEvent: vi.fn(),
  sendChatMessage: vi.fn(),
  stopChatTurn: vi.fn(),
  respondToolApproval: vi.fn(),
  listPendingApprovals: vi.fn()
}))
vi.mock('./chatBroadcast', () => ({ broadcastChatEvent: mocks.broadcastChatEvent }))
vi.mock('../openrouter/agentRunner', () => ({
  sendChatMessage: mocks.sendChatMessage,
  stopChatTurn: mocks.stopChatTurn,
  respondToolApproval: mocks.respondToolApproval
}))
vi.mock('../openrouter/toolApprovalGate', () => ({ listPendingApprovals: mocks.listPendingApprovals }))

import { registerChatIpc } from './chat'
import { insertChatMessage, listAllChatMessages } from '../db/repositories/chatRepository'
import { busySessionIds, markSessionBusy, markSessionIdle } from '../openrouter/sessionActivity'
import { setStorageMode } from '../db/repositories/settingsRepository'
import type { ChatSession, ListChatMessagesResult } from '@shared/types/chat'

let registered = false

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
  setStorageMode('plaintext')
  mocks.broadcastChatEvent.mockReset()
  mocks.sendChatMessage.mockReset()
  mocks.stopChatTurn.mockReset()
  mocks.respondToolApproval.mockReset()
  mocks.listPendingApprovals.mockReset()
  // sessionActivity's Set is module-scoped state, shared across every test
  // in this file (it isn't mocked), clear it so a test that forgot to
  // mark itself idle can't leak "busy" into the next one.
  for (const id of busySessionIds()) markSessionIdle(id)
  registerChatIpc()
  registered = true
})

describe('chat IPC', () => {
  it('lists sessions newest-first with the busy overlay from sessionActivity', () => {
    expect(registered).toBe(true)
    const first = (__invokeIpc(IPC.chat.createSession, { title: 'First' }) as { ok: true; session: ChatSession }).session
    const second = (__invokeIpc(IPC.chat.createSession, { title: 'Second' }) as { ok: true; session: ChatSession }).session

    markSessionBusy(first.id)
    const sessions = __invokeIpc(IPC.chat.listSessions) as ChatSession[]
    expect(sessions.map((s) => s.id)).toEqual([second.id, first.id])
    expect(sessions.find((s) => s.id === first.id)?.busy).toBe(true)
    expect(sessions.find((s) => s.id === second.id)?.busy).toBe(false)
    markSessionIdle(first.id)
  })

  it('creates a session, defaulting an empty title and broadcasting session_updated', () => {
    const result = __invokeIpc(IPC.chat.createSession, {}) as { ok: true; session: ChatSession }
    expect(result.ok).toBe(true)
    expect(result.session.title).toBe('New chat')
    expect(result.session.busy).toBe(false)
    expect(mocks.broadcastChatEvent).toHaveBeenCalledWith({ type: 'session_updated', session: expect.objectContaining({ id: result.session.id }) })
  })

  it('rejects a title over the character limit on create', () => {
    const tooLong = 'x'.repeat(200)
    const result = __invokeIpc(IPC.chat.createSession, { title: tooLong }) as { ok: false; error: { code: string } }
    expect(result).toMatchObject({ ok: false, error: { code: 'chatTitleTooLong' } })
  })

  it('renames an existing session and reports chatSessionNotFound for an unknown one', () => {
    const created = (__invokeIpc(IPC.chat.createSession, { title: 'Original' }) as { ok: true; session: ChatSession }).session
    mocks.broadcastChatEvent.mockClear()
    const renamed = __invokeIpc(IPC.chat.renameSession, { sessionId: created.id, title: 'Renamed' }) as {
      ok: true
      session: ChatSession
    }
    expect(renamed.session.title).toBe('Renamed')
    expect(mocks.broadcastChatEvent).toHaveBeenCalledWith({ type: 'session_updated', session: expect.objectContaining({ title: 'Renamed' }) })

    expect(__invokeIpc(IPC.chat.renameSession, { sessionId: 'missing', title: 'X' })).toMatchObject({
      ok: false,
      error: { code: 'chatSessionNotFound' }
    })

    const tooLong = __invokeIpc(IPC.chat.renameSession, { sessionId: created.id, title: 'y'.repeat(200) }) as {
      ok: false
      error: { code: string }
    }
    expect(tooLong).toMatchObject({ ok: false, error: { code: 'chatTitleTooLong' } })
  })

  it('deletes a session, broadcasting session_deleted', () => {
    const created = (__invokeIpc(IPC.chat.createSession, { title: 'Doomed' }) as { ok: true; session: ChatSession }).session
    mocks.broadcastChatEvent.mockClear()
    expect(__invokeIpc(IPC.chat.deleteSession, { sessionId: created.id })).toEqual({ ok: true })
    expect(mocks.broadcastChatEvent).toHaveBeenCalledWith({ type: 'session_deleted', sessionId: created.id })
    expect(__invokeIpc(IPC.chat.deleteSession, { sessionId: created.id })).toMatchObject({
      ok: false,
      error: { code: 'chatSessionNotFound' }
    })
  })

  it('pins a session to another model, broadcasting session_updated, and refuses while it is busy', () => {
    const created = (__invokeIpc(IPC.chat.createSession, { title: 'Switch' }) as { ok: true; session: ChatSession }).session
    mocks.broadcastChatEvent.mockClear()
    const result = __invokeIpc(IPC.chat.setSessionModel, { sessionId: created.id, modelId: 'openai/gpt-5' }) as {
      ok: true
      session: ChatSession
    }
    expect(result.ok).toBe(true)
    expect(result.session.modelId).toBe('openai/gpt-5')
    expect(mocks.broadcastChatEvent).toHaveBeenCalledWith({
      type: 'session_updated',
      session: expect.objectContaining({ id: created.id, modelId: 'openai/gpt-5' })
    })
    expect((__invokeIpc(IPC.chat.listSessions) as ChatSession[]).find((s) => s.id === created.id)?.modelId).toBe('openai/gpt-5')

    markSessionBusy(created.id)
    expect(__invokeIpc(IPC.chat.setSessionModel, { sessionId: created.id, modelId: 'x/y' })).toMatchObject({
      ok: false,
      error: { code: 'chatSessionBusy' }
    })
    markSessionIdle(created.id)
  })

  it('rejects a bad model id or unknown session on setSessionModel without touching the row', () => {
    const created = (__invokeIpc(IPC.chat.createSession, { title: 'Keep' }) as { ok: true; session: ChatSession }).session
    expect(__invokeIpc(IPC.chat.setSessionModel, { sessionId: created.id, modelId: '' })).toMatchObject({
      ok: false,
      error: { code: 'invalidOpenRouterSettings' }
    })
    expect(__invokeIpc(IPC.chat.setSessionModel, { sessionId: created.id, modelId: 'a'.repeat(201) })).toMatchObject({
      ok: false,
      error: { code: 'invalidOpenRouterSettings' }
    })
    expect(__invokeIpc(IPC.chat.setSessionModel, { sessionId: 'nope', modelId: 'openai/gpt-5' })).toMatchObject({
      ok: false,
      error: { code: 'chatSessionNotFound' }
    })
    expect((__invokeIpc(IPC.chat.listSessions) as ChatSession[]).find((s) => s.id === created.id)?.modelId).toBe(created.modelId)
  })

  it('refuses to delete a session that is busy', () => {
    const created = (__invokeIpc(IPC.chat.createSession, { title: 'Running' }) as { ok: true; session: ChatSession }).session
    markSessionBusy(created.id)
    expect(__invokeIpc(IPC.chat.deleteSession, { sessionId: created.id })).toMatchObject({
      ok: false,
      error: { code: 'chatSessionBusy' }
    })
    markSessionIdle(created.id)
    expect(__invokeIpc(IPC.chat.deleteSession, { sessionId: created.id })).toEqual({ ok: true })
  })

  it('lists messages for a session, and returns an empty page for an unknown or missing session id', () => {
    const created = (__invokeIpc(IPC.chat.createSession, { title: 'Chatty' }) as { ok: true; session: ChatSession }).session
    insertChatMessage({
      sessionId: created.id,
      role: 'user',
      content: 'hello',
      reasoning: null,
      reasoningDetails: null,
      toolCalls: null,
      toolCallId: null,
      modelId: null,
      usage: null,
      error: null
    })

    const page = __invokeIpc(IPC.chat.listMessages, { sessionId: created.id }) as ListChatMessagesResult
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0]?.content).toBe('hello')
    expect(page.hasMore).toBe(false)

    expect(__invokeIpc(IPC.chat.listMessages, {})).toEqual({ messages: [], hasMore: false })
    expect(__invokeIpc(IPC.chat.listMessages, { sessionId: 'unknown-session' })).toEqual({ messages: [], hasMore: false })
    expect(listAllChatMessages(created.id)).toHaveLength(1)
  })
})

describe('chat IPC: running a turn', () => {
  it('send delegates to the agent runner with the validated payload', async () => {
    mocks.sendChatMessage.mockResolvedValue({ ok: true, messageId: 'm1' })
    const result = await __invokeIpc(IPC.chat.send, { sessionId: 's1', text: 'hello' })
    expect(mocks.sendChatMessage).toHaveBeenCalledWith('s1', 'hello')
    expect(result).toEqual({ ok: true, messageId: 'm1' })
  })

  it('send rejects a malformed payload without calling the runner', async () => {
    const result = await __invokeIpc(IPC.chat.send, { sessionId: 's1' })
    expect(mocks.sendChatMessage).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: { code: 'chatSessionNotFound' } })
  })

  it('send turns an unexpected throw from the runner into an unexpected error, not a crash', async () => {
    mocks.sendChatMessage.mockRejectedValue(new Error('boom'))
    const result = await __invokeIpc(IPC.chat.send, { sessionId: 's1', text: 'hello' })
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } })
  })

  it('stop delegates to the agent runner', () => {
    mocks.stopChatTurn.mockReturnValue({ ok: true })
    const result = __invokeIpc(IPC.chat.stop, { sessionId: 's1' })
    expect(mocks.stopChatTurn).toHaveBeenCalledWith('s1')
    expect(result).toEqual({ ok: true })
  })

  it('stop rejects a payload with no sessionId', () => {
    const result = __invokeIpc(IPC.chat.stop, {})
    expect(mocks.stopChatTurn).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: { code: 'chatSessionNotFound' } })
  })

  it('respondToolApproval validates the decision before delegating', () => {
    mocks.respondToolApproval.mockReturnValue({ ok: true })
    const result = __invokeIpc(IPC.chat.respondToolApproval, { sessionId: 's1', toolCallId: 'c1', decision: 'allow_once' })
    expect(mocks.respondToolApproval).toHaveBeenCalledWith('s1', 'c1', 'allow_once')
    expect(result).toEqual({ ok: true })
  })

  it('respondToolApproval rejects an invalid decision without delegating', () => {
    const result = __invokeIpc(IPC.chat.respondToolApproval, { sessionId: 's1', toolCallId: 'c1', decision: 'maybe' })
    expect(mocks.respondToolApproval).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: { code: 'chatToolApprovalNotWaiting' } })
  })

  it('listPendingApprovals passes through the gate\'s list', () => {
    const pending = [{ sessionId: 's1', messageId: 'm1', toolCallId: 'c1', name: 'queue_job', arguments: '{}' }]
    mocks.listPendingApprovals.mockReturnValue(pending)
    expect(__invokeIpc(IPC.chat.listPendingApprovals)).toEqual(pending)
  })
})
