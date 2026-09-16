import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../testDb'
import { __resetElectronMock } from '../../../../test/mocks/electron'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
})

import {
  addChatSessionCost,
  countChatRows,
  createChatSession,
  deleteChatSession,
  getChatMessage,
  getChatSession,
  importChatSessions,
  insertChatMessage,
  listAllChatMessages,
  listAllChatSessionsForExport,
  listChatMessages,
  listMessagesWithActiveToolCalls,
  listChatSessions,
  renameChatSession,
  rewriteChatStorageMode,
  setChatSessionModel,
  touchChatSession,
  updateChatMessage
} from './chatRepository'
import { setStorageMode } from './settingsRepository'
import { chatMessages } from '../schema'
import type { ChatToolCall } from '@shared/types/chat'
import type { ExportChatSession } from '@shared/types/dataTransfer'

function baseMessageInput(
  sessionId: string,
  overrides: Partial<Parameters<typeof insertChatMessage>[0]> = {}
): Parameters<typeof insertChatMessage>[0] {
  return {
    sessionId,
    role: 'user' as const,
    content: 'hello',
    reasoning: null,
    reasoningDetails: null,
    toolCalls: null,
    toolCallId: null,
    modelId: null,
    usage: null,
    error: null,
    ...overrides
  }
}

async function tick(): Promise<void> {
  // updatedAt is millisecond ISO text; two writes in the same millisecond compare equal.
  await new Promise((resolve) => setTimeout(resolve, 2))
}

describe('chat sessions', () => {
  it('creates a session with a default title when none is given', () => {
    const session = createChatSession({ modelId: 'openai/gpt-5' })
    expect(session.title).toBe('New chat')
    expect(session.modelId).toBe('openai/gpt-5')
    expect(session.messageCount).toBe(0)
    expect(session.totalCostUsd).toBe(0)
    expect(session.busy).toBe(false)
    expect(getChatSession(session.id)).toEqual(session)
  })

  it('trims a given title and rejects one over the character limit', () => {
    const session = createChatSession({ title: '  Backend chat  ', modelId: 'm' })
    expect(session.title).toBe('Backend chat')
    expect(() => createChatSession({ title: 'x'.repeat(200), modelId: 'm' })).toThrow(/too long/)
  })

  it('lists sessions newest-updated first, with a grouped message count', async () => {
    const a = createChatSession({ title: 'A', modelId: 'm' })
    await tick()
    const b = createChatSession({ title: 'B', modelId: 'm' })
    insertChatMessage(baseMessageInput(a.id))
    insertChatMessage(baseMessageInput(a.id, { content: 'second' }))
    insertChatMessage(baseMessageInput(b.id))

    const listed = listChatSessions()
    expect(listed.map((s) => s.id)).toEqual([b.id, a.id])
    expect(listed.find((s) => s.id === a.id)?.messageCount).toBe(2)
    expect(listed.find((s) => s.id === b.id)?.messageCount).toBe(1)
  })

  it('renames a session, rejecting an over-long title without changing the stored one', () => {
    const session = createChatSession({ title: 'Original', modelId: 'm' })
    const renamed = renameChatSession(session.id, 'Renamed')
    expect(renamed?.title).toBe('Renamed')
    expect(() => renameChatSession(session.id, 'y'.repeat(200))).toThrow(/too long/)
    expect(getChatSession(session.id)?.title).toBe('Renamed')
    expect(renameChatSession('missing', 'X')).toBeNull()
  })

  it('touches updatedAt without changing anything else', async () => {
    const session = createChatSession({ title: 'A', modelId: 'm' })
    await tick()
    const touched = touchChatSession(session.id)
    expect(touched?.updatedAt).not.toBe(session.updatedAt)
    expect(touched?.title).toBe(session.title)
    expect(touchChatSession('missing')).toBeNull()
  })

  it('changes the model id', () => {
    const session = createChatSession({ title: 'A', modelId: 'm1' })
    const updated = setChatSessionModel(session.id, 'm2')
    expect(updated?.modelId).toBe('m2')
    expect(setChatSessionModel('missing', 'm2')).toBeNull()
  })

  it('accumulates cost across calls rather than replacing it', () => {
    const session = createChatSession({ title: 'A', modelId: 'm' })
    addChatSessionCost(session.id, 0.01)
    const after = addChatSessionCost(session.id, 0.02)
    expect(after?.totalCostUsd).toBeCloseTo(0.03)
    expect(addChatSessionCost('missing', 0.01)).toBeNull()
  })

  it('deletes a session and cascades to its messages', () => {
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const message = insertChatMessage(baseMessageInput(session.id))
    expect(deleteChatSession(session.id)).toBe(true)
    expect(getChatSession(session.id)).toBeNull()
    expect(getChatMessage(message.id)).toBeNull()
    expect(deleteChatSession(session.id)).toBe(false)
  })
})

