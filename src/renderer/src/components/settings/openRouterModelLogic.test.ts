import { describe, it, expect } from 'vitest'
import {
  selectableReasoningEfforts,
  reconcileReasoningEffort,
  formatPricePerMillion,
  formatContextLength,
  matchesModelQuery,
  filterAndSortModels
} from './openRouterModelLogic'
import type { OpenRouterModel } from '@shared/types/openrouter'

function model(overrides: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id: 'vendor/model-a',
    name: 'Model A',
    description: '',
    contextLength: 128_000,
    promptPricePerMillion: 1,
    completionPricePerMillion: 2,
    supportsTools: true,
    supportsReasoning: false,
    reasoningEfforts: [],
    inputModalities: ['text'],
    createdAt: null,
    isFree: false,
    ...overrides
  }
}

describe('selectableReasoningEfforts', () => {
  it('always offers default, even with nothing else reported', () => {
    expect(selectableReasoningEfforts([])).toEqual(['default'])
    expect(selectableReasoningEfforts(undefined)).toEqual(['default'])
  })

  it('adds the model-reported efforts in canonical display order regardless of input order', () => {
    expect(selectableReasoningEfforts(['high', 'low', 'medium'])).toEqual(['default', 'low', 'medium', 'high'])
  })

  it('drops a stray "default" reported by a malformed catalog entry rather than doubling it', () => {
    expect(selectableReasoningEfforts(['default', 'low'])).toEqual(['default', 'low'])
  })
})

describe('reconcileReasoningEffort', () => {
  it('keeps the current effort when the new model still supports it', () => {
    expect(reconcileReasoningEffort('low', ['default', 'low', 'high'])).toBe('low')
  })

  it('falls back to default when the new model does not report the current effort', () => {
    expect(reconcileReasoningEffort('xhigh', ['default', 'low'])).toBe('default')
  })
})

describe('formatPricePerMillion', () => {
  it('formats a normal price to 2 decimals', () => {
    expect(formatPricePerMillion(1.5, 'en-US')).toBe('$1.50')
  })

  it('uses more decimals for very small per-token prices', () => {
    expect(formatPricePerMillion(0.0005, 'en-US')).toBe('$0.0005')
  })

  it('formats a free model price as $0.00', () => {
    expect(formatPricePerMillion(0, 'en-US')).toBe('$0.00')
  })

  it('returns null for unknown/variable pricing rather than a bogus number', () => {
    expect(formatPricePerMillion(null, 'en-US')).toBeNull()
  })

  it('returns null for a negative or non-finite price from a malformed catalog entry', () => {
    expect(formatPricePerMillion(-1, 'en-US')).toBeNull()
    expect(formatPricePerMillion(Number.NaN, 'en-US')).toBeNull()
  })
})

describe('formatContextLength', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatContextLength(8_000)).toBe('8K')
    expect(formatContextLength(128_000)).toBe('128K')
    expect(formatContextLength(1_000_000)).toBe('1M')
    expect(formatContextLength(1_500_000)).toBe('1.5M')
  })

  it('leaves small values as-is', () => {
    expect(formatContextLength(500)).toBe('500')
  })

  it('returns null for zero, negative, or non-finite lengths', () => {
    expect(formatContextLength(0)).toBeNull()
    expect(formatContextLength(-1)).toBeNull()
    expect(formatContextLength(Number.NaN)).toBeNull()
  })
})

describe('matchesModelQuery', () => {
  it('matches on name or id, case-insensitively', () => {
    const m = model({ id: 'anthropic/claude-x', name: 'Claude X' })
    expect(matchesModelQuery(m, 'claude')).toBe(true)
    expect(matchesModelQuery(m, 'ANTHROPIC')).toBe(true)
    expect(matchesModelQuery(m, 'gpt')).toBe(false)
  })

  it('matches everything for an empty or whitespace-only query', () => {
    const m = model()
    expect(matchesModelQuery(m, '')).toBe(true)
    expect(matchesModelQuery(m, '   ')).toBe(true)
  })
})

describe('filterAndSortModels', () => {
  it('filters by query then sorts by name', () => {
    const models = [
      model({ id: 'vendor/z-model', name: 'Zeta Model' }),
      model({ id: 'vendor/a-model', name: 'Alpha Model' }),
      model({ id: 'vendor/other', name: 'Something Else' })
    ]
    expect(filterAndSortModels(models, 'model').map((m) => m.name)).toEqual(['Alpha Model', 'Zeta Model'])
  })

  it('breaks name ties by id', () => {
    const models = [model({ id: 'b/dup', name: 'Dup' }), model({ id: 'a/dup', name: 'Dup' })]
    expect(filterAndSortModels(models, '').map((m) => m.id)).toEqual(['a/dup', 'b/dup'])
  })
})
