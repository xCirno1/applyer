import { createHash } from 'crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../index'
import { jobDetailsCache } from '../schema'
import { JOB_DETAILS_CACHE_PAYLOAD_VERSION, JOB_DETAILS_CACHE_TTL_MS } from '@shared/constants'
import type { JobDetailsData } from '../../browser/types'

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

export function getCachedJobDetails(url: string): JobDetailsData | null {
  const row = getDb().select().from(jobDetailsCache).where(eq(jobDetailsCache.urlHash, hashUrl(url))).get()
  if (!row) return null

  // A payload written by an older build can hold text the current scrapers
  // would produce differently, so it is a miss regardless of its age — the
  // caller refetches and overwrites it. Rows predating the column carry 0.
  if (row.payloadVersion !== JOB_DETAILS_CACHE_PAYLOAD_VERSION) return null

  const age = Date.now() - new Date(row.fetchedAt).getTime()
  if (age > JOB_DETAILS_CACHE_TTL_MS) return null

  return row.payload as JobDetailsData
}

export function setCachedJobDetails(url: string, details: JobDetailsData): void {
  const db = getDb()
  const urlHash = hashUrl(url)
  const values = {
    urlHash,
    url,
    payload: details,
    payloadVersion: JOB_DETAILS_CACHE_PAYLOAD_VERSION,
    detectedAts: details.detectedAts ?? null,
    requiresLogin: details.requiresLogin,
    applyMethod: details.applyMethod,
    fetchedAt: new Date().toISOString()
  }
  db.insert(jobDetailsCache).values(values).onConflictDoUpdate({ target: jobDetailsCache.urlHash, set: values }).run()
}
