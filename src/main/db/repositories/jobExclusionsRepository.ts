import { randomUUID } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../index'
import { likeContains } from './likeSearch'
import { jobExclusions } from '../schema'
import type { ExclusionRecord, ExcludedBy, ListExclusionsQuery, ListExclusionsResult } from '@shared/types/exclusion'
import { LIST_EXCLUSIONS_DEFAULT_LIMIT, LIST_EXCLUSIONS_MAX_LIMIT } from '@shared/constants'

type ExclusionRow = typeof jobExclusions.$inferSelect

function toExclusionRecord(row: ExclusionRow): ExclusionRecord {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    company: row.company,
    reason: row.reason,
    excludedBy: row.excludedBy as ExcludedBy,
    createdAt: row.createdAt
  }
}

export interface ExcludeUrlInput {
  url: string
  title?: string | null
  company?: string | null
  reason?: string | null
  excludedBy: ExcludedBy
}

export function isUrlExcluded(url: string): boolean {
  return !!getDb().select({ id: jobExclusions.id }).from(jobExclusions).where(eq(jobExclusions.url, url)).get()
}

export function excludeUrl(input: ExcludeUrlInput): { exclusion: ExclusionRecord; wasExisting: boolean } {
  const db = getDb()
  const existing = db.select().from(jobExclusions).where(eq(jobExclusions.url, input.url)).get()
  if (existing) {
    return { exclusion: toExclusionRecord(existing), wasExisting: true }
  }

  const id = randomUUID()
  db.insert(jobExclusions)
    .values({
      id,
      url: input.url,
      title: input.title ?? null,
      company: input.company ?? null,
      reason: input.reason ?? null,
      excludedBy: input.excludedBy
    })
    .run()

  const row = db.select().from(jobExclusions).where(eq(jobExclusions.id, id)).get()
  if (!row) throw new Error('Failed to read back inserted exclusion')
  return { exclusion: toExclusionRecord(row), wasExisting: false }
}

export function listExclusions(query: ListExclusionsQuery): ListExclusionsResult {
  const db = getDb()
  const limit = Math.min(Math.max(1, query.limit ?? LIST_EXCLUSIONS_DEFAULT_LIMIT), LIST_EXCLUSIONS_MAX_LIMIT)
  const offset = Math.max(0, query.offset ?? 0)

  const whereClause = query.search?.trim()
    ? likeContains(jobExclusions.url, query.search.trim())
    : undefined

  const rows = db
    .select()
    .from(jobExclusions)
    .where(whereClause)
    .orderBy(sql`${jobExclusions.createdAt} DESC`)
    .limit(limit)
    .offset(offset)
    .all()

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(jobExclusions)
    .where(whereClause)
    .get()

  return {
    exclusions: rows.map(toExclusionRecord),
    total: totalRow?.count ?? 0
  }
}

export function removeExclusion(id: string): void {
  getDb().delete(jobExclusions).where(eq(jobExclusions.id, id)).run()
}

/** Unpaginated read of every exclusion, for a one-shot data export rather than a page render. */
export function listAllExclusions(): ExclusionRecord[] {
  return getDb().select().from(jobExclusions).orderBy(sql`${jobExclusions.createdAt} DESC`).all().map(toExclusionRecord)
}

/** Bulk-inserts exclusions from an imported export bundle, skipping any whose URL already exists. Ids are regenerated (see `importJobs`). */
export function importExclusions(records: ExclusionRecord[]): { imported: number; skipped: number } {
  const db = getDb()
  let imported = 0
  let skipped = 0
  for (const r of records) {
    const result = db
      .insert(jobExclusions)
      .values({
        id: randomUUID(),
        url: r.url,
        title: r.title,
        company: r.company,
        reason: r.reason,
        excludedBy: r.excludedBy,
        createdAt: r.createdAt
      })
      .onConflictDoNothing({ target: jobExclusions.url })
      .run()
    if (result.changes > 0) imported++
    else skipped++
  }
  return { imported, skipped }
}
