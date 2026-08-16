import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../index'
import { activityLog } from '../schema'
import type { ActivityLevel, ActivityLogEntry, ListActivityQuery, ListActivityResult } from '@shared/types/activity'

const ACTIVITY_DEFAULT_LIMIT = 50
const ACTIVITY_MAX_LIMIT = 200

export function logActivity(
  level: ActivityLevel,
  message: string,
  meta?: { jobId?: string; [key: string]: unknown }
): void {
  const { jobId, ...rest } = meta ?? {}
  getDb()
    .insert(activityLog)
    .values({
      jobId: jobId ?? null,
      level,
      message,
      meta: Object.keys(rest).length > 0 ? rest : null,
      createdAt: new Date().toISOString()
    })
    .run()
}

function toEntry(row: typeof activityLog.$inferSelect): ActivityLogEntry {
  return {
    id: row.id,
    jobId: row.jobId,
    level: row.level,
    message: row.message,
    meta: row.meta as Record<string, unknown> | null,
    createdAt: row.createdAt
  }
}

export function listActivity(query: ListActivityQuery): ListActivityResult {
  const db = getDb()
  const limit = Math.min(Math.max(1, query.limit ?? ACTIVITY_DEFAULT_LIMIT), ACTIVITY_MAX_LIMIT)
  const offset = Math.max(0, query.offset ?? 0)

  const conditions: SQL<unknown>[] = []
  if (query.jobId) conditions.push(eq(activityLog.jobId, query.jobId))
  if (query.level) conditions.push(eq(activityLog.level, query.level))
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = db.select().from(activityLog).where(whereClause).orderBy(desc(activityLog.id)).limit(limit).offset(offset).all()

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(activityLog)
    .where(whereClause)
    .get()

  return {
    entries: rows.map(toEntry),
    total: totalRow?.count ?? 0
  }
}
