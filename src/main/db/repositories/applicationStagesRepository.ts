import { randomUUID } from 'crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../index'
import { applicationStages, jobs } from '../schema'
import { getJob } from './jobsRepository'
import { appLogger } from '../../logger'
import type { JobRecord } from '@shared/types/job'
import {
  MAX_CUSTOM_STAGES,
  applyStageOrder,
  checkStageLabel,
  findStageByReference,
  isStageLabelTaken,
  type ApplicationStage,
  type StageCount
} from '@shared/types/applicationStage'
import type { ExportApplicationStage, ExportJobStageRef } from '@shared/types/dataTransfer'

/*
 * Post-submission stages (see `shared/types/applicationStage.ts` for the
 * model). Every write here is a plain column update: like the rest of a job's
 * fields, stages rely on the whole-database encryption mode rather than a
 * per-field envelope, so a storage-mode switch has nothing to rewrite here.
 */

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type StageRow = typeof applicationStages.$inferSelect

export type StageErrorCode = 'invalidStageName' | 'stageNameTaken' | 'stageLimitReached' | 'stageNotFound' | 'stageBuiltinLocked'

/** A refused stage write; the IPC layer turns the code into a translated message, the MCP tools read `message`. */
export class StageError extends Error {
  constructor(
    readonly code: StageErrorCode,
    message: string,
    readonly params?: Record<string, string | number>
  ) {
    super(message)
    this.name = 'StageError'
  }
}

function toStage(row: StageRow): ApplicationStage {
  return { id: row.id, label: row.label, isBuiltin: row.isBuiltin, position: row.position }
}

const nowIso = (): string => new Date().toISOString()

/** Every stage in display order (position, then id so a tie from a hand-edited database still sorts deterministically). */
export function listStages(): ApplicationStage[] {
  return getDb()
    .select()
    .from(applicationStages)
    .orderBy(applicationStages.position, applicationStages.id)
    .all()
    .map(toStage)
}

export function getStage(id: string): ApplicationStage | null {
  const row = getDb().select().from(applicationStages).where(eq(applicationStages.id, id)).get()
  return row ? toStage(row) : null
}

/** A stage by id, built-in id, or label, case-insensitively; what the agent's tools address stages by. */
export function findStage(reference: string): ApplicationStage | null {
  return findStageByReference(listStages(), reference)
}

function nextPosition(db: Db | Tx): number {
  const row = db.select({ max: sql<number | null>`max(${applicationStages.position})` }).from(applicationStages).get()
  return (row?.max ?? -1) + 1
}

function validatedLabel(raw: unknown): string {
  const check = checkStageLabel(raw)
  if (!check.ok) {
    throw new StageError(
      'invalidStageName',
      check.problem === 'empty' ? 'A stage needs a name.' : 'That stage name is too long.',
      { problem: check.problem }
    )
  }
  return check.label
}

export function createStage(rawLabel: unknown): ApplicationStage {
  const label = validatedLabel(rawLabel)
  const db = getDb()
  return db.transaction((tx) => {
    const stages = tx.select().from(applicationStages).all().map(toStage)
    if (isStageLabelTaken(stages, label)) {
      throw new StageError('stageNameTaken', `A stage named "${label}" already exists.`, { name: label })
    }
    if (stages.filter((stage) => !stage.isBuiltin).length >= MAX_CUSTOM_STAGES) {
      throw new StageError('stageLimitReached', `At most ${MAX_CUSTOM_STAGES} custom stages can exist.`, { max: MAX_CUSTOM_STAGES })
    }
    const id = randomUUID()
    const now = nowIso()
    tx.insert(applicationStages)
      .values({ id, label, isBuiltin: false, position: nextPosition(tx), createdAt: now, updatedAt: now })
      .run()
    const row = tx.select().from(applicationStages).where(eq(applicationStages.id, id)).get()
    if (!row) throw new Error('Failed to read back the inserted application stage')
    return toStage(row)
  })
}

export function renameStage(id: string, rawLabel: unknown): ApplicationStage {
  const label = validatedLabel(rawLabel)
  const db = getDb()
  return db.transaction((tx) => {
    const stages = tx.select().from(applicationStages).all().map(toStage)
    const stage = stages.find((item) => item.id === id)
    if (!stage) throw new StageError('stageNotFound', `No stage with id ${id}.`)
    if (stage.isBuiltin) throw new StageError('stageBuiltinLocked', `"${stage.label}" is a built-in stage and cannot be renamed.`)
    if (isStageLabelTaken(stages, label, id)) {
      throw new StageError('stageNameTaken', `A stage named "${label}" already exists.`, { name: label })
    }
    tx.update(applicationStages).set({ label, updatedAt: nowIso() }).where(eq(applicationStages.id, id)).run()
    return { ...stage, label }
  })
}