describe('chat messages', () => {
  it('assigns monotonically increasing seq per session, independent of another session', () => {
    const a = createChatSession({ title: 'A', modelId: 'm' })
    const b = createChatSession({ title: 'B', modelId: 'm' })
    const a1 = insertChatMessage(baseMessageInput(a.id, { content: 'a1' }))
    const b1 = insertChatMessage(baseMessageInput(b.id, { content: 'b1' }))
    const a2 = insertChatMessage(baseMessageInput(a.id, { content: 'a2' }))

    const rowSeq = (id: string): number => testDb.select({ seq: chatMessages.seq }).from(chatMessages).where(eq(chatMessages.id, id)).get()!.seq
    expect(rowSeq(a1.id)).toBe(1)
    expect(rowSeq(a2.id)).toBe(2)
    expect(rowSeq(b1.id)).toBe(1)
  })

  it('accepts a caller-supplied id, for a streaming turn that announces its message id up front', () => {
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const message = insertChatMessage(baseMessageInput(session.id, { id: 'fixed-id' }))
    expect(message.id).toBe('fixed-id')
    expect(getChatMessage('fixed-id')?.content).toBe('hello')
  })

  it('round-trips secure fields under plaintext mode', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const toolCalls: ChatToolCall[] = [
      { id: 't1', name: 'search_jobs', arguments: '{}', status: 'done', result: 'ok', isError: false, durationMs: 12 }
    ]
    const message = insertChatMessage(
      baseMessageInput(session.id, {
        content: 'plain content',
        reasoning: 'thinking...',
        reasoningDetails: [{ type: 'text', text: 'because' }],
        toolCalls,
        usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.001 },
        error: null
      })
    )
    const row = testDb.select().from(chatMessages).where(eq(chatMessages.id, message.id)).get()!
    expect(row.content).toBe('plain content')
    expect(row.content).not.toMatch(/^enc:v1:/)

    const read = getChatMessage(message.id)!
    expect(read.content).toBe('plain content')
    expect(read.reasoning).toBe('thinking...')
    expect(read.reasoningDetails).toEqual([{ type: 'text', text: 'because' }])
    expect(read.toolCalls).toEqual(toolCalls)
    expect(read.usage).toEqual({ promptTokens: 10, completionTokens: 5, costUsd: 0.001 })
  })

  it('round-trips secure fields under encrypted mode, with the stored cell actually encrypted', () => {
    setStorageMode('encrypted')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const message = insertChatMessage(
      baseMessageInput(session.id, {
        content: 'secret content',
        reasoning: 'secret reasoning',
        toolCalls: [{ id: 't1', name: 'x', arguments: '{}', status: 'done', result: null, isError: false, durationMs: null }]
      })
    )
    const row = testDb.select().from(chatMessages).where(eq(chatMessages.id, message.id)).get()!
    expect(row.content).toMatch(/^enc:v1:/)
    expect(row.reasoning).toMatch(/^enc:v1:/)
    expect(row.toolCalls).toMatch(/^enc:v1:/)

    const read = getChatMessage(message.id)!
    expect(read.content).toBe('secret content')
    expect(read.reasoning).toBe('secret reasoning')
    expect(read.toolCalls?.[0]?.name).toBe('x')
  })

  it('treats a malformed toolCalls/reasoningDetails/usage/error cell as absent, with no throw', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const message = insertChatMessage(baseMessageInput(session.id))
    testDb
      .update(chatMessages)
      .set({ toolCalls: 'not json', reasoningDetails: 'also not json', usage: '{"promptTokens":"nope"}', error: 'nope' })
      .where(eq(chatMessages.id, message.id))
      .run()

    const read = getChatMessage(message.id)
    expect(read?.toolCalls).toBeNull()
    expect(read?.reasoningDetails).toBeNull()
    expect(read?.usage).toBeNull()
    expect(read?.error).toBeNull()
  })

  it('drops only the invalid entries of a mixed-validity toolCalls array', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const message = insertChatMessage(baseMessageInput(session.id))
    testDb
      .update(chatMessages)
      .set({ toolCalls: JSON.stringify([{ id: 't1', name: 'ok', arguments: '{}', status: 'done', result: null, isError: false, durationMs: null }, { garbage: true }]) })
      .where(eq(chatMessages.id, message.id))
      .run()

    const read = getChatMessage(message.id)
    expect(read?.toolCalls).toEqual([{ id: 't1', name: 'ok', arguments: '{}', status: 'done', result: null, isError: false, durationMs: null }])
  })

  it('falls back to "assistant" and logs a warning for an unrecognized role', () => {
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const message = insertChatMessage(baseMessageInput(session.id))
    // A hand-edited row could hold anything; simulate that past the column's own type.
    testDb
      .update(chatMessages)
      .set({ role: 'system' as unknown as 'user' | 'assistant' | 'tool' })
      .where(eq(chatMessages.id, message.id))
      .run()
    expect(getChatMessage(message.id)?.role).toBe('assistant')
  })

  it('patches only the given fields of updateChatMessage, leaving the rest untouched', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const message = insertChatMessage(baseMessageInput(session.id, { content: 'first', reasoning: 'r1' }))
    const updated = updateChatMessage(message.id, { content: 'second' })
    expect(updated?.content).toBe('second')
    expect(updated?.reasoning).toBe('r1')
    expect(updateChatMessage('missing', { content: 'x' })).toBeNull()
  })
})

