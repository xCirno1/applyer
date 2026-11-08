import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { createTestDb, createTestDbAt, migrateTestDb } from '../testDb'
import * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database.Database
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  const created = createTestDb()
  testDb = created.db
  testSqlite = created.sqlite
})

import {
  StageError,
  countJobsInStage,
  countSubmittedByStage,
  createStage,
  deleteStage,
  exportableStages,
  findStage,
  getStage,
  importStages,
  linkJobStages,
  listStages,
  renameStage,
  reorderStages,
  setJobsStage,
  stageRefFor
} from './applicationStagesRepository'
import { repairDanglingStageRefs, seedBuiltinStages } from '../applicationStageSeed'
import { getJob, listJobs, queueJob, retry, setFailed, setFilled, setSubmitted } from './jobsRepository'
import { BUILTIN_STAGE_IDS, MAX_CUSTOM_STAGES, STAGE_LABEL_MAX_LENGTH } from '@shared/types/applicationStage'

let urlCounter = 0
function submittedJob(): string {
  const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: `https://example.com/${++urlCounter}` })
  setFilled(job.id)
  setSubmitted(job.id)
  return job.id
}

function queuedJob(): string {
  return queueJob({ title: 'Engineer', company: 'Acme', url: `https://example.com/${++urlCounter}` }).job.id
}

function expectStageError(fn: () => unknown, code: StageError['code']): void {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(StageError)
    expect((err as StageError).code).toBe(code)
    return
  }
  throw new Error(`expected a StageError with code ${code}`)
}

describe('migration 0013 (application stages)', () => {
  it('seeds the built-in stages in order on a fresh database', () => {
    expect(listStages()).toEqual(
      BUILTIN_STAGE_IDS.map((id, position) => expect.objectContaining({ id, isBuiltin: true, position }))
    )
  })

  it('adds the stage columns to existing jobs as null, and the foreign key clears a deleted stage', () => {
    const { db, sqlite } = createTestDbAt(12)
    sqlite.prepare("INSERT INTO jobs (id, title, company, url, status) VALUES ('j1','Engineer','Acme','u1','submitted')").run()
    migrateTestDb(db)

    expect(sqlite.prepare("SELECT stage_id, stage_changed_at FROM jobs WHERE id = 'j1'").get()).toEqual({
      stage_id: null,
      stage_changed_at: null
    })
    expect(sqlite.prepare('SELECT id FROM application_stages ORDER BY position').all()).toEqual(
      BUILTIN_STAGE_IDS.map((id) => ({ id }))
    )

    sqlite.prepare("INSERT INTO application_stages (id, label, is_builtin, position) VALUES ('s1','Phone screen',0,5)").run()
    sqlite.prepare("UPDATE jobs SET stage_id = 's1' WHERE id = 'j1'").run()
    sqlite.prepare("DELETE FROM application_stages WHERE id = 's1'").run()
    expect(sqlite.prepare("SELECT stage_id FROM jobs WHERE id = 'j1'").get()).toEqual({ stage_id: null })
    // And the foreign key is live: an unknown stage cannot be written.
    expect(() => sqlite.prepare("UPDATE jobs SET stage_id = 'ghost' WHERE id = 'j1'").run()).toThrow()
  })
})

describe('seedBuiltinStages / repairDanglingStageRefs', () => {
  it('re-creates a missing built-in at the end of the order and is idempotent', () => {
    testSqlite.pragma('foreign_keys = OFF')
    testDb.delete(schema.applicationStages).where(eq(schema.applicationStages.id, 'offer')).run()
    testSqlite.pragma('foreign_keys = ON')
    seedBuiltinStages(testDb)
    seedBuiltinStages(testDb)
    const stages = listStages()
    expect(stages).toHaveLength(BUILTIN_STAGE_IDS.length)
    expect(stages.at(-1)).toMatchObject({ id: 'offer', isBuiltin: true, label: 'Offer' })
  })

  it('restores the built-in flag on a hand-edited row', () => {
    testDb.update(schema.applicationStages).set({ isBuiltin: false, label: 'Mine now' }).where(eq(schema.applicationStages.id, 'rejected')).run()
    seedBuiltinStages(testDb)
    expect(getStage('rejected')).toMatchObject({ isBuiltin: true, label: 'Rejected' })
  })

  it('clears job stages pointing at a stage that is gone, leaving valid ones', () => {
    const dangling = submittedJob()
    const valid = submittedJob()
    setJobsStage([valid], 'offer')
    testSqlite.pragma('foreign_keys = OFF')
    testDb.update(schema.jobs).set({ stageId: 'ghost' }).where(eq(schema.jobs.id, dangling)).run()
    testSqlite.pragma('foreign_keys = ON')

    expect(repairDanglingStageRefs(testDb)).toBe(1)
    expect(getJob(dangling)?.stageId).toBeNull()
    expect(getJob(valid)?.stageId).toBe('offer')
    expect(repairDanglingStageRefs(testDb)).toBe(0)
  })
})

