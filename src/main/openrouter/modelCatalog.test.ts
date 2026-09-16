import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { __resetElectronMock } from '../../../test/mocks/electron'
import { getModelCatalog, __resetModelCatalogCacheForTests } from './modelCatalog'
import type { OpenRouterModel } from '@shared/types/openrouter'

function model(id: string, name: string): OpenRouterModel {
  return {
    id,
    name,
    description: '',
    contextLength: 1000,
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

function modelsResponse(models: OpenRouterModel[]): Response {
  const raw = models.map((m) => ({
    id: m.id,
    name: m.name,
    context_length: m.contextLength,
    supported_parameters: m.supportsTools ? ['tools'] : []
  }))
  return new Response(JSON.stringify({ data: raw }), { status: 200 })
}

beforeEach(() => {
  __resetElectronMock()
  __resetModelCatalogCacheForTests()
})

describe('getModelCatalog', () => {
  it('fetches, sorts by name, and caches on first call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(modelsResponse([model('b/one', 'Bravo'), model('a/one', 'Alpha')]))
    const result = await getModelCatalog({}, fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.catalog.models.map((m) => m.name)).toEqual(['Alpha', 'Bravo'])
      expect(result.catalog.stale).toBe(false)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('serves from the in-memory cache on a second call without refetching', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(modelsResponse([model('a/one', 'Alpha')]))
    await getModelCatalog({}, fetchImpl)
    const second = await getModelCatalog({}, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(second.ok).toBe(true)
  })

  it('bypasses the cache when refresh is requested', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(modelsResponse([model('a/one', 'Alpha')]))
    await getModelCatalog({}, fetchImpl)
    await getModelCatalog({ refresh: true }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('writes an on-disk cache that a fresh process (cleared memory cache) can read back', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(modelsResponse([model('a/one', 'Alpha')]))
    await getModelCatalog({}, fetchImpl)

    const path = join(app.getPath('userData'), 'openrouter-models.json')
    expect(existsSync(path)).toBe(true)

    __resetModelCatalogCacheForTests()
    const fetchImpl2 = vi.fn()
    const result = await getModelCatalog({}, fetchImpl2)
    expect(fetchImpl2).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.catalog.models[0]?.id).toBe('a/one')
  })

  it('falls back to a cache marked stale when a refetch fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(modelsResponse([model('a/one', 'Alpha')]))
    await getModelCatalog({}, fetchImpl)

    const failing = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await getModelCatalog({ refresh: true }, failing)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.catalog.stale).toBe(true)
      expect(result.catalog.models[0]?.id).toBe('a/one')
    }
  })

  it('returns an error when there is no cache and the fetch fails', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await getModelCatalog({}, failing)
    expect(result.ok).toBe(false)
  })

  it('refetches automatically once the cache is past its TTL', async () => {
    const path = join(app.getPath('userData'), 'openrouter-models.json')
    const expired = {
      models: [model('old/one', 'Old')],
      fetchedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      stale: false
    }
    writeFileSync(path, JSON.stringify(expired), 'utf-8')

    const fetchImpl = vi.fn().mockResolvedValue(modelsResponse([model('new/one', 'New')]))
    const result = await getModelCatalog({}, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.catalog.models[0]?.id).toBe('new/one')
  })

  it('ignores a malformed on-disk cache rather than throwing', async () => {
    const path = join(app.getPath('userData'), 'openrouter-models.json')
    writeFileSync(path, '{not json', 'utf-8')

    const fetchImpl = vi.fn().mockResolvedValue(modelsResponse([model('a/one', 'Alpha')]))
    const result = await getModelCatalog({}, fetchImpl)
    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reads a fresh on-disk cache written by JSON.stringify verbatim', async () => {
    const path = join(app.getPath('userData'), 'openrouter-models.json')
    const fresh = { models: [model('a/one', 'Alpha')], fetchedAt: new Date().toISOString(), stale: false }
    writeFileSync(path, JSON.stringify(fresh), 'utf-8')

    const fetchImpl = vi.fn()
    const result = await getModelCatalog({}, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.catalog.models).toEqual(fresh.models)

    // Sanity: the file really is what we wrote, not silently rewritten.
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(fresh)
  })
})