/** See `applyStageOrder` for how a partial or stale order is reconciled; returns the stored order. */
export function reorderStages(orderedIds: readonly string[]): ApplicationStage[] {
  const db = getDb()
  return db.transaction((tx) => {
    const stages = tx.select().from(applicationStages).all().map(toStage)
    const reordered = applyStageOrder(stages, orderedIds)
    const known = new Set(stages.map((stage) => stage.id))
    const ignored = orderedIds.filter((id) => !known.has(id))
    if (ignored.length > 0) appLogger.warn(`Stage reorder named ${ignored.length} unknown stage id(s); ignored them`)
    const now = nowIso()
    for (const stage of reordered) {
      const before = stages.find((item) => item.id === stage.id)
      if (before?.position === stage.position) continue
      tx.update(applicationStages).set({ position: stage.position, updatedAt: now }).where(eq(applicationStages.id, stage.id)).run()
    }
    return reordered
  })
}

/** How many jobs (of any status) point at a stage; what the delete confirmation shows. */
export function countJobsInStage(id: string): number {
  const row = getDb().select({ count: sql<number>`count(*)` }).from(jobs).where(eq(jobs.stageId, id)).get()
  return row?.count ?? 0
}

/**
 * Deletes a custom stage and moves every job in it back to no stage, in one
 * transaction so a job can never be left pointing at a stage that is gone.
 * The jobs are cleared explicitly rather than left to `ON DELETE SET NULL`,
 * which only fires on a connection with foreign keys enabled. Returns the
 * jobs it cleared so the caller can push them to the board.
 */
export function deleteStage(id: string): { removed: boolean; clearedJobs: JobRecord[] } {
  const db = getDb()
  const stage = getStage(id)
  if (!stage) return { removed: false, clearedJobs: [] }
  if (stage.isBuiltin) throw new StageError('stageBuiltinLocked', `"${stage.label}" is a built-in stage and cannot be deleted.`)
  const clearedIds = db.transaction((tx) => {
    const ids = tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.stageId, id)).all().map((row) => row.id)
    if (ids.length > 0) {
      tx.update(jobs).set({ stageId: null, stageChangedAt: nowIso(), updatedAt: nowIso() }).where(inArray(jobs.id, ids)).run()
    }
    tx.delete(applicationStages).where(eq(applicationStages.id, id)).run()
    // Positions stay dense so the manager's up/down arithmetic never sees a gap.
    const remaining = tx.select().from(applicationStages).all().map(toStage)
    for (const item of applyStageOrder(remaining, [])) {
      tx.update(applicationStages).set({ position: item.position }).where(eq(applicationStages.id, item.id)).run()
    }
    return ids
  })
  return {
    removed: true,
    clearedJobs: clearedIds.map((jobId) => getJob(jobId)).filter((job): job is JobRecord => job !== null)
  }
}

export interface SetJobStageResult {
  updated: JobRecord[]
  /** Ids that do not exist or are not Submitted; only Submitted jobs carry a stage. */
  skippedIds: string[]
}

/**
 * Sets (or with `null` clears) the stage of every listed job that is
 * Submitted. An unknown stage id refuses the whole call: guessing what it
 * meant is how the wrong stage gets recorded. Jobs already in the requested
 * stage are left untouched (and not reported as updated), so a repeated
 * request does not churn `stageChangedAt`.
 */
export function setJobsStage(jobIds: readonly string[], stageId: string | null): SetJobStageResult {
  if (stageId !== null && !getStage(stageId)) {
    throw new StageError('stageNotFound', `No stage with id ${stageId}.`)
  }
  const db = getDb()
  const uniqueIds = [...new Set(jobIds)]
  const changedIds: string[] = []
  const skippedIds: string[] = []
  const now = nowIso()
  db.transaction((tx) => {
    for (const id of uniqueIds) {
      const row = tx.select({ id: jobs.id, status: jobs.status, stageId: jobs.stageId }).from(jobs).where(eq(jobs.id, id)).get()
      if (!row || row.status !== 'submitted') {
        skippedIds.push(id)
        continue
      }
      if (row.stageId === stageId) continue
      tx.update(jobs).set({ stageId, stageChangedAt: now, updatedAt: now }).where(eq(jobs.id, id)).run()
      changedIds.push(id)
    }
  })
  const updated = changedIds.map((id) => getJob(id)).filter((job): job is JobRecord => job !== null)
  return { updated, skippedIds }
}

