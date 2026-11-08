import { and, eq, isNotNull, notInArray, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/better-sqlite3'
import type * as schema from './schema'
import { applicationStages, jobs } from './schema'
import { appLogger } from '../logger'
import { BUILTIN_STAGE_IDS, BUILTIN_STAGE_LABELS } from '@shared/types/applicationStage'

/*
 * Open-time upkeep for post-submission stages, kept apart from
 * `repositories/applicationStagesRepository.ts` because `db/index.ts` runs it
 * on the connection it just opened, and the repositories import `getDb` from
 * that module (a cycle the other way round). Both functions take the
 * database explicitly for the same reason.
 */

type Database = ReturnType<typeof drizzle<typeof schema>>

/**
 * Makes sure every built-in stage exists, appending any that are missing at
 * the end of the order. The migration that created the table seeds them, so
 * this only does work for a database a hand edit or a partial restore left
 * without one; it is cheap and idempotent, so it runs on every open, like
 * `seedFailureTags`.
 */
export function seedBuiltinStages(db: Database): void {
  for (const id of BUILTIN_STAGE_IDS) {
    const existing = db.select({ id: applicationStages.id, isBuiltin: applicationStages.isBuiltin }).from(applicationStages).where(eq(applicationStages.id, id)).get()
    if (existing) {
      if (!existing.isBuiltin) {
        // Only reachable through a hand edit; the id is what makes it built-in.
        db.update(applicationStages).set({ isBuiltin: true, label: BUILTIN_STAGE_LABELS[id] }).where(eq(applicationStages.id, id)).run()
      }
      continue
    }
    appLogger.warn(`Built-in application stage "${id}" was missing; re-creating it`)
    db.insert(applicationStages)
      .values({ id, label: BUILTIN_STAGE_LABELS[id], isBuiltin: true, position: nextPosition(db) })
      .onConflictDoNothing({ target: applicationStages.id })
      .run()
  }
}

/**
 * Clears any job's stage that points at no stage row. The foreign key makes
 * this impossible through the app, but a database opened by another tool
 * without `PRAGMA foreign_keys` can leave one behind; every reader already
 * treats such an id as "no stage", and this puts the stored data back in line
 * so it stops being logged on every read. Returns how many jobs it cleared.
 */
export function repairDanglingStageRefs(db: Database): number {
  const known = db.select({ id: applicationStages.id }).from(applicationStages).all().map((row) => row.id)
  const condition = known.length > 0 ? and(isNotNull(jobs.stageId), notInArray(jobs.stageId, known)) : isNotNull(jobs.stageId)
  const result = db.update(jobs).set({ stageId: null, stageChangedAt: null }).where(condition).run()
  if (result.changes > 0) {
    appLogger.warn(`Cleared ${result.changes} job stage reference(s) pointing at a stage that no longer exists`)
  }
  return result.changes
}

function nextPosition(db: Database): number {
  const row = db.select({ max: sql<number | null>`max(${applicationStages.position})` }).from(applicationStages).get()
  return (row?.max ?? -1) + 1
}