describe('createStage', () => {
  it('appends a custom stage after the built-ins, normalising its label', () => {
    const stage = createStage('  Phone   screen ')
    expect(stage).toMatchObject({ label: 'Phone screen', isBuiltin: false, position: BUILTIN_STAGE_IDS.length })
    expect(listStages().at(-1)?.id).toBe(stage.id)
  })

  it('refuses an invalid label', () => {
    expectStageError(() => createStage('   '), 'invalidStageName')
    expectStageError(() => createStage('x'.repeat(STAGE_LABEL_MAX_LENGTH + 1)), 'invalidStageName')
    expectStageError(() => createStage(undefined), 'invalidStageName')
  })

  it('refuses a name already taken by a custom or built-in stage, case-insensitively', () => {
    createStage('Phone screen')
    expectStageError(() => createStage('PHONE SCREEN'), 'stageNameTaken')
    expectStageError(() => createStage('offer'), 'stageNameTaken')
    expectStageError(() => createStage('awaiting_response'), 'stageNameTaken')
  })

  it('stops at the custom-stage ceiling', () => {
    for (let i = 0; i < MAX_CUSTOM_STAGES; i++) createStage(`Stage ${i}`)
    expectStageError(() => createStage('One too many'), 'stageLimitReached')
    expect(listStages()).toHaveLength(BUILTIN_STAGE_IDS.length + MAX_CUSTOM_STAGES)
  })
})

describe('renameStage', () => {
  it('renames a custom stage, allowing a case-only change', () => {
    const stage = createStage('Phone screen')
    expect(renameStage(stage.id, 'Phone Screen').label).toBe('Phone Screen')
    expect(renameStage(stage.id, 'Recruiter call').label).toBe('Recruiter call')
    expect(getStage(stage.id)?.label).toBe('Recruiter call')
  })

  it('refuses built-ins, unknown ids, clashes and invalid labels', () => {
    const a = createStage('A')
    createStage('B')
    expectStageError(() => renameStage('offer', 'Offer letter'), 'stageBuiltinLocked')
    expectStageError(() => renameStage('ghost', 'Whatever'), 'stageNotFound')
    expectStageError(() => renameStage(a.id, 'b'), 'stageNameTaken')
    expectStageError(() => renameStage(a.id, ''), 'invalidStageName')
    expect(getStage(a.id)?.label).toBe('A')
  })
})

describe('reorderStages', () => {
  it('stores a new order, built-ins included', () => {
    const custom = createStage('Phone screen')
    const order = [custom.id, ...BUILTIN_STAGE_IDS.slice().reverse()]
    expect(reorderStages(order).map((stage) => stage.id)).toEqual(order)
    expect(listStages().map((stage) => stage.id)).toEqual(order)
    expect(listStages().map((stage) => stage.position)).toEqual(order.map((_, index) => index))
  })

  it('tolerates a partial or stale order', () => {
    const custom = createStage('Phone screen')
    const result = reorderStages(['ghost', custom.id])
    expect(result.map((stage) => stage.id)).toEqual([custom.id, ...BUILTIN_STAGE_IDS])
  })
})

