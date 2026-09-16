import { describe, it, expect, vi } from 'vitest'
import { sha256Hex } from './pkce'
import { fetchKeyInfo, fetchCredits, fetchModels, exchangeAuthCode, mapOpenRouterHttpError } from './api'

function jsonResponse(status: number, body: unknown, statusText = ''): Response {
  return new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } })
}

function textResponse(status: number, text: string): Response {
  return new Response(text, { status })
}

describe('mapOpenRouterHttpError', () => {
  it('maps 401 to a rejected key', () => {
    expect(mapOpenRouterHttpError(401, 'x').code).toBe('openrouterKeyRejected')
  })

  it('maps 402 to insufficient credits', () => {
    expect(mapOpenRouterHttpError(402, 'x').code).toBe('openrouterInsufficientCredits')
  })

  it('maps 429 to rate limited', () => {
    expect(mapOpenRouterHttpError(429, 'x').code).toBe('openrouterRateLimited')
  })

  it('maps 404 with a modelId to model unavailable', () => {
    const error = mapOpenRouterHttpError(404, 'not found', 'openai/gpt-5')
    expect(error.code).toBe('openrouterModelUnavailable')
    expect(error.params).toEqual({ modelId: 'openai/gpt-5' })
  })

  it('maps a model-flavoured 400 with a modelId to model unavailable', () => {
    const error = mapOpenRouterHttpError(400, 'model not found', 'openai/gpt-5')
    expect(error.code).toBe('openrouterModelUnavailable')
  })

  it('does not map 404/400 to model unavailable when no modelId is given', () => {
    expect(mapOpenRouterHttpError(404, 'not found').code).toBe('openrouterRequestFailed')
    expect(mapOpenRouterHttpError(400, 'model not found').code).toBe('openrouterRequestFailed')
  })

  it('maps a non-model 400 to request failed even with a modelId', () => {
    const error = mapOpenRouterHttpError(400, 'invalid request body', 'openai/gpt-5')
    expect(error.code).toBe('openrouterRequestFailed')
  })

  it('maps everything else to request failed with status and message', () => {
    const error = mapOpenRouterHttpError(500, 'server exploded')
    expect(error).toEqual({ code: 'openrouterRequestFailed', params: { status: 500, message: 'server exploded' } })
  })
})

describe('fetchKeyInfo', () => {
  it('returns the mapped key info on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { label: 'my key', limit: 10, usage: 2.5, is_free_tier: false } })
    )
    const result = await fetchKeyInfo('sk-abc', fetchImpl)
    expect(result).toEqual({
      ok: true,
      value: { label: 'my key', limit: 10, usage: 2.5, isFreeTier: false, keyHash: sha256Hex('sk-abc') }
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/auth/key',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-abc' }) })
    )
  })

  it('defaults optional fields when the server omits them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }))
    const result = await fetchKeyInfo('sk-abc', fetchImpl)
    expect(result).toEqual({
      ok: true,
      value: { label: null, limit: null, usage: 0, isFreeTier: false, keyHash: sha256Hex('sk-abc') }
    })
  })

  it('maps a 401 to openrouterKeyRejected', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(401, 'unauthorized'))
    const result = await fetchKeyInfo('sk-abc', fetchImpl)
    expect(result).toEqual({ ok: false, error: { code: 'openrouterKeyRejected' } })
  })

  it('fails on a malformed body (missing data)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { nonsense: true }))
    const result = await fetchKeyInfo('sk-abc', fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('openrouterRequestFailed')
  })

  it('fails on a body that is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(200, 'not json at all'))
    const result = await fetchKeyInfo('sk-abc', fetchImpl)
    expect(result.ok).toBe(false)
  })

  it('maps a thrown network error to openrouterRequestFailed', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const result = await fetchKeyInfo('sk-abc', fetchImpl)
    expect(result).toEqual({ ok: false, error: { code: 'openrouterRequestFailed', params: { status: 0, message: 'ECONNRESET' } } })
  })
})