describe('listChatMessages paging', () => {
  function seedMessages(sessionId: string, count: number): void {
    for (let i = 0; i < count; i++) {
      insertChatMessage(baseMessageInput(sessionId, { content: `m${i + 1}` }))
    }
  }

  it('returns the newest page ascending by seq when there is no "before"', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    seedMessages(session.id, 5)
    const page = listChatMessages({ sessionId: session.id, limit: 3 })
    expect(page.messages.map((m) => m.content)).toEqual(['m3', 'm4', 'm5'])
    expect(page.hasMore).toBe(true)
  })

  it('pages backwards strictly before the given message, and reports hasMore correctly at the boundary', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    seedMessages(session.id, 5)
    const first = listChatMessages({ sessionId: session.id, limit: 3 })
    const oldestOfFirst = first.messages[0]!
    const second = listChatMessages({ sessionId: session.id, before: oldestOfFirst.id, limit: 3 })
    expect(second.messages.map((m) => m.content)).toEqual(['m1', 'm2'])
    expect(second.hasMore).toBe(false)
  })

  it('clamps a limit above the page-size ceiling', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    seedMessages(session.id, 3)
    const page = listChatMessages({ sessionId: session.id, limit: 100000 })
    expect(page.messages).toHaveLength(3)
    expect(page.hasMore).toBe(false)
  })

  it('treats an unknown "before" id as no page, without throwing', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    seedMessages(session.id, 2)
    expect(listChatMessages({ sessionId: session.id, before: 'nonexistent' })).toEqual({ messages: [], hasMore: false })
  })

  it('lists everything for a session ascending via listAllChatMessages', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    seedMessages(session.id, 4)
    expect(listAllChatMessages(session.id).map((m) => m.content)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })
})