describe('setJobsStage', () => {
  it('sets and clears the stage of Submitted jobs, stamping when it changed', () => {
    const id = submittedJob()
    const set = setJobsStage([id], 'interviewing')
    expect(set.updated.map((job) => job.id)).toEqual([id])
    expect(set.updated[0]).toMatchObject({ stageId: 'interviewing', stageChangedAt: expect.any(String) })
    expect(setJobsStage([id], null).updated[0]?.stageId).toBeNull()
  })

  it('skips jobs that are missing or not Submitted, and does not report an unchanged job', () => {
    const submitted = submittedJob()
    const queued = queuedJob()
    const result = setJobsStage([submitted, queued, 'ghost', submitted], 'offer')
    expect(result.updated.map((job) => job.id)).toEqual([submitted])
    expect(result.skippedIds).toEqual([queued, 'ghost'])
    expect(getJob(queued)?.stageId).toBeNull()
    expect(setJobsStage([submitted], 'offer').updated).toEqual([])
  })

  it('refuses an unknown stage and writes nothing', () => {
    const id = submittedJob()
    expectStageError(() => setJobsStage([id], 'ghost'), 'stageNotFound')
    expect(getJob(id)?.stageId).toBeNull()
  })
})

describe('deleteStage', () => {
  it('moves the jobs in a deleted stage back to no stage and keeps positions dense', () => {
    const phone = createStage('Phone screen')
    const onsite = createStage('Onsite')
    const a = submittedJob()
    const b = submittedJob()
    setJobsStage([a, b], phone.id)
    expect(countJobsInStage(phone.id)).toBe(2)

    const result = deleteStage(phone.id)
    expect(result.removed).toBe(true)
    expect(result.clearedJobs.map((job) => job.id).sort()).toEqual([a, b].sort())
    expect(result.clearedJobs.every((job) => job.stageId === null)).toBe(true)
    expect(getStage(phone.id)).toBeNull()
    expect(getStage(onsite.id)?.position).toBe(BUILTIN_STAGE_IDS.length)
  })

  it('works even when the connection has foreign keys off', () => {
    const phone = createStage('Phone screen')
    const a = submittedJob()
    setJobsStage([a], phone.id)
    testSqlite.pragma('foreign_keys = OFF')
    deleteStage(phone.id)
    testSqlite.pragma('foreign_keys = ON')
    expect(getJob(a)?.stageId).toBeNull()
  })

  it('is a no-op for an unknown stage and refuses a built-in one', () => {
    expect(deleteStage('ghost')).toEqual({ removed: false, clearedJobs: [] })
    expectStageError(() => deleteStage('offer'), 'stageBuiltinLocked')
    expect(getStage('offer')).not.toBeNull()
  })
})

describe('countSubmittedByStage', () => {
  it('counts every stage in order, zeros included, then the no-stage bucket', () => {
    const phone = createStage('Phone screen')
    const a = submittedJob()
    const b = submittedJob()
    submittedJob()
    queuedJob()
    setJobsStage([a], phone.id)
    setJobsStage([b], 'offer')

    const counts = countSubmittedByStage()
    expect(counts.map((entry) => entry.stageId)).toEqual([...BUILTIN_STAGE_IDS, phone.id, null])
    expect(counts.find((entry) => entry.stageId === 'offer')?.count).toBe(1)
    expect(counts.find((entry) => entry.stageId === phone.id)?.count).toBe(1)
    expect(counts.find((entry) => entry.stageId === 'rejected')?.count).toBe(0)
    expect(counts.at(-1)).toEqual({ stageId: null, count: 1 })
  })

  it('counts a job pointing at an unknown stage as having no stage', () => {
    const a = submittedJob()
    testSqlite.pragma('foreign_keys = OFF')
    testDb.update(schema.jobs).set({ stageId: 'ghost' }).where(eq(schema.jobs.id, a)).run()
    testSqlite.pragma('foreign_keys = ON')
    expect(countSubmittedByStage().at(-1)).toEqual({ stageId: null, count: 1 })
  })
})

