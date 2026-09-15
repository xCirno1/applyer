import { randomUUID } from 'crypto'
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../index'
import { jobs, runEvents, runs } from '../schema'
import {
  isRunEventKind,
  RUN_EVENT_KINDS,
  RUN_LABEL_MAX_LENGTH,
  type ListRunEventsQuery,
  type ListRunEventsResult,
  type ListRunsQuery,
  type ListRunsResult,
  type RunEvent,
  type RunEventKind,
  type RunEventView,
  type RunRecord
} from '@shared/types/run'

/**
 * Runs and their events (see `shared/types/run.ts`). The repository only
 * stores and lists; folding events into statistics is `runs/runStats.ts`,
 * and deciding whether a run is in progress at all is `runs/runTracker.ts`.
 */

const RUNS_DEFAULT_LIMIT = 20
const RUNS_MAX_LIMIT = 100
const EVENTS_DEFAULT_LIMIT = 50
const EVENTS_MAX_LIMIT = 200
/**
 * Ceiling on the rows `loadRunEvents` folds into statistics. A run that
 * long has been left running for days; the fold stays bounded and the
 * timeline (paginated) still shows everything.
 */
export const RUN_EVENTS_FOLD_LIMIT = 20000

function toRecord(row: typeof runs.$inferSelect, eventCount: number): RunRecord {
  return {
    id: row.id,
    label: row.label,
    sequence: row.sequence,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    eventCount
  }
}

/**
 * Restricts a query to the kinds this build knows. Rows of another kind
 * (written by a newer build, or corrupted) must be left out in SQL rather
 * than after the fact: a row that counts towards LIMIT/OFFSET and `total`
 * but is then dropped from the page makes the timeline's next offset land
 * short, so pages overlap or skip.
 */
function knownKinds(): SQL<unknown> {
  return inArray(runEvents.kind, [...RUN_EVENT_KINDS])
}

function toEvent(row: typeof runEvents.$inferSelect): RunEvent | null {
  // Belt and braces with `knownKinds()`: every read filters in SQL, and a
  // row that slipped past anyway is skipped rather than surfaced as
  // something it is not.
  if (!isRunEventKind(row.kind)) return null
  const meta = row.meta
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    source: row.source,
    jobId: row.jobId,
    meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null,
    createdAt: row.createdAt
  }
}

function countEvents(runId: string): number {
  return (
    getDb()
      .select({ count: sql<number>`count(*)` })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .get()?.count ?? 0
  )
}

export function getActiveRun(): RunRecord | null {
  const row = getDb().select().from(runs).where(isNull(runs.endedAt)).orderBy(desc(runs.sequence)).get()
  return row ? toRecord(row, countEvents(row.id)) : null
}

export function getRun(id: string): RunRecord | null {
  const row = getDb().select().from(runs).where(eq(runs.id, id)).get()
  return row ? toRecord(row, countEvents(row.id)) : null
}

/**
 * Starts a run. Any run still in progress is ended first, so there is never
 * more than one open: two open runs would both claim every event.
 */
export function createRun(label: string | null = null): RunRecord {
  const db = getDb()
  const now = new Date().toISOString()
  return db.transaction((tx) => {
    tx.update(runs).set({ endedAt: now }).where(isNull(runs.endedAt)).run()
    const last = tx.select({ max: sql<number | null>`max(${runs.sequence})` }).from(runs).get()
    const sequence = (last?.max ?? 0) + 1
    const id = randomUUID()
    tx.insert(runs).values({ id, label: normalizeLabel(label), sequence, startedAt: now, endedAt: null }).run()
    return toRecord(tx.select().from(runs).where(eq(runs.id, id)).get()!, 0)
  })
}

export function endRun(id: string): RunRecord | null {
  const db = getDb()
  const current = db.select().from(runs).where(eq(runs.id, id)).get()
  if (!current) return null
  if (!current.endedAt) {
    db.update(runs).set({ endedAt: new Date().toISOString() }).where(eq(runs.id, id)).run()
  }
  return getRun(id)
}

