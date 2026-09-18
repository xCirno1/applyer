import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPENROUTER_SETTINGS,
  DEFAULT_TOOL_APPROVAL_ASK_FOR,
  isOpenRouterAuthStatus,
  isOpenRouterModel,
  isOpenRouterSettings,
  isReasoningEffort,
  normalizeToolApproval,
  OPENROUTER_DEFAULT_MODEL_ID,
  parseOpenRouterSettings
} from './openrouter'
import type { OpenRouterModel, OpenRouterSettings } from './openrouter'

describe('OPENROUTER_DEFAULT_MODEL_ID', () => {
  it('matches the current default model', () => {
    expect(OPENROUTER_DEFAULT_MODEL_ID).toBe('deepseek/deepseek-v4.1-flash')
    expect(DEFAULT_OPENROUTER_SETTINGS.modelId).toBe('deepseek/deepseek-v4.1-flash')
  })
})

describe('isReasoningEffort', () => {
  it.each(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])('accepts %s', (effort) => {
    expect(isReasoningEffort(effort)).toBe(true)
  })

  it.each([undefined, null, '', 'extreme', 42])('rejects an unknown effort: %j', (effort) => {
    expect(isReasoningEffort(effort)).toBe(false)
  })
})

describe('normalizeToolApproval', () => {
  it('dedupes and trims tool names', () => {
    expect(normalizeToolApproval({ askFor: [' queue_job ', 'queue_job', 'exclude_job'] })).toEqual({
      askFor: ['queue_job', 'exclude_job']
    })
  })

  it('drops non-string and empty entries', () => {
    expect(normalizeToolApproval({ askFor: ['queue_job', 42, null, '   ', {}] })).toEqual({ askFor: ['queue_job'] })
  })

  it('preserves an intentional empty list rather than falling back to the default', () => {
    expect(normalizeToolApproval({ askFor: [] })).toEqual({ askFor: [] })
  })

  it('falls back to the default ask-for list when the value is entirely unreadable', () => {
    expect(normalizeToolApproval(null)).toEqual({ askFor: [...DEFAULT_TOOL_APPROVAL_ASK_FOR] })
    expect(normalizeToolApproval({})).toEqual({ askFor: [...DEFAULT_TOOL_APPROVAL_ASK_FOR] })
    expect(normalizeToolApproval({ askFor: 'queue_job' })).toEqual({ askFor: [...DEFAULT_TOOL_APPROVAL_ASK_FOR] })
  })

  it('caps the number of entries', () => {
    const many = Array.from({ length: 150 }, (_, i) => `tool_${i}`)
    expect(normalizeToolApproval({ askFor: many }).askFor.length).toBe(100)
  })
})

describe('isOpenRouterSettings', () => {
  it('accepts the defaults', () => {
    expect(isOpenRouterSettings(DEFAULT_OPENROUTER_SETTINGS)).toBe(true)
  })

  it.each([
    null,
    {},
    { ...DEFAULT_OPENROUTER_SETTINGS, modelId: '' },
    { ...DEFAULT_OPENROUTER_SETTINGS, reasoningEffort: 'extreme' },
    { ...DEFAULT_OPENROUTER_SETTINGS, toolApproval: { askFor: [1, 2] } },
    { ...DEFAULT_OPENROUTER_SETTINGS, toolApproval: null }
  ])('rejects malformed settings: %j', (value) => {
    expect(isOpenRouterSettings(value)).toBe(false)
  })
})

describe('parseOpenRouterSettings', () => {
  it('returns the defaults for entirely unreadable input', () => {
    expect(parseOpenRouterSettings(null)).toEqual(DEFAULT_OPENROUTER_SETTINGS)
    expect(parseOpenRouterSettings(undefined)).toEqual(DEFAULT_OPENROUTER_SETTINGS)
    expect(parseOpenRouterSettings('nonsense')).toEqual(DEFAULT_OPENROUTER_SETTINGS)
  })

  it('falls back field by field rather than discarding the whole record', () => {
    const partial = { modelId: 'openai/gpt-5', reasoningEffort: 'not-a-real-effort' }
    const result = parseOpenRouterSettings(partial)
    expect(result.modelId).toBe('openai/gpt-5')
    expect(result.reasoningEffort).toBe(DEFAULT_OPENROUTER_SETTINGS.reasoningEffort)
    expect(result.toolApproval).toEqual({ askFor: [...DEFAULT_TOOL_APPROVAL_ASK_FOR] })
  })

  it('round-trips a fully valid settings object', () => {
    const settings: OpenRouterSettings = {
      modelId: 'openai/gpt-5',
      reasoningEffort: 'high',
      toolApproval: { askFor: ['queue_job'] }
    }
    expect(parseOpenRouterSettings(settings)).toEqual(settings)
  })
})

const VALID_MODEL: OpenRouterModel = {
  id: 'openai/gpt-5',
  name: 'GPT-5',
  description: 'A model',
  contextLength: 128000,
  promptPricePerMillion: 5,
  completionPricePerMillion: 15,
  supportsTools: true,
  supportsReasoning: true,
  reasoningEfforts: ['default', 'low', 'high'],
  inputModalities: ['text', 'image'],
  createdAt: 1700000000,
  isFree: false
}

describe('isOpenRouterModel', () => {
  it('accepts a well-formed model', () => {
    expect(isOpenRouterModel(VALID_MODEL)).toBe(true)
  })

  it('accepts null pricing and createdAt', () => {
    expect(isOpenRouterModel({ ...VALID_MODEL, promptPricePerMillion: null, completionPricePerMillion: null, createdAt: null })).toBe(
      true
    )
  })

  it.each([
    null,
    {},
    { ...VALID_MODEL, id: '' },
    { ...VALID_MODEL, contextLength: 'a lot' },
    { ...VALID_MODEL, reasoningEfforts: ['default', 'extreme'] },
    { ...VALID_MODEL, inputModalities: [1, 2] },
    { ...VALID_MODEL, isFree: 'false' }
  ])('rejects malformed models: %j', (value) => {
    expect(isOpenRouterModel(value)).toBe(false)
  })
})

describe('isOpenRouterAuthStatus', () => {
  it('accepts every state variant', () => {
    expect(isOpenRouterAuthStatus({ state: 'idle' })).toBe(true)
    expect(isOpenRouterAuthStatus({ state: 'exchanging' })).toBe(true)
    expect(isOpenRouterAuthStatus({ state: 'connected' })).toBe(true)
    expect(
      isOpenRouterAuthStatus({ state: 'waiting', authUrl: 'https://openrouter.ai/auth', startedAt: '2026-01-01T00:00:00.000Z' })
    ).toBe(true)
    expect(isOpenRouterAuthStatus({ state: 'failed', error: { code: 'openrouterAuthFailed', params: { message: 'no' } } })).toBe(
      true
    )
  })

  it.each([
    null,
    {},
    { state: 'bogus' },
    { state: 'waiting', authUrl: '' },
    { state: 'waiting', authUrl: 'https://openrouter.ai/auth' },
    { state: 'failed' },
    { state: 'failed', error: 'boom' }
  ])('rejects malformed auth status: %j', (value) => {
    expect(isOpenRouterAuthStatus(value)).toBe(false)
  })
})
