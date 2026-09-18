import { describe, it, expect } from 'vitest'
import type { ChatSession } from '@shared/types/chat'
import type { OpenRouterModel } from '@shared/types/openrouter'
import { MODEL_MENU_PAGE, filterSessions, formatCost, modelMatches, relativeAge, shortModelName } from './chatPanelLogic'

function session(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 'id',
    title: 'Untitled',
    modelId: 'x/y',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    messageCount: 0,
    totalCostUsd: 0,
    busy: false,
    ...overrides
  }
}

function model(id: string, name = id): OpenRouterModel {
  return {
    id,
    name,
    description: '',
    contextLength: 8000,
    promptPricePerMillion: null,
    completionPricePerMillion: null,
    supportsTools: true,
    supportsReasoning: false,
    reasoningEfforts: [],
    inputModalities: ['text'],
    createdAt: null,
    isFree: false
  }
}

describe('filterSessions', () => {
  const sessions = [session({ id: 'a', title: 'Find backend jobs' }), session({ id: 'b', title: 'Tailor resume' })]

  it('keeps every session, in order, for a blank query', () => {
    expect(filterSessions(sessions, '   ').map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('matches the title case-insensitively', () => {
    expect(filterSessions(sessions, 'RESUME').map((s) => s.id)).toEqual(['b'])
    expect(filterSessions(sessions, 'nothing')).toEqual([])
  })
})

describe('shortModelName', () => {
  it('drops the vendor prefix but keeps a variant suffix', () => {
    expect(shortModelName('deepseek/deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(shortModelName('meta/llama:free')).toBe('llama:free')
  })

  it('leaves an id with no slash, or nothing after it, alone', () => {
    expect(shortModelName('gpt-5')).toBe('gpt-5')
    expect(shortModelName('vendor/')).toBe('vendor/')
  })
})

describe('formatCost', () => {
  it('shows four decimals under a cent and two otherwise', () => {
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.0012)).toBe('$0.0012')
    expect(formatCost(1.234)).toBe('$1.23')
  })

  it('returns an empty string for a non-finite value', () => {
    expect(formatCost(Number.NaN)).toBe('')
  })
})

describe('relativeAge', () => {
  const now = Date.parse('2026-09-16T12:00:00.000Z')

  it('picks the largest unit that fits, as a negative amount', () => {
    expect(relativeAge('2026-09-16T11:59:30.000Z', now)).toEqual({ unit: 'second', value: -30 })
    expect(relativeAge('2026-09-16T11:15:00.000Z', now)).toEqual({ unit: 'minute', value: -45 })
    expect(relativeAge('2026-09-16T03:00:00.000Z', now)).toEqual({ unit: 'hour', value: -9 })
    expect(relativeAge('2026-09-13T12:00:00.000Z', now)).toEqual({ unit: 'day', value: -3 })
  })

  it('clamps a future timestamp to now rather than saying "in 5 minutes"', () => {
    expect(relativeAge('2026-09-16T12:05:00.000Z', now)).toEqual({ unit: 'second', value: 0 })
  })

  it('returns null for an unparseable or month-old timestamp so the caller shows a date', () => {
    expect(relativeAge('not a date', now)).toBeNull()
    expect(relativeAge('2026-07-01T12:00:00.000Z', now)).toBeNull()
  })
})

describe('modelMatches', () => {
  it('caps the rows to one page and reports how many were left out', () => {
    const models = Array.from({ length: MODEL_MENU_PAGE + 5 }, (_, i) => model(`v/m${String(i).padStart(2, '0')}`))
    const result = modelMatches(models, '')
    expect(result.shown).toHaveLength(MODEL_MENU_PAGE)
    expect(result.hiddenCount).toBe(5)
  })

  it('filters by the query before capping', () => {
    const result = modelMatches([model('a/one', 'One'), model('b/two', 'Two')], 'tw')
    expect(result.shown.map((m) => m.id)).toEqual(['b/two'])
    expect(result.hiddenCount).toBe(0)
  })
})
