import { describe, it, expect, vi } from 'vitest'
import { streamChatCompletion, type OpenAiMessage, type StreamChatRequest, type StreamChatHandlers, type StreamedToolCall } from './streamChat'

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[index]))
      index++
    }
  })
}

function sseResponse(chunks: string[], status = 200): Response {
  return new Response(streamFromChunks(chunks), { status })
}

function baseRequest(overrides: Partial<StreamChatRequest> = {}): StreamChatRequest {
  const messages: OpenAiMessage[] = [{ role: 'user', content: 'hello' }]
  return {
    apiKey: 'sk-abc',
    modelId: 'openai/gpt-5',
    messages,
    tools: [],
    reasoningEffort: 'default',
    ...overrides
  }
}

interface MockHandlers extends StreamChatHandlers {
  onContent: ReturnType<typeof vi.fn<(delta: string) => void>>
  onReasoning: ReturnType<typeof vi.fn<(delta: string) => void>>
  onToolCallUpdate: ReturnType<typeof vi.fn<(toolCalls: StreamedToolCall[]) => void>>
}

function noopHandlers(): MockHandlers {
  return {
    onContent: vi.fn<(delta: string) => void>(),
    onReasoning: vi.fn<(delta: string) => void>(),
    onToolCallUpdate: vi.fn<(toolCalls: StreamedToolCall[]) => void>()
  }
}

describe('streamChatCompletion: happy path content streaming', () => {
  it('accumulates content split across awkward chunk boundaries, including a mid-line split', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo, "}}]}\n\ndata: {"choices":[{"delta":{"content":"world!"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    ]
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const handlers = noopHandlers()
    const result = await streamChatCompletion(baseRequest(), handlers, { signal: new AbortController().signal, fetch: fetchImpl })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe('Hello, world!')
      expect(result.finishReason).toBe('stop')
    }
    // The split lands mid-JSON, inside a single logical SSE line, so the
    // parser must reconstruct one "Hello, " delta rather than emitting the
    // raw chunk halves as if they were separate events.
    expect(handlers.onContent).toHaveBeenCalledWith('Hello, ')
    expect(handlers.onContent).toHaveBeenCalledWith('world!')
    expect(handlers.onContent).toHaveBeenCalledTimes(2)
  })

  it('accumulates content when a multi-byte UTF-8 character is split across chunk boundaries', async () => {
    const full = 'data: {"choices":[{"delta":{"content":"café 😀"}}]}\n\ndata: [DONE]\n\n'
    const bytes = new TextEncoder().encode(full)
    // Split in the middle of the multi-byte emoji sequence.
    const splitPoint = bytes.length - 2
    const first = bytes.slice(0, splitPoint)
    const second = bytes.slice(splitPoint)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(first)
        controller.enqueue(second)
        controller.close()
      }
    })
    const fetchImpl = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toBe('café 😀')
  })

  it('skips keep-alive comment lines', async () => {
    const chunks = [': OPENROUTER PROCESSING\n\n', 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n']
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toBe('hi')
  })

  it('tolerates a missing [DONE] when the stream just ends after a finish_reason', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n']
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe('done')
      expect(result.finishReason).toBe('stop')
    }
  })

  it('handles a data: payload whose JSON body is itself split across chunks', async () => {
    const chunks = ['data: {"choices":[{"delta":{"conte', 'nt":"split"}}]}\n\n', 'data: [DONE]\n\n']
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toBe('split')
  })
})

describe('streamChatCompletion: reasoning', () => {
  it('streams reasoning deltas separately from content and reports reasoningDetails when present', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"reasoning":"thinking... "}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning":"more.","reasoning_details":[{"type":"a"}]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"answer","reasoning_details":[{"type":"b"}]}}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const handlers = noopHandlers()
    const result = await streamChatCompletion(baseRequest(), handlers, { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.reasoning).toBe('thinking... more.')
      expect(result.content).toBe('answer')
      expect(result.reasoningDetails).toEqual([{ type: 'a' }, { type: 'b' }])
    }
    expect(handlers.onReasoning).toHaveBeenCalledWith('thinking... ')
    expect(handlers.onReasoning).toHaveBeenCalledWith('more.')
  })

  it('reports reasoningDetails as null when the model never streams any', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n']
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reasoningDetails).toBeNull()
  })

  it('only sends a reasoning param when the effort is not "default"', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n']
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    await streamChatCompletion(baseRequest({ reasoningEffort: 'default' }), noopHandlers(), {
      signal: new AbortController().signal,
      fetch: fetchImpl
    })
    const bodyDefault = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string)
    expect(bodyDefault.reasoning).toBeUndefined()

    fetchImpl.mockClear()
    fetchImpl.mockResolvedValue(sseResponse(chunks))
    await streamChatCompletion(baseRequest({ reasoningEffort: 'high' }), noopHandlers(), {
      signal: new AbortController().signal,
      fetch: fetchImpl
    })
    const bodyHigh = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string)
    expect(bodyHigh.reasoning).toEqual({ effort: 'high' })
  })
})

