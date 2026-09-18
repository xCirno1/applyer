import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppError } from '@shared/types/errorCodes'
import { isOpenRouterModel, type OpenRouterModel, type OpenRouterModelCatalog } from '@shared/types/openrouter'
import { appLogger } from '../logger'
import { fetchModels, type FetchLike } from './api'

/**
 * OpenRouter's model list rarely changes minute to minute, and the model
 * picker in Settings/the chat composer wants to open instantly rather than
 * wait on a network round trip every time. So the mapped list is cached in
 * memory for the process lifetime and mirrored to disk (surviving a
 * restart) with a 6-hour TTL; a live fetch failure with a cache on hand
 * degrades to that cache marked `stale` rather than failing the picker
 * outright: only a *first-ever* fetch with nothing cached is a hard error.
 *
 * The disk file is written the same tmp-then-rename way as
 * `config/settings.ts`'s user-settings override, so a crash mid-write can
 * never leave a half-written JSON file that the next launch chokes on.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CACHE_FILENAME = 'openrouter-models.json'

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

function sortByName(models: OpenRouterModel[]): OpenRouterModel[] {
  return [...models].sort((a, b) => a.name.localeCompare(b.name))
}

let memoryCache: OpenRouterModelCatalog | null = null

function isFreshEnough(catalog: OpenRouterModelCatalog): boolean {
  const fetchedAt = Date.parse(catalog.fetchedAt)
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < CACHE_TTL_MS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Never trusts the file on disk: a hand-edited or half-written cache degrades to "no cache" rather than crashing the picker. */
function readDiskCache(): OpenRouterModelCatalog | null {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (
      !isRecord(parsed) ||
      typeof parsed.fetchedAt !== 'string' ||
      typeof parsed.stale !== 'boolean' ||
      !Array.isArray(parsed.models) ||
      !parsed.models.every(isOpenRouterModel)
    ) {
      appLogger.warn(`OpenRouter model cache at ${path} was malformed; ignoring it.`)
      return null
    }
    return { models: parsed.models, fetchedAt: parsed.fetchedAt, stale: parsed.stale }
  } catch (err) {
    appLogger.warn(`Could not read OpenRouter model cache at ${path}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function writeDiskCache(catalog: OpenRouterModelCatalog): void {
  const path = cachePath()
  const tempPath = `${path}.tmp`
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    // Always written with stale:false; "stale" describes how a *read*
    // was served (a live fetch failed and this cache stood in for it), not
    // a property of the cache file itself.
    writeFileSync(tempPath, JSON.stringify({ ...catalog, stale: false }), 'utf-8')
    renameSync(tempPath, path)
  } catch (err) {
    // A cache write failing is never fatal to serving the catalog the
    // caller asked for; it only means the next process start refetches.
    appLogger.warn(`Could not write OpenRouter model cache at ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface GetModelCatalogOptions {
  /** Bypasses both the in-memory and on-disk cache, ignoring their TTL. */
  refresh?: boolean
}

export type GetModelCatalogResult = { ok: true; catalog: OpenRouterModelCatalog } | { ok: false; error: AppError }

export async function getModelCatalog(
  options: GetModelCatalogOptions = {},
  fetchImpl: FetchLike = fetch
): Promise<GetModelCatalogResult> {
  if (!options.refresh) {
    if (memoryCache && isFreshEnough(memoryCache)) {
      return { ok: true, catalog: { ...memoryCache, stale: false } }
    }
    if (!memoryCache) {
      const disk = readDiskCache()
      if (disk) memoryCache = disk
    }
    if (memoryCache && isFreshEnough(memoryCache)) {
      return { ok: true, catalog: { ...memoryCache, stale: false } }
    }
  }

  const result = await fetchModels(fetchImpl)
  if (result.ok) {
    const catalog: OpenRouterModelCatalog = {
      models: sortByName(result.value),
      fetchedAt: new Date().toISOString(),
      stale: false
    }
    memoryCache = catalog
    writeDiskCache(catalog)
    return { ok: true, catalog }
  }

  // A refresh failure still gets to fall back to whatever cache exists
  // (even an expired one; stale-but-usable beats an empty picker), only
  // reported as an error when there is truly nothing to fall back to.
  const fallback = memoryCache ?? readDiskCache()
  if (fallback) {
    memoryCache = fallback
    return { ok: true, catalog: { ...fallback, stale: true } }
  }

  return { ok: false, error: result.error }
}

/** Test-only: clears the in-memory cache so each test starts from a clean slate (the disk cache lives in the per-test temp `userData` dir already). */
export function __resetModelCatalogCacheForTests(): void {
  memoryCache = null
}