describe('listMessagesWithActiveToolCalls', () => {
  function toolCall(overrides: Partial<ChatToolCall> = {}): ChatToolCall {
    return {
      id: 'call1',
      name: 'queue_job',
      arguments: '{}',
      status: 'done',
      result: null,
      isError: false,
      durationMs: null,
      ...overrides
    }
  }

  it('finds an assistant message with a pending_approval or running tool call, across sessions', () => {
    setStorageMode('plaintext')
    const s1 = createChatSession({ title: 'A', modelId: 'm' })
    const s2 = createChatSession({ title: 'B', modelId: 'm' })
    insertChatMessage(baseMessageInput(s1.id, { role: 'assistant', toolCalls: [toolCall({ status: 'pending_approval' })] }))
    insertChatMessage(baseMessageInput(s2.id, { role: 'assistant', toolCalls: [toolCall({ status: 'running' })] }))

    const found = listMessagesWithActiveToolCalls()
    expect(found).toHaveLength(2)
    expect(new Set(found.map((m) => m.sessionId))).toEqual(new Set([s1.id, s2.id]))
  })

  it('ignores assistant messages whose tool calls already settled', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    insertChatMessage(baseMessageInput(session.id, { role: 'assistant', toolCalls: [toolCall({ status: 'done' })] }))
    insertChatMessage(baseMessageInput(session.id, { role: 'assistant', toolCalls: [toolCall({ status: 'cancelled' })] }))
    expect(listMessagesWithActiveToolCalls()).toEqual([])
  })

  it('ignores user/tool messages and assistant messages with no tool calls', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    insertChatMessage(baseMessageInput(session.id, { role: 'user' }))
    insertChatMessage(baseMessageInput(session.id, { role: 'assistant', toolCalls: null }))
    expect(listMessagesWithActiveToolCalls()).toEqual([])
  })
})

describe('rewriteChatStorageMode', () => {
  it('re-encrypts every secure column across every message, decodable afterwards under the new mode', () => {
    setStorageMode('plaintext')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const m1 = insertChatMessage(baseMessageInput(session.id, { content: 'one', reasoning: 'r1' }))
    const m2 = insertChatMessage(
      baseMessageInput(session.id, {
        content: 'two',
        toolCalls: [{ id: 't1', name: 'x', arguments: '{}', status: 'done', result: null, isError: false, durationMs: null }]
      })
    )

    rewriteChatStorageMode('encrypted')
    setStorageMode('encrypted')

    const row1 = testDb.select().from(chatMessages).where(eq(chatMessages.id, m1.id)).get()!
    expect(row1.content).toMatch(/^enc:v1:/)
    expect(getChatMessage(m1.id)?.content).toBe('one')
    expect(getChatMessage(m1.id)?.reasoning).toBe('r1')
    expect(getChatMessage(m2.id)?.toolCalls?.[0]?.name).toBe('x')
  })

  it('round-trips back to plaintext', () => {
    setStorageMode('encrypted')
    const session = createChatSession({ title: 'A', modelId: 'm' })
    const message = insertChatMessage(baseMessageInput(session.id, { content: 'secret' }))

    rewriteChatStorageMode('plaintext')
    setStorageMode('plaintext')

    const row = testDb.select().from(chatMessages).where(eq(chatMessages.id, message.id)).get()!
    expect(row.content).toBe('secret')
    expect(getChatMessage(message.id)?.content).toBe('secret')
  })
})

