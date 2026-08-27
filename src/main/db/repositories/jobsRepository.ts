import { randomUUID } from 'crypto'
import { and, desc, eq, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../index'
import { likeContains } from './likeSearch'
import { jobs } from '../schema'
import type { JobRecord, JobStatus, ListJobsQuery, ListJobsResult, ApplyMethod } from '@shared/types/job'
import { LIST_JOBS_DEFAULT_LIMIT, LIST_JOBS_MAX_LIMIT } from '@shared/constants'

type JobRow = typeof jobs.$inferSelect

function toJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    externalId: row.externalId,
    source: row.source,
    title: row.title,
    company: row.company,
    location: row.location,
    url: row.url,
    description: row.description,
    salaryRange: row.salaryRange,
    status: row.status,
    matchScore: row.matchScore,
    matchReasons: row.matchReasons,
    applicationUrl: row.applicationUrl,
    applyMethod: row.applyMethod,
    screenshotPath: row.screenshotPath,
    failureTag: row.failureTag,
    failureMessage: row.failureMessage,
    blockingReason: row.blockingReason,
    blockingTaskId: row.blockingTaskId,
    queuedAt: row.queuedAt,
    filledAt: row.filledAt,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

const nowIso = (): string => new Date().toISOString()

export interface QueueJobInput {
  title: string
  company: string
  url: string
  location?: string | null
  source?: string | null
  description?: string | null
  salaryRange?: string | null
  matchScore?: number | null
  matchReasons?: string[] | null
  applicationUrl?: string | null
  applyMethod?: ApplyMethod | null
}

export function queueJob(input: QueueJobInput): { job: JobRecord; wasExisting: boolean } {
  const db = getDb()
  const existing = db.select().from(jobs).where(eq(jobs.url, input.url)).get()
  if (existing) {
    return { job: toJobRecord(existing), wasExisting: true }
  }

  const id = randomUUID()
  const now = nowIso()
  db.insert(jobs)
    .values({
      id,
      title: input.title,
      company: input.company,
      url: input.url,
      location: input.location ?? null,
      source: input.source ?? null,
      description: input.description ?? null,
      salaryRange: input.salaryRange ?? null,
      status: 'queued',
      matchScore: input.matchScore ?? null,
      matchReasons: input.matchReasons ?? null,
      applicationUrl: input.applicationUrl ?? null,
      applyMethod: input.applyMethod ?? null,
      queuedAt: now,
      createdAt: now,
      updatedAt: now
    })
    .run()

  const row = db.select().from(jobs).where(eq(jobs.id, id)).get()
  if (!row) throw new Error('Failed to read back inserted job')
  return { job: toJobRecord(row), wasExisting: false }
}

export function getJob(id: string): JobRecord | null {
  const row = getDb().select().from(jobs).where(eq(jobs.id, id)).get()
  return row ? toJobRecord(row) : null
}

export function getJobByUrl(url: string): JobRecord | null {
  const row = getDb().select().from(jobs).where(eq(jobs.url, url)).get()
  return row ? toJobRecord(row) : null
}

export function listJobs(query: ListJobsQuery): ListJobsResult {
  const db = getDb()
  const limit = Math.min(Math.max(1, query.limit ?? LIST_JOBS_DEFAULT_LIMIT), LIST_JOBS_MAX_LIMIT)
  const offset = Math.max(0, query.offset ?? 0)

  const conditions: SQL<unknown>[] = []
  if (query.status) conditions.push(eq(jobs.status, query.status))
  if (query.source) conditions.push(eq(jobs.source, query.source))
  if (query.search?.trim()) {
    const term = query.search.trim()
    const searchCondition = or(likeContains(jobs.title, term), likeContains(jobs.company, term))
    if (searchCondition) conditions.push(searchCondition)
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const orderBy =
    query.sortBy === 'matchScore'
      ? [sql`${jobs.matchScore} IS NULL`, desc(jobs.matchScore), desc(jobs.updatedAt)]
      : [desc(jobs.updatedAt)]

  const rows = db.select().from(jobs).where(whereClause).orderBy(...orderBy).limit(limit).offset(offset).all()

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(whereClause)
    .get()

  return {
    jobs: rows.map(toJobRecord),
    total: totalRow?.count ?? 0
  }
}

const LEGAL_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ['filled', 'failed'],
  filled: ['submitted', 'failed'],
  submitted: [],
  failed: ['queued']
}

class IllegalTransitionError extends Error {
  // The statuses are kept as fields, not just baked into the message: the
  // IPC layer turns this into a translatable error code and needs them as
  // interpolation params (see ipc/jobs.ts's toJobError).
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus
  ) {
    super(`Illegal job state transition: ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

function assertLegalTransition(from: JobStatus, to: JobStatus): void {
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw new IllegalTransitionError(from, to)
  }
}

export function setFilled(id: string, meta: { screenshotPath?: string | null } = {}): JobRecord {
  const db = getDb()
  const current = getJob(id)
  if (!current) throw new Error(`Job not found: ${id}`)
  assertLegalTransition(current.status, 'filled')

  const now = nowIso()
  db.update(jobs)
    .set({
      status: 'filled',
      screenshotPath: meta.screenshotPath ?? current.screenshotPath,
      filledAt: now,
      blockingReason: null,
      blockingTaskId: null,
      updatedAt: now
    })
    .where(eq(jobs.id, id))
    .run()

  return getJob(id) as JobRecord
}

export function setSubmitted(id: string): JobRecord {
  const db = getDb()
  const current = getJob(id)
  if (!current) throw new Error(`Job not found: ${id}`)
  assertLegalTransition(current.status, 'submitted')

  const now = nowIso()
  db.update(jobs).set({ status: 'submitted', submittedAt: now, updatedAt: now }).where(eq(jobs.id, id)).run()
  return getJob(id) as JobRecord
}

export function setFailed(id: string, failureTag: string, failureMessage?: string | null): JobRecord {
  const db = getDb()
  const current = getJob(id)
  if (!current) throw new Error(`Job not found: ${id}`)
  assertLegalTransition(current.status, 'failed')

  const now = nowIso()
  db.update(jobs)
    .set({
      status: 'failed',
      failureTag,
      failureMessage: failureMessage ?? null,
      blockingReason: null,
      blockingTaskId: null,
      updatedAt: now
    })
    .where(eq(jobs.id, id))
    .run()

  return getJob(id) as JobRecord
}

export function retry(id: string): JobRecord {
  const db = getDb()
  const current = getJob(id)
  if (!current) throw new Error(`Job not found: ${id}`)
  assertLegalTransition(current.status, 'queued')

  const now = nowIso()
  db.update(jobs)
    .set({
      status: 'queued',
      failureTag: null,
      failureMessage: null,
      updatedAt: now
    })
    .where(eq(jobs.id, id))
    .run()

  return getJob(id) as JobRecord
}

/** Bulk-requeues every currently failed job (used by the Jobs > Retry All Failed menu action). */
export function retryAllFailed(): JobRecord[] {
  const db = getDb()
  const failedIds = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.status, 'failed'))
    .all()
    .map((row) => row.id)
  if (failedIds.length === 0) return []

  db.update(jobs)
    .set({ status: 'queued', failureTag: null, failureMessage: null, updatedAt: nowIso() })
    .where(eq(jobs.status, 'failed'))
    .run()

  return failedIds.map((id) => getJob(id) as JobRecord)
}

/**
 * Requeues whichever of the given ids are currently failed (used by both
 * the per-card right-click menu and the board's bulk-selection toolbar).
 * Ids that don't exist or aren't currently failed are silently skipped —
 * the renderer already filters to failed jobs before calling this, but the
 * check is repeated here since ids arriving over IPC are never trusted.
 */
export function retryManyFailed(ids: string[]): JobRecord[] {
  const db = getDb()
  const now = nowIso()
  const updated: JobRecord[] = []
  for (const id of ids) {
    const current = getJob(id)
    if (!current || current.status !== 'failed') continue
    db.update(jobs)
      .set({ status: 'queued', failureTag: null, failureMessage: null, updatedAt: now })
      .where(eq(jobs.id, id))
      .run()
    updated.push(getJob(id) as JobRecord)
  }
  return updated
}

export function setBlocking(id: string, blockingReason: string, blockingTaskId: string): void {
  getDb()
    .update(jobs)
    .set({ blockingReason, blockingTaskId, updatedAt: nowIso() })
    .where(eq(jobs.id, id))
    .run()
}

export function clearBlocking(id: string): void {
  getDb()
    .update(jobs)
    .set({ blockingReason: null, blockingTaskId: null, updatedAt: nowIso() })
    .where(eq(jobs.id, id))
    .run()
}

export function removeJob(id: string): void {
  getDb().delete(jobs).where(and(eq(jobs.id, id))).run()
}

/** Jobs left with a stale blockingTaskId from a previous run — the in-memory captcha gate that owned it doesn't survive a restart. */
export function listBlockedJobs(): JobRecord[] {
  return getDb().select().from(jobs).where(isNotNull(jobs.blockingTaskId)).all().map(toJobRecord)
}

/** Unpaginated read of every job, for a one-shot data export rather than a page render. */
export function listAllJobs(): JobRecord[] {
  return getDb().select().from(jobs).orderBy(desc(jobs.createdAt)).all().map(toJobRecord)
}

/**
 * Bulk-inserts jobs from an imported export bundle, skipping any whose URL
 * already exists (URL is a job's identity elsewhere in this file too — see
 * `queueJob`/`getJobByUrl`). Ids are regenerated rather than reused from the
 * file, since two independently-exported bundles could theoretically carry
 * colliding ids; `screenshotPath` and the in-memory-only blocking fields are
 * dropped since they'd point at another machine's filesystem/live task.
 */
export function importJobs(records: JobRecord[]): { imported: number; skipped: number } {
  const db = getDb()
  let imported = 0
  let skipped = 0
  for (const r of records) {
    const result = db
      .insert(jobs)
      .values({
        id: randomUUID(),
        externalId: r.externalId,
        source: r.source,
        title: r.title,
        company: r.company,
        location: r.location,
        url: r.url,
        description: r.description,
        salaryRange: r.salaryRange,
        status: r.status,
        matchScore: r.matchScore,
        matchReasons: r.matchReasons,
        applicationUrl: r.applicationUrl,
        applyMethod: r.applyMethod,
        screenshotPath: null,
        failureTag: r.failureTag,
        failureMessage: r.failureMessage,
        blockingReason: null,
        blockingTaskId: null,
        queuedAt: r.queuedAt,
        filledAt: r.filledAt,
        submittedAt: r.submittedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })
      .onConflictDoNothing({ target: jobs.url })
      .run()
    if (result.changes > 0) imported++
    else skipped++
  }
  return { imported, skipped }
}

export { IllegalTransitionError }
