import { randomUUID } from 'crypto'
import { and, desc, eq, isNotNull, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../index'
import { indexedJobs, jobs } from '../schema'
import type { IndexedJobRecord, ListIndexedJobsQuery, ListIndexedJobsResult } from '@shared/types/indexedJob'
import type { JobSearchResultItem } from '../../browser/types'
import { LIST_INDEXED_JOBS_DEFAULT_LIMIT, LIST_INDEXED_JOBS_MAX_LIMIT } from '@shared/constants'
import { getIndexedJobsRetentionDays } from './settingsRepository'

const nowIso = (): string => new Date().toISOString()

/**
 * Persists every raw search_jobs result, upserted by url so re-searching the
 * same listing just refreshes it instead of creating a duplicate row.
 * Deliberately independent of queue_job — "matched" is derived at read time
 * by joining against the jobs table, never stored here, so the two can't
 * drift out of sync.
 */
export function upsertIndexedJobs(
  results: JobSearchResultItem[],
  searchQuery: string,
  searchLocation: string | null
): void {
  if (results.length === 0) return
  const db = getDb()
  const now = nowIso()

  for (const result of results) {
    db.insert(indexedJobs)
      .values({
        id: randomUUID(),
        url: result.url,
        title: result.title,
        company: result.company,
        location: result.location ?? null,
        source: result.source,
        snippet: result.snippet,
        salaryRange: result.salaryRange ?? null,
        postedAt: result.postedAt ?? null,
        searchQuery,
        searchLocation,
        firstSeenAt: now,
        lastSeenAt: now,
        seenCount: 1
      })
      .onConflictDoUpdate({
        target: indexedJobs.url,
        set: {
          title: result.title,
          company: result.company,
          location: result.location ?? null,
          snippet: result.snippet,
          salaryRange: result.salaryRange ?? null,
          postedAt: result.postedAt ?? null,
          searchQuery,
          searchLocation,
          lastSeenAt: now,
          seenCount: sql`${indexedJobs.seenCount} + 1`
        }
      })
      .run()
  }
}

export function listIndexedJobs(query: ListIndexedJobsQuery): ListIndexedJobsResult {
  const db = getDb()
  const limit = Math.min(Math.max(1, query.limit ?? LIST_INDEXED_JOBS_DEFAULT_LIMIT), LIST_INDEXED_JOBS_MAX_LIMIT)
  const offset = Math.max(0, query.offset ?? 0)

  const conditions: SQL<unknown>[] = []
  if (query.source) conditions.push(eq(indexedJobs.source, query.source))
  if (query.matched === 'matched') conditions.push(isNotNull(jobs.id))
  if (query.matched === 'unmatched') conditions.push(isNull(jobs.id))
  if (query.search?.trim()) {
    const pattern = `%${query.search.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`
    const searchCondition = or(like(indexedJobs.title, pattern), like(indexedJobs.company, pattern))
    if (searchCondition) conditions.push(searchCondition)
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = db
    .select({
      indexed: indexedJobs,
      matchedJobId: jobs.id,
      matchedStatus: jobs.status,
      matchedScore: jobs.matchScore
    })
    .from(indexedJobs)
    .leftJoin(jobs, eq(indexedJobs.url, jobs.url))
    .where(whereClause)
    .orderBy(desc(indexedJobs.lastSeenAt))
    .limit(limit)
    .offset(offset)
    .all()

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(indexedJobs)
    .leftJoin(jobs, eq(indexedJobs.url, jobs.url))
    .where(whereClause)
    .get()

  const items: IndexedJobRecord[] = rows.map((row) => ({
    id: row.indexed.id,
    url: row.indexed.url,
    title: row.indexed.title,
    company: row.indexed.company,
    location: row.indexed.location,
    source: row.indexed.source,
    snippet: row.indexed.snippet,
    salaryRange: row.indexed.salaryRange,
    postedAt: row.indexed.postedAt,
    searchQuery: row.indexed.searchQuery,
    searchLocation: row.indexed.searchLocation,
    firstSeenAt: row.indexed.firstSeenAt,
    lastSeenAt: row.indexed.lastSeenAt,
    seenCount: row.indexed.seenCount,
    matchedJobId: row.matchedJobId,
    matchedStatus: row.matchedStatus,
    matchedScore: row.matchedScore
  }))

  return { items, total: totalRow?.count ?? 0 }
}

/** Deletes indexed-job rows last seen before the configured retention window. Returns the number deleted. */
export function pruneIndexedJobs(): number {
  const retention = getIndexedJobsRetentionDays()
  if (retention === 'unlimited') return 0

  const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000).toISOString()
  const db = getDb()
  const toDelete = db.select({ id: indexedJobs.id }).from(indexedJobs).where(lt(indexedJobs.lastSeenAt, cutoff)).all()
  if (toDelete.length === 0) return 0

  db.delete(indexedJobs).where(lt(indexedJobs.lastSeenAt, cutoff)).run()
  return toDelete.length
}