describe('export / import', () => {
  it('exports every session with its messages in order, oldest-touched last', async () => {
    setStorageMode('plaintext')
    const a = createChatSession({ title: 'A', modelId: 'm' })
    await tick()
    const b = createChatSession({ title: 'B', modelId: 'm' })
    insertChatMessage(baseMessageInput(a.id, { content: 'a1' }))
    insertChatMessage(baseMessageInput(a.id, { role: 'assistant', content: 'a2' }))
    insertChatMessage(baseMessageInput(b.id, { content: 'b1' }))

    const exported = listAllChatSessionsForExport()
    expect(exported.map((s) => s.title)).toEqual(['B', 'A'])
    const exportedA = exported.find((s) => s.title === 'A')!
    expect(exportedA.messages.map((m) => m.content)).toEqual(['a1', 'a2'])
  })

  it('imports sessions as fresh rows with sequential seq, summing cost from usage', () => {
    setStorageMode('plaintext')
    const bundle: ExportChatSession[] = [
      {
        title: 'Imported',
        modelId: 'm',
        createdAt: '2026-01-01T00:00:00.000Z',
        messages: [
          {
            role: 'user',
            content: 'hi',
            reasoning: null,
            toolCalls: null,
            toolCallId: null,
            modelId: null,
            usage: null,
            createdAt: '2026-01-01T00:00:00.000Z'
          },
          {
            role: 'assistant',
            content: 'hello there',
            reasoning: null,
            toolCalls: null,
            toolCallId: null,
            modelId: 'm',
            usage: { promptTokens: 5, completionTokens: 5, costUsd: 0.02 },
            createdAt: '2026-01-01T00:01:00.000Z'
          }
        ]
      }
    ]
    const imported = importChatSessions(bundle)
    expect(imported).toHaveLength(1)
    const sessions = listChatSessions()
    expect(imported[0]).toEqual(sessions[0])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.title).toBe('Imported')
    expect(sessions[0]?.totalCostUsd).toBeCloseTo(0.02)
    expect(listAllChatMessages(sessions[0]!.id).map((m) => m.content)).toEqual(['hi', 'hello there'])
  })

  it('skips a session with an invalid message role, without importing a partial session', () => {
    setStorageMode('plaintext')
    const bundle = [
      {
        title: 'Bad',
        modelId: 'm',
        createdAt: '2026-01-01T00:00:00.000Z',
        messages: [
          {
            role: 'not-a-role',
            content: 'hi',
            reasoning: null,
            toolCalls: null,
            toolCallId: null,
            modelId: null,
            usage: null,
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      }
    ] as unknown as ExportChatSession[]
    expect(importChatSessions(bundle)).toEqual([])
    expect(listChatSessions()).toHaveLength(0)
  })

  it('settles tool calls an export left pending or running as cancelled, so the transcript stays well-formed', () => {
    setStorageMode('plaintext')
    const call = (id: string, status: ChatToolCall['status']): ChatToolCall => ({
      id,
      name: 'queue_job',
      arguments: '{}',
      status,
      result: status === 'done' ? '{"ok":true}' : null,
      isError: false,
      durationMs: null
    })
    const bundle: ExportChatSession[] = [
      {
        title: 'Interrupted',
        modelId: 'm',
        createdAt: '2026-01-01T00:00:00.000Z',
        messages: [
          {
            role: 'assistant',
            content: '',
            reasoning: null,
            toolCalls: [call('c1', 'done'), call('c2', 'pending_approval'), call('c3', 'running'), call('c4', 'denied')],
            toolCallId: null,
            modelId: 'm',
            usage: null,
            createdAt: '2026-01-01T00:01:00.000Z'
          }
        ]
      }
    ]
    const [session] = importChatSessions(bundle)
    const [message] = listAllChatMessages(session!.id)
    expect(message?.toolCalls?.map((c) => c.status)).toEqual(['done', 'cancelled', 'cancelled', 'denied'])
  })
})

describe('countChatRows', () => {
  it('counts sessions and messages independently', () => {
    expect(countChatRows()).toEqual({ sessions: 0, messages: 0 })
    const session = createChatSession({ title: 'A', modelId: 'm' })
    insertChatMessage(baseMessageInput(session.id))
    insertChatMessage(baseMessageInput(session.id, { content: 'two' }))
    expect(countChatRows()).toEqual({ sessions: 1, messages: 2 })
  })
})