describe('streamChatCompletion: tool calls', () => {
  it('merges tool call fragments by index and generates ids for calls missing one', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_real","function":{"name":"search_jobs","arguments":"{\\"q\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"eng\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"name":"queue_job","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
    ]
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const handlers = noopHandlers()
    const result = await streamChatCompletion(
      baseRequest({ tools: [{ type: 'function', function: { name: 'search_jobs', parameters: {} } }] }),
      handlers,
      { signal: new AbortController().signal, fetch: fetchImpl }
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.toolCalls).toEqual([
        { id: 'call_real', name: 'search_jobs', arguments: '{"q":"eng"}' },
        { id: 'call_0', name: 'queue_job', arguments: '{}' }
      ])
      expect(result.finishReason).toBe('tool_calls')
    }
    expect(handlers.onToolCallUpdate).toHaveBeenCalled()
  })

  it('sends tools and tool_choice only when at least one tool is provided', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n']
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    await streamChatCompletion(baseRequest({ tools: [] }), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    const bodyNoTools = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string)
    expect(bodyNoTools.tools).toBeUndefined()
    expect(bodyNoTools.tool_choice).toBeUndefined()

    fetchImpl.mockClear()
    fetchImpl.mockResolvedValue(sseResponse(chunks))
    await streamChatCompletion(
      baseRequest({ tools: [{ type: 'function', function: { name: 'x', parameters: {} } }] }),
      noopHandlers(),
      { signal: new AbortController().signal, fetch: fetchImpl }
    )
    const bodyWithTools = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string)
    expect(bodyWithTools.tools).toHaveLength(1)
    expect(bodyWithTools.tool_choice).toBe('auto')
  })
})

describe('streamChatCompletion: usage', () => {
  it('treats a usage frame appearing twice as an accounting frame, not a second terminal event, keeping the latest', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}],"usage":{"prompt_tokens":10,"completion_tokens":1}}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":10,"completion_tokens":2,"cost":0.001}}\n\n',
      'data: [DONE]\n\n'
    ]
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2, costUsd: 0.001 })
      expect(result.content).toBe('hi!')
    }
  })
})

describe('streamChatCompletion: failures', () => {
  it('terminates on a top-level error chunk', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"error":{"code":500,"message":"boom"},"choices":[{"finish_reason":"error"}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('openrouterRequestFailed')
      expect(result.partial.content).toBe('partial')
    }
  })

  it('fails when finish_reason is "error" with no explicit error payload', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"error"}]}\n\n', 'data: [DONE]\n\n']
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('openrouterProviderStreamError')
  })

  it('fails a 200 stream that produces no content, no tool calls and no explicit error', async () => {
    const chunks = ['data: {"choices":[{"delta":{}}]}\n\n', 'data: [DONE]\n\n']
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(chunks))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('openrouterStreamError')
  })

  it('maps a non-2xx response through the shared HTTP error mapping, naming the model on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 }))
    const result = await streamChatCompletion(baseRequest({ modelId: 'ghost/model' }), noopHandlers(), {
      signal: new AbortController().signal,
      fetch: fetchImpl
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('openrouterModelUnavailable')
      expect(result.error.params).toEqual({ modelId: 'ghost/model' })
    }
  })

  it('maps a 401 to openrouterKeyRejected', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('openrouterKeyRejected')
  })

  it('fails when the response has no body', async () => {
    const response = new Response(null, { status: 200 })
    const fetchImpl = vi.fn().mockResolvedValue(response)
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('openrouterStreamError')
  })
})

describe('streamChatCompletion: abort handling', () => {
  it('returns ok:false with aborted:true when the initial fetch rejects with an AbortError', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    const fetchImpl = vi.fn().mockRejectedValue(abortError)
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.aborted).toBe(true)
  })

  it('returns ok:false with aborted:true and the partial content when the stream is aborted mid-flight', async () => {
    let pulls = 0
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (pulls === 1) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'))
          return
        }
        controller.error(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
      }
    })
    const fetchImpl = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    const result = await streamChatCompletion(baseRequest(), noopHandlers(), { signal: new AbortController().signal, fetch: fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.aborted).toBe(true)
      expect(result.partial.content).toBe('Hel')
    }
  })
})