describe('fetchCredits', () => {
  it('returns mapped credits on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: { total_credits: 100, total_usage: 40 } }))
    const result = await fetchCredits('sk-abc', fetchImpl)
    expect(result).toEqual({ ok: true, value: { totalCredits: 100, totalUsage: 40 } })
  })

  it('maps a 402 to insufficient credits', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(402, 'no credits'))
    const result = await fetchCredits('sk-abc', fetchImpl)
    expect(result).toEqual({ ok: false, error: { code: 'openrouterInsufficientCredits' } })
  })

  it('maps a 429 to rate limited', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(429, 'slow down'))
    const result = await fetchCredits('sk-abc', fetchImpl)
    expect(result).toEqual({ ok: false, error: { code: 'openrouterRateLimited' } })
  })

  it('fails on malformed numeric fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: { total_credits: 'lots', total_usage: 40 } }))
    const result = await fetchCredits('sk-abc', fetchImpl)
    expect(result.ok).toBe(false)
  })

  it('reads the error message from a JSON error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: 'internal server error' } }))
    const result = await fetchCredits('sk-abc', fetchImpl)
    expect(result).toEqual({
      ok: false,
      error: { code: 'openrouterRequestFailed', params: { status: 500, message: 'internal server error' } }
    })
  })
})

describe('fetchModels', () => {
  it('maps a well-formed model list, sends no Authorization header, and does not require it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: 'openai/gpt-5',
            name: 'GPT-5',
            description: 'A model',
            context_length: 128000,
            created: 1700000000,
            architecture: { input_modalities: ['text', 'image'] },
            pricing: { prompt: '0.000001', completion: '0.000002' },
            supported_parameters: ['tools', 'reasoning'],
            reasoning: { supported_efforts: ['low', 'high', 'not-a-real-effort'] }
          }
        ]
      })
    )
    const result = await fetchModels(fetchImpl)
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: 'openai/gpt-5',
          name: 'GPT-5',
          description: 'A model',
          contextLength: 128000,
          promptPricePerMillion: 1,
          completionPricePerMillion: 2,
          supportsTools: true,
          supportsReasoning: true,
          reasoningEfforts: ['low', 'high'],
          inputModalities: ['text', 'image'],
          createdAt: 1700000000,
          isFree: false
        }
      ]
    })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('marks a model with zero prompt and completion pricing as free', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [{ id: 'free/model', pricing: { prompt: '0', completion: '0' } }]
      })
    )
    const result = await fetchModels(fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value[0]?.isFree).toBe(true)
      expect(result.value[0]?.promptPricePerMillion).toBe(0)
    }
  })

  it('falls back sensibly when optional fields are missing entirely', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'bare/model' }] }))
    const result = await fetchModels(fetchImpl)
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: 'bare/model',
          name: 'bare/model',
          description: '',
          contextLength: 0,
          promptPricePerMillion: null,
          completionPricePerMillion: null,
          supportsTools: false,
          supportsReasoning: false,
          reasoningEfforts: [],
          inputModalities: [],
          createdAt: null,
          isFree: false
        }
      ]
    })
  })

  it('skips entries with no id and keeps the rest', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: [{ name: 'no id here' }, { id: 'has/id' }] })
    )
    const result = await fetchModels(fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(1)
      expect(result.value[0]?.id).toBe('has/id')
    }
  })

  it('fails when the whole response is not a data array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: 'not an array' }))
    const result = await fetchModels(fetchImpl)
    expect(result.ok).toBe(false)
  })
})

describe('exchangeAuthCode', () => {
  it('reports a 401 as a refused authorization code, not a rejected key (no key is sent on this call)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(401, 'unauthorized'))
    const result = await exchangeAuthCode({ code: 'stale', verifier: 'v' }, fetchImpl)
    expect(result).toEqual({ ok: false, error: { code: 'openrouterAuthFailed', params: { message: 'OpenRouter rejected the authorization code.' } } })
  })

  it('exchanges a code and verifier for a key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { key: 'sk-or-v1-newkey' }))
    const result = await exchangeAuthCode({ code: 'auth-code', verifier: 'the-verifier' }, fetchImpl)
    expect(result).toEqual({ ok: true, value: { key: 'sk-or-v1-newkey' } })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/auth/keys')
    expect(JSON.parse(init.body as string)).toEqual({
      code: 'auth-code',
      code_verifier: 'the-verifier',
      code_challenge_method: 'S256'
    })
  })

  it('fails on a malformed response missing the key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { nonsense: true }))
    const result = await exchangeAuthCode({ code: 'auth-code', verifier: 'v' }, fetchImpl)
    expect(result.ok).toBe(false)
  })

  it('propagates a mapped HTTP error for an invalid code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: 'invalid code' } }))
    const result = await exchangeAuthCode({ code: 'bad-code', verifier: 'v' }, fetchImpl)
    expect(result).toEqual({
      ok: false,
      error: { code: 'openrouterRequestFailed', params: { status: 400, message: 'invalid code' } }
    })
  })
})
