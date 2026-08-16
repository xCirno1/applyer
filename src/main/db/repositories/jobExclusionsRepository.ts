import { randomUUID } from 'crypto'
import { eq, like, sql } from 'drizzle-orm'
import { getDb } from '../index'
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
    ? like(jobExclusions.url, `%${query.search.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`)
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
