import { randomUUID } from 'crypto'
import { and, desc, eq, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../index'
import { likeContains } from './likeSearch'
import { indexedJobs, jobs } from '../schema'
import type { IndexedJobRecord, ListIndexedJobsQuery, ListIndexedJobsResult } from '@shared/types/indexedJob'
import type { ExportIndexedJob } from '@shared/types/dataTransfer'
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
    const term = query.search.trim()
    const searchCondition = or(likeContains(indexedJobs.title, term), likeContains(indexedJobs.company, term))
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

/**
 * Unpaginated read for a one-shot export, mirroring `listAllExclusions`.
 *
 * Reads the table directly rather than going through `listIndexedJobs`: the
 * match columns that view adds come from a join against `jobs`, and they
 * describe this machine's board rather than anything stored here, so they
 * have no business in a file (see `ExportIndexedJob`).
 */
export function listAllIndexedJobs(): ExportIndexedJob[] {
  return getDb()
    .select()
    .from(indexedJobs)
    .orderBy(desc(indexedJobs.lastSeenAt))
    .all()
    .map((row) => ({
      url: row.url,
      title: row.title,
      company: row.company,
      location: row.location,
      source: row.source,
      snippet: row.snippet,
      salaryRange: row.salaryRange,
      postedAt: row.postedAt,
      searchQuery: row.searchQuery,
      searchLocation: row.searchLocation,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      seenCount: row.seenCount
    }))
}

/**
 * Merges an exported search history alongside this machine's own, mirroring
 * `importExclusions` — a URL already indexed here is skipped rather than
 * overwritten, because the local row's `lastSeenAt` and `seenCount` describe
 * searches this install actually ran and the file's describe someone else's.
 *
 * A fresh id is minted per row for the same reason the export drops it: the
 * identity of an indexed job is its URL.
 */
export function importIndexedJobs(records: readonly ExportIndexedJob[]): { imported: number; skipped: number } {
  const db = getDb()
  let imported = 0
  let skipped = 0

  for (const record of records) {
    const result = db
      .insert(indexedJobs)
      .values({
        id: randomUUID(),
        url: record.url,
        title: record.title,
        company: record.company,
        location: record.location,
        source: record.source,
        snippet: record.snippet,
        salaryRange: record.salaryRange,
        postedAt: record.postedAt,
        searchQuery: record.searchQuery,
        searchLocation: record.searchLocation,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        // A count from a file still has to be a count: the column is read by
        // the Indexed list and a negative or fractional one would render as
        // "seen -3 times".
        seenCount: Number.isFinite(record.seenCount) && record.seenCount > 0 ? Math.floor(record.seenCount) : 1
      })
      .onConflictDoNothing({ target: indexedJobs.url })
      .run()

    if (result.changes > 0) imported++
    else skipped++
  }

  return { imported, skipped }
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