describe('job records and listing', () => {
  it('lists Submitted jobs by stage, or with none', () => {
    const a = submittedJob()
    const b = submittedJob()
    setJobsStage([a], 'interviewing')
    expect(listJobs({ status: 'submitted', stageId: 'interviewing' }).jobs.map((job) => job.id)).toEqual([a])
    expect(listJobs({ status: 'submitted', stageId: null }).jobs.map((job) => job.id)).toEqual([b])
    expect(listJobs({ status: 'submitted' }).total).toBe(2)
  })

  it('never shows a stage on a job that is not Submitted', () => {
    const id = queuedJob()
    setFailed(id, 'other')
    testDb.update(schema.jobs).set({ stageId: 'offer' }).where(eq(schema.jobs.id, id)).run()
    expect(getJob(id)?.stageId).toBeNull()
    retry(id)
    expect(getJob(id)?.stageId).toBeNull()
  })
})

describe('findStage', () => {
  it('finds by id, built-in id or label', () => {
    const phone = createStage('Phone screen')
    expect(findStage(phone.id)?.id).toBe(phone.id)
    expect(findStage('phone screen')?.id).toBe(phone.id)
    expect(findStage('Interviewing')?.id).toBe('interviewing')
    expect(findStage('nope')).toBeNull()
  })
})

describe('export and import', () => {
  it('exports built-ins by id and customs by name, and names a job stage the same way', () => {
    const phone = createStage('Phone screen')
    expect(exportableStages().at(-1)).toEqual({ kind: 'custom', name: 'Phone screen', position: BUILTIN_STAGE_IDS.length })
    expect(exportableStages()[0]).toEqual({ kind: 'builtin', id: 'awaiting_response', position: 0 })
    const byId = new Map(listStages().map((stage) => [stage.id, stage]))
    expect(stageRefFor('offer', byId)).toEqual({ kind: 'builtin', id: 'offer' })
    expect(stageRefFor(phone.id, byId)).toEqual({ kind: 'custom', name: 'Phone screen' })
    expect(stageRefFor(null, byId)).toBeNull()
    expect(stageRefFor('ghost', byId)).toBeNull()
  })

  it('merges custom stages by name, appending new ones in the bundle order', () => {
    createStage('Onsite')
    const result = importStages([
      { kind: 'builtin', id: 'offer', position: 0 },
      { kind: 'custom', name: 'Take-home', position: 7 },
      { kind: 'custom', name: 'onsite', position: 6 },
      { kind: 'custom', name: 'Phone screen', position: 5 }
    ])
    expect(result).toEqual({ imported: 2, skipped: 0 })
    expect(listStages().slice(BUILTIN_STAGE_IDS.length).map((stage) => stage.label)).toEqual(['Onsite', 'Phone screen', 'Take-home'])
    // Built-in order on this install is left alone.
    expect(listStages()[0]?.id).toBe('awaiting_response')
  })

  it('skips custom stages past the ceiling rather than failing the import', () => {
    for (let i = 0; i < MAX_CUSTOM_STAGES; i++) createStage(`Stage ${i}`)
    expect(importStages([{ kind: 'custom', name: 'Extra', position: 0 }])).toEqual({ imported: 0, skipped: 1 })
  })

  it('links Submitted jobs without a stage, counting what does not resolve', () => {
    const phone = createStage('Phone screen')
    const a = submittedJob()
    const b = submittedJob()
    const kept = submittedJob()
    const queued = queuedJob()
    setJobsStage([kept], 'rejected')
    const url = (id: string): string => getJob(id)!.url

    const result = linkJobStages([
      { jobUrl: url(a), stage: { kind: 'builtin', id: 'offer' } },
      { jobUrl: url(b), stage: { kind: 'custom', name: 'PHONE SCREEN' } },
      { jobUrl: url(kept), stage: { kind: 'builtin', id: 'offer' } },
      { jobUrl: url(queued), stage: { kind: 'builtin', id: 'offer' } },
      { jobUrl: 'https://example.com/missing', stage: { kind: 'builtin', id: 'offer' } },
      // A custom name never resolves to a built-in, even one with that label.
      { jobUrl: url(a), stage: { kind: 'custom', name: 'Offer' } }
    ])
    expect(result).toEqual({ linked: 2, unresolved: 3 })
    expect(getJob(a)?.stageId).toBe('offer')
    expect(getJob(b)?.stageId).toBe(phone.id)
    expect(getJob(kept)?.stageId).toBe('rejected')
    expect(getJob(queued)?.stageId).toBeNull()
  })
})