export function normalizeLabel(label: string | null | undefined): string | null {
  if (typeof label !== 'string') return null
  const trimmed = label.trim().replace(/\s+/g, ' ').slice(0, RUN_LABEL_MAX_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

export function renameRun(id: string, label: string | null): RunRecord | null {
  const db = getDb()
  const current = db.select({ id: runs.id }).from(runs).where(eq(runs.id, id)).get()
  if (!current) return null
  db.update(runs).set({ label: normalizeLabel(label) }).where(eq(runs.id, id)).run()
  return getRun(id)
}

/** Deletes the run and, through the cascade, its events. */
export function deleteRun(id: string): boolean {
  return getDb().delete(runs).where(eq(runs.id, id)).run().changes > 0
}

export function listRuns(query: ListRunsQuery): ListRunsResult {
  const db = getDb()
  const limit = Math.min(Math.max(1, query.limit ?? RUNS_DEFAULT_LIMIT), RUNS_MAX_LIMIT)
  const offset = Math.max(0, query.offset ?? 0)
  const rows = db
    .select({
      run: runs,
      // Written out rather than built from the table objects: inside a select
      // list drizzle drops the table qualifier, and an unqualified "id" in
      // the subquery would resolve to run_events.id.
      eventCount: sql<number>`(select count(*) from run_events re where re.run_id = runs.id)`
    })
    .from(runs)
    .orderBy(desc(runs.sequence))
    .limit(limit)
    .offset(offset)
    .all()
  const total = db.select({ count: sql<number>`count(*)` }).from(runs).get()?.count ?? 0
  return { items: rows.map((row) => toRecord(row.run, row.eventCount)), total }
}

export interface InsertRunEventInput {
  runId: string
  kind: RunEventKind
  source?: string | null
  jobId?: string | null
  meta?: Record<string, unknown> | null
}

export function insertRunEvent(input: InsertRunEventInput): RunEvent {
  const db = getDb()
  const inserted = db
    .insert(runEvents)
    .values({
      runId: input.runId,
      kind: input.kind,
      source: input.source ?? null,
      jobId: input.jobId ?? null,
      meta: input.meta && Object.keys(input.meta).length > 0 ? input.meta : null,
      createdAt: new Date().toISOString()
    })
    .returning()
    .get()
  return toEvent(inserted)!
}

/** Every event of a run in insertion order, capped at `RUN_EVENTS_FOLD_LIMIT`. */
export function loadRunEvents(runId: string): RunEvent[] {
  const rows = getDb()
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), knownKinds()))
    .orderBy(runEvents.id)
    .limit(RUN_EVENTS_FOLD_LIMIT)
    .all()
  const events: RunEvent[] = []
  for (const row of rows) {
    const event = toEvent(row)
    if (event) events.push(event)
  }
  return events
}

/** A page of a run's timeline, newest first, with the job each event names when it still exists. */
export function listRunEvents(query: ListRunEventsQuery): ListRunEventsResult {
  const db = getDb()
  const limit = Math.min(Math.max(1, query.limit ?? EVENTS_DEFAULT_LIMIT), EVENTS_MAX_LIMIT)
  const offset = Math.max(0, query.offset ?? 0)
  const kinds = query.kinds?.filter(isRunEventKind) ?? []
  if (query.kinds && kinds.length === 0) return { items: [], total: 0 }
  const where = and(eq(runEvents.runId, query.runId), kinds.length > 0 ? inArray(runEvents.kind, kinds) : knownKinds())

  const rows = db
    .select({ event: runEvents, jobTitle: jobs.title, jobCompany: jobs.company })
    .from(runEvents)
    .leftJoin(jobs, eq(jobs.id, runEvents.jobId))
    .where(where)
    .orderBy(desc(runEvents.id))
    .limit(limit)
    .offset(offset)
    .all()
  const total = db.select({ count: sql<number>`count(*)` }).from(runEvents).where(where).get()?.count ?? 0

  const items: RunEventView[] = []
  for (const row of rows) {
    const event = toEvent(row.event)
    if (event) items.push({ ...event, jobTitle: row.jobTitle ?? null, jobCompany: row.jobCompany ?? null })
  }
  return { items, total }
}
