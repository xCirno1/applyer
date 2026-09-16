import { describe, it, expect } from 'vitest'
import { buildModelMessages, MAX_TOOL_RESULT_CHARS } from './contextWindow'
import type { ChatMessage, ChatToolCall } from '@shared/types/chat'

let seq = 0
function msg(overrides: Partial<ChatMessage>): ChatMessage {
  seq += 1
  return {
    id: `m${seq}`,
    sessionId: 's1',
    role: 'user',
    content: '',
    reasoning: null,
    reasoningDetails: null,
    toolCalls: null,
    toolCallId: null,
    modelId: null,
    usage: null,
    error: null,
    createdAt: new Date().toISOString(),
    ...overrides
  }
}

function toolCall(overrides: Partial<ChatToolCall>): ChatToolCall {
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

const DEFAULT_OPTS = { systemPrompt: 'SYSTEM', contextLength: 100000, reserveTokens: 1000 }

describe('buildModelMessages: basic mapping', () => {
  it('puts the system prompt first', () => {
    const result = buildModelMessages([], DEFAULT_OPTS)
    expect(result).toEqual([{ role: 'system', content: 'SYSTEM' }])
  })

  it('maps a user message straight through', () => {
    const result = buildModelMessages([msg({ role: 'user', content: 'hello' })], DEFAULT_OPTS)
    expect(result[1]).toEqual({ role: 'user', content: 'hello' })
  })

  it('maps an assistant message with tool calls and reasoning details', () => {
    const assistant = msg({
      role: 'assistant',
      content: 'thinking...',
      reasoningDetails: [{ type: 'text', text: 'reasoning blob' }],
      toolCalls: [toolCall({ id: 'call1', name: 'search_jobs', arguments: '{"query":"backend"}' })]
    })
    const result = buildModelMessages([msg({ role: 'user', content: 'find jobs' }), assistant], DEFAULT_OPTS)
    expect(result[2]).toEqual({
      role: 'assistant',
      content: 'thinking...',
      tool_calls: [{ id: 'call1', type: 'function', function: { name: 'search_jobs', arguments: '{"query":"backend"}' } }],
      reasoning_details: [{ type: 'text', text: 'reasoning blob' }]
    })
  })

  it('maps an assistant message with no tool calls and no reasoning without those keys at all', () => {
    const result = buildModelMessages([msg({ role: 'assistant', content: 'hi there' })], DEFAULT_OPTS)
    expect(result[1]).toEqual({ role: 'assistant', content: 'hi there' })
    expect(result[1]).not.toHaveProperty('tool_calls')
    expect(result[1]).not.toHaveProperty('reasoning_details')
  })

  it('maps a tool message with its tool_call_id', () => {
    const result = buildModelMessages(
      [msg({ role: 'tool', content: '{"ok":true}', toolCallId: 'call1' })],
      DEFAULT_OPTS
    )
    expect(result[1]).toEqual({ role: 'tool', content: '{"ok":true}', tool_call_id: 'call1' })
  })
})

describe('buildModelMessages: denied/cancelled synthesis', () => {
  it('synthesizes a tool message for a denied call with no stored tool message', () => {
    const assistant = msg({
      role: 'assistant',
      content: '',
      toolCalls: [toolCall({ id: 'call1', status: 'denied' })]
    })
    const result = buildModelMessages([msg({ role: 'user', content: 'go' }), assistant], DEFAULT_OPTS)
    expect(result).toHaveLength(4)
    expect(result[3]).toEqual({ role: 'tool', content: JSON.stringify({ error: 'denied by user' }), tool_call_id: 'call1' })
  })

  it('synthesizes a tool message for a cancelled call the same way', () => {
    const assistant = msg({ role: 'assistant', content: '', toolCalls: [toolCall({ id: 'call1', status: 'cancelled' })] })
    const result = buildModelMessages([msg({ role: 'user', content: 'go' }), assistant], DEFAULT_OPTS)
    expect(result[3]).toMatchObject({ role: 'tool', tool_call_id: 'call1' })
    expect(JSON.parse((result[3] as { content: string }).content)).toEqual({ error: 'denied by user' })
  })

  it('does not synthesize when a real tool message for that call already exists', () => {
    const assistant = msg({ role: 'assistant', content: '', toolCalls: [toolCall({ id: 'call1', status: 'denied' })] })
    const realTool = msg({ role: 'tool', content: '{"error":"The user denied this tool call."}', toolCallId: 'call1' })
    const result = buildModelMessages([msg({ role: 'user', content: 'go' }), assistant, realTool], DEFAULT_OPTS)
    expect(result).toHaveLength(4)
    expect(result[3]).toEqual({ role: 'tool', content: '{"error":"The user denied this tool call."}', tool_call_id: 'call1' })
  })

  it('does not synthesize for a done/error call missing a tool message (only denied/cancelled trigger it)', () => {
    const assistant = msg({ role: 'assistant', content: '', toolCalls: [toolCall({ id: 'call1', status: 'running' })] })
    const result = buildModelMessages([msg({ role: 'user', content: 'go' }), assistant], DEFAULT_OPTS)
    expect(result).toHaveLength(3)
  })

  it('synthesizes independently for multiple unanswered calls on the same assistant message, in tool_calls order', () => {
    const assistant = msg({
      role: 'assistant',
      content: '',
      toolCalls: [toolCall({ id: 'call1', status: 'denied' }), toolCall({ id: 'call2', status: 'cancelled' })]
    })
    const result = buildModelMessages([msg({ role: 'user', content: 'go' }), assistant], DEFAULT_OPTS)
    expect(result).toHaveLength(5)
    expect((result[3] as { tool_call_id: string }).tool_call_id).toBe('call1')
    expect((result[4] as { tool_call_id: string }).tool_call_id).toBe('call2')
  })
})

describe('buildModelMessages: tool result truncation', () => {
  it('leaves a short tool result untouched', () => {
    const result = buildModelMessages([msg({ role: 'tool', content: 'short', toolCallId: 'call1' })], DEFAULT_OPTS)
    expect((result[1] as { content: string }).content).toBe('short')
  })

  it('truncates a tool result over the limit and appends a note', () => {
    const long = 'x'.repeat(MAX_TOOL_RESULT_CHARS + 500)
    const result = buildModelMessages([msg({ role: 'tool', content: long, toolCallId: 'call1' })], DEFAULT_OPTS)
    const content = (result[1] as { content: string }).content
    expect(content.length).toBeLessThan(long.length)
    expect(content.startsWith('x'.repeat(MAX_TOOL_RESULT_CHARS))).toBe(true)
    expect(content).toContain('500 more characters truncated')
  })

  it('never truncates a result exactly at the limit', () => {
    const exact = 'y'.repeat(MAX_TOOL_RESULT_CHARS)
    const result = buildModelMessages([msg({ role: 'tool', content: exact, toolCallId: 'call1' })], DEFAULT_OPTS)
    expect((result[1] as { content: string }).content).toBe(exact)
  })
})

describe('buildModelMessages: trimming from the oldest complete turn', () => {
  it('keeps every turn when the budget is generous', () => {
    const history = [
      msg({ role: 'user', content: 'first' }),
      msg({ role: 'assistant', content: 'first reply' }),
      msg({ role: 'user', content: 'second' }),
      msg({ role: 'assistant', content: 'second reply' })
    ]
    const result = buildModelMessages(history, DEFAULT_OPTS)
    expect(result).toHaveLength(5)
  })

  it('drops the oldest turn first when over budget, keeping the newest turn intact', () => {
    const bigContent = 'x'.repeat(4000) // ~1000 tokens
    const history = [
      msg({ role: 'user', content: bigContent }),
      msg({ role: 'assistant', content: bigContent }),
      msg({ role: 'user', content: 'recent question' }),
      msg({ role: 'assistant', content: 'recent reply' })
    ]
    // Budget just big enough for the system prompt + the newest turn, not the oldest.
    const result = buildModelMessages(history, { systemPrompt: 'SYS', contextLength: 520, reserveTokens: 0 })
    const roles = result.map((m) => (m as { role: string; content?: string }).content)
    expect(roles).not.toContain(bigContent)
    expect(roles).toContain('recent question')
    expect(roles).toContain('recent reply')
  })

  it('never drops the newest turn even when it alone is over budget', () => {
    const bigContent = 'z'.repeat(8000)
    const history = [msg({ role: 'user', content: bigContent })]
    const result = buildModelMessages(history, { systemPrompt: 'SYS', contextLength: 10, reserveTokens: 0 })
    expect(result).toHaveLength(2)
    expect((result[1] as { content: string }).content).toBe(bigContent)
  })

  it('treats a full multi-message exchange (several assistant/tool messages before the next user message) as one turn', () => {
    const bigContent = 'x'.repeat(4000)
    const oldTurn = [
      msg({ role: 'user', content: bigContent }),
      msg({ role: 'assistant', content: '', toolCalls: [toolCall({ id: 'call1' })] }),
      msg({ role: 'tool', content: 'result', toolCallId: 'call1' }),
      msg({ role: 'assistant', content: bigContent })
    ]
    const newTurn = [msg({ role: 'user', content: 'new question' }), msg({ role: 'assistant', content: 'new reply' })]
    const result = buildModelMessages([...oldTurn, ...newTurn], { systemPrompt: 'SYS', contextLength: 520, reserveTokens: 0 })
    // The whole old turn (all 4 messages) is dropped together, not partially.
    expect(result).toHaveLength(3)
    expect((result[1] as { content: string }).content).toBe('new question')
  })
})