/**
 * Submitted jobs per stage, every stage listed (zero included) in display
 * order, then the "no stage" bucket. A job whose stage id matches no stage
 * is counted as "no stage" and logged, the same reading every other consumer
 * gives it.
 */
export function countSubmittedByStage(): StageCount[] {
  const db = getDb()
  const rows = db
    .select({ stageId: jobs.stageId, count: sql<number>`count(*)` })
    .from(jobs)
    .where(eq(jobs.status, 'submitted'))
    .groupBy(jobs.stageId)
    .all()
  const stages = listStages()
  const known = new Set(stages.map((stage) => stage.id))
  let none = 0
  let dangling = 0
  const byStage = new Map<string, number>()
  for (const row of rows) {
    if (row.stageId === null) none += row.count
    else if (known.has(row.stageId)) byStage.set(row.stageId, row.count)
    else {
      dangling += row.count
      none += row.count
    }
  }
  if (dangling > 0) appLogger.warn(`${dangling} submitted job(s) point at an unknown stage; counted as having no stage`)
  return [...stages.map((stage) => ({ stageId: stage.id, count: byStage.get(stage.id) ?? 0 })), { stageId: null, count: none }]
}

// --- export / import -----------------------------------------------------

/** Every stage in order, built-ins by id and customs by label (ids are minted per install). */
export function exportableStages(): ExportApplicationStage[] {
  return listStages().map((stage) =>
    stage.isBuiltin ? { kind: 'builtin', id: stage.id, position: stage.position } : { kind: 'custom', name: stage.label, position: stage.position }
  )
}

/** How a job names its stage in an export; null for none or for an id no stage has. */
export function stageRefFor(stageId: string | null, stagesById: ReadonlyMap<string, ApplicationStage>): ExportJobStageRef | null {
  if (stageId === null) return null
  const stage = stagesById.get(stageId)
  if (!stage) return null
  return stage.isBuiltin ? { kind: 'builtin', id: stage.id } : { kind: 'custom', name: stage.label }
}

/**
 * Merges an export's stages into this install. Custom stages match by name
 * (case-insensitively): an existing one is kept as it is, a new one is
 * appended after the local stages in the bundle's order. Built-in entries
 * only carry order, and the local order wins, since importing a backup
 * should not quietly rearrange a board the user already set up. A name this
 * install cannot take (invalid, or past the custom-stage ceiling) is
 * skipped and counted.
 */
export function importStages(entries: readonly ExportApplicationStage[]): { imported: number; skipped: number } {
  let imported = 0
  let skipped = 0
  const customs = [...entries]
    .filter((entry): entry is Extract<ExportApplicationStage, { kind: 'custom' }> => entry.kind === 'custom')
    .sort((a, b) => a.position - b.position)
  for (const entry of customs) {
    if (findStage(entry.name)) continue
    try {
      createStage(entry.name)
      imported++
    } catch (err) {
      if (!(err instanceof StageError)) throw err
      appLogger.warn(`Skipped importing the stage "${entry.name}": ${err.message}`)
      skipped++
    }
  }
  return { imported, skipped }
}

/**
 * Re-creates job stages from an export, where a job is identified by its URL
 * and a stage by built-in id or custom name. Only Submitted jobs with no
 * stage yet are touched, the same rule `linkVariantsByName` follows: a job
 * that already existed here keeps its own stage. A reference that matches
 * nothing is counted, not an error.
 */
export function linkJobStages(links: ReadonlyArray<{ jobUrl: string; stage: ExportJobStageRef }>): {
  linked: number
  unresolved: number
} {
  const db = getDb()
  const stages = listStages()
  let linked = 0
  let unresolved = 0
  for (const link of links) {
    const ref = link.stage
    const stage =
      ref.kind === 'builtin'
        ? (stages.find((item) => item.isBuiltin && item.id === ref.id) ?? null)
        : findStageByReference(
            stages.filter((item) => !item.isBuiltin),
            ref.name
          )
    const job = db
      .select({ id: jobs.id, status: jobs.status, stageId: jobs.stageId })
      .from(jobs)
      .where(eq(jobs.url, link.jobUrl))
      .get()
    if (!stage || !job || job.status !== 'submitted') {
      unresolved++
      continue
    }
    if (job.stageId !== null) continue
    db.update(jobs).set({ stageId: stage.id, stageChangedAt: nowIso() }).where(eq(jobs.id, job.id)).run()
    linked++
  }
  return { linked, unresolved }
}
