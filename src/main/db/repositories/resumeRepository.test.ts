import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { createTestDb, createTestDbAt, migrateTestDb } from '../testDb'
import { __resetElectronMock } from '../../../../test/mocks/electron'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
})

import {
  ResumeVariantError,
  assignVariant,
  countVariants,
  deleteMasterResume,
  deleteVariant,
  getMasterResume,
  getVariant,
  getVariantByJob,
  getVariantByName,
  hasMasterResume,
  importResumes,
  isVariantStale,
  linkVariantsByName,
  listAllVariants,
  listJobsUsingVariant,
  listVariantSummaries,
  rewriteResumeStorageMode,
  saveMasterResume,
  saveVariant
} from './resumeRepository'
import { getResumeSettings, setResumeSettings, setStorageMode } from './settingsRepository'
import { getJob, queueJob, removeJob } from './jobsRepository'
import { appSettings, resumeMaster, resumeVariants } from '../schema'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import type { ResumeContent } from '@shared/types/resume'

function tailored(): ResumeContent {
  const content = structuredClone(SAMPLE_RESUME_CONTENT)
  content.header.headline = 'Payments Engineer'
  return content
}

function trackJob(url = 'https://example.com/job/1'): string {
  return queueJob({ title: 'Engineer', company: 'Acme', url }).job.id
}

async function tick(): Promise<void> {
  // `updatedAt` is millisecond ISO text; two writes in the same millisecond would compare equal.
  await new Promise((resolve) => setTimeout(resolve, 2))
}

describe('master resume', () => {
  it('is absent until saved, then round-trips content, template, page size and source', () => {
    setStorageMode('plaintext')
    expect(hasMasterResume()).toBe(false)
    expect(getMasterResume()).toBeNull()

    const saved = saveMasterResume({
      content: SAMPLE_RESUME_CONTENT,
      templateId: 'modern',
      pageSize: 'a4',
      sourceDocumentId: 'doc-1'
    })
    expect(saved.content).toEqual(SAMPLE_RESUME_CONTENT)
    expect(saved.templateId).toBe('modern')
    expect(saved.pageSize).toBe('a4')
    expect(saved.sourceDocumentId).toBe('doc-1')
    expect(getMasterResume()).toEqual(saved)
  })

  it('keeps template, page size and source on a content-only save, and clears the source on null', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'compact', pageSize: 'a4', sourceDocumentId: 'doc-1' })
    const second = saveMasterResume({ content: tailored() })
    expect(second.templateId).toBe('compact')
    expect(second.pageSize).toBe('a4')
    expect(second.sourceDocumentId).toBe('doc-1')
    expect(second.content.header.headline).toBe('Payments Engineer')
    expect(saveMasterResume({ content: tailored(), sourceDocumentId: null }).sourceDocumentId).toBeNull()
  })

  it('encrypts the payload in encrypted mode and leaves no plaintext in the row', () => {
    setStorageMode('encrypted')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const row = testDb.select().from(resumeMaster).where(eq(resumeMaster.id, 1)).get()!
    expect(row.securePayload.startsWith('enc:v1:')).toBe(true)
    expect(row.securePayload).not.toContain('Alex Morgan')
    expect(row.securePayload).not.toContain('Northwind')
    expect(getMasterResume()?.content).toEqual(SAMPLE_RESUME_CONTENT)
  })

  it('stores plain JSON in plaintext mode', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const row = testDb.select().from(resumeMaster).where(eq(resumeMaster.id, 1)).get()!
    expect(row.securePayload.startsWith('{')).toBe(true)
    expect(row.securePayload).toContain('Alex Morgan')
  })

  it('defaults to encrypted when no storage mode was ever chosen', () => {
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const row = testDb.select().from(resumeMaster).where(eq(resumeMaster.id, 1)).get()!
    expect(row.securePayload.startsWith('enc:v1:')).toBe(true)
  })

  it('rejects a corrupt payload instead of returning an empty resume', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    testDb.update(resumeMaster).set({ securePayload: '{"header": 5}' }).where(eq(resumeMaster.id, 1)).run()
    expect(() => getMasterResume()).toThrow(/invalid or corrupted/)
    testDb.update(resumeMaster).set({ securePayload: 'not json' }).where(eq(resumeMaster.id, 1)).run()
    expect(() => getMasterResume()).toThrow(/invalid or corrupted/)
  })

  it('falls back to classic/letter when the plain columns hold unknown values', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    testDb.update(resumeMaster).set({ templateId: 'gothic', pageSize: 'tabloid' }).where(eq(resumeMaster.id, 1)).run()
    expect(getMasterResume()).toMatchObject({ templateId: 'classic', pageSize: 'letter' })
  })

  it('round-trips the typography style, keeps it on a content-only save, and survives a corrupt column', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    expect(getMasterResume()?.style).toEqual({})

    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, style: { fontFamily: 'garamond', fontSize: 11.5 } })
    expect(getMasterResume()?.style).toEqual({ fontFamily: 'garamond', fontSize: 11.5 })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    expect(getMasterResume()?.style).toEqual({ fontFamily: 'garamond', fontSize: 11.5 })

    // Out-of-range or unknown values are snapped/dropped on the way in, and
    // an empty style returns to the template's own typography.
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, style: { fontFamily: 'wingdings' as never, fontSize: 40 } })
    expect(getMasterResume()?.style).toEqual({ fontSize: 14 })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, style: {} })
    expect(getMasterResume()?.style).toEqual({})

    testDb.update(resumeMaster).set({ style: '{not json' }).where(eq(resumeMaster.id, 1)).run()
    expect(getMasterResume()?.style).toEqual({})
    testDb.update(resumeMaster).set({ style: '[1,2]' }).where(eq(resumeMaster.id, 1)).run()
    expect(getMasterResume()?.style).toEqual({})
  })

  it('deleting the master removes every variant too', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    saveVariant({ name: 'Backend', content: tailored() })
    expect(countVariants()).toBe(1)
    deleteMasterResume()
    expect(hasMasterResume()).toBe(false)
    expect(countVariants()).toBe(0)
  })
})

describe('resume variants', () => {
  it('requires a master, a name, and content for a new variant', () => {
    setStorageMode('plaintext')
    expect(() => saveVariant({ name: 'Backend', content: tailored() })).toThrow(ResumeVariantError)
    try {
      saveVariant({ name: 'Backend', content: tailored() })
    } catch (err) {
      expect((err as ResumeVariantError).code).toBe('masterResumeMissing')
    }
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    try {
      saveVariant({ name: '   ', content: tailored() })
      expect.unreachable()
    } catch (err) {
      expect((err as ResumeVariantError).code).toBe('invalidResumeData')
    }
    try {
      saveVariant({ name: 'Backend' })
      expect.unreachable()
    } catch (err) {
      expect((err as ResumeVariantError).code).toBe('invalidResumeData')
    }
    expect(countVariants()).toBe(0)
  })

  it('creates by name, inheriting the master template by default, and replaces on the same name case-insensitively', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'compact' })
    const first = saveVariant({ name: '  Backend   focused ', content: tailored() })
    expect(first.name).toBe('Backend focused')
    expect(first.templateId).toBe('compact')

    const second = saveVariant({ name: 'backend FOCUSED', content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })
    expect(second.id).toBe(first.id)
    // The stored name is the one from the latest save.
    expect(second.name).toBe('backend FOCUSED')
    expect(second.templateId).toBe('modern')
    expect(second.createdAt).toBe(first.createdAt)
    expect(countVariants()).toBe(1)
    expect(getVariant(first.id)?.content).toEqual(SAMPLE_RESUME_CONTENT)
    expect(getVariantByName('BACKEND focused')?.id).toBe(first.id)
    expect(getVariantByName('nope')).toBeNull()
    // A template-less re-save keeps the variant's own template, not the master's.
    expect(saveVariant({ name: 'Backend focused', content: tailored() }).templateId).toBe('modern')
  })

  it('folds non-ASCII names when matching, so accented names cannot be created twice', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const first = saveVariant({ name: 'Résumé', content: tailored() })
    expect(getVariantByName('RÉSUMÉ')?.id).toBe(first.id)
    // A decomposed accent (e + combining acute) is the same name too.
    expect(getVariantByName('Re\u0301sume\u0301')?.id).toBe(first.id)
    expect(saveVariant({ name: 'RÉSUMÉ', content: SAMPLE_RESUME_CONTENT }).id).toBe(first.id)
    expect(countVariants()).toBe(1)
  })

  it('rejects a taken name instead of replacing when asked to', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const backend = saveVariant({ name: 'Backend', content: tailored() })
    try {
      saveVariant({ name: 'backend', content: SAMPLE_RESUME_CONTENT, onNameTaken: 'reject' })
      expect.unreachable()
    } catch (err) {
      expect((err as ResumeVariantError).code).toBe('variantNameTaken')
      expect((err as ResumeVariantError).params).toEqual({ name: 'Backend' })
    }
    expect(getVariant(backend.id)?.content.header.headline).toBe('Payments Engineer')
    expect(countVariants()).toBe(1)
    // Same option, unused name: an ordinary create.
    expect(saveVariant({ name: 'Concise', content: SAMPLE_RESUME_CONTENT, onNameTaken: 'reject' }).name).toBe('Concise')
  })

  it('updates by id: rename and template change keep the content and the stale stamp, and a clashing rename is refused', async () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const backend = saveVariant({ name: 'Backend', content: tailored() })
    const concise = saveVariant({ name: 'Concise', content: SAMPLE_RESUME_CONTENT })

    await tick()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })
    expect(isVariantStale(getVariant(backend.id)!)).toBe(true)

    const renamed = saveVariant({ id: backend.id, name: 'Backend (detailed)', templateId: 'compact' })
    expect(renamed.id).toBe(backend.id)
    expect(renamed.name).toBe('Backend (detailed)')
    expect(renamed.templateId).toBe('compact')
    expect(renamed.content.header.headline).toBe('Payments Engineer')
    expect(renamed.basedOnMasterUpdatedAt).toBe(backend.basedOnMasterUpdatedAt)
    expect(isVariantStale(renamed)).toBe(true)
    expect(getVariantByName('Backend')).toBeNull()

    // Content written by id refreshes the stamp.
    const refreshed = saveVariant({ id: backend.id, name: 'Backend (detailed)', content: tailored() })
    expect(isVariantStale(refreshed)).toBe(false)

    try {
      saveVariant({ id: backend.id, name: 'concise' })
      expect.unreachable()
    } catch (err) {
      expect((err as ResumeVariantError).code).toBe('variantNameTaken')
      expect((err as ResumeVariantError).params).toEqual({ name: 'Concise' })
    }
    // Renaming onto its own name (different case) is fine.
    expect(saveVariant({ id: concise.id, name: 'CONCISE' }).name).toBe('CONCISE')
    try {
      saveVariant({ id: 'missing', name: 'X', content: tailored() })
      expect.unreachable()
    } catch (err) {
      expect((err as ResumeVariantError).code).toBe('variantNotFound')
    }
  })

  it('encrypts variant payloads independently of the master', () => {
    setStorageMode('encrypted')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const variant = saveVariant({ name: 'Backend', content: tailored() })
    const row = testDb.select().from(resumeVariants).where(eq(resumeVariants.id, variant.id)).get()!
    expect(row.securePayload.startsWith('enc:v1:')).toBe(true)
    expect(row.securePayload).not.toContain('Payments Engineer')
    expect(row.name).toBe('Backend')
    expect(getVariant(variant.id)?.content.header.headline).toBe('Payments Engineer')
  })

  it('assigns variants to jobs, many jobs to one, and reads the variant back through the job', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const backend = saveVariant({ name: 'Backend', content: tailored() })
    const jobA = trackJob('https://example.com/job/a')
    const jobB = trackJob('https://example.com/job/b')

    expect(getVariantByJob(jobA)).toBeNull()
    const assigned = assignVariant(jobA, backend.id)
    expect(assigned.resumeVariantId).toBe(backend.id)
    expect(getJob(jobA)?.resumeVariantId).toBe(backend.id)
    assignVariant(jobB, backend.id)
    expect(getVariantByJob(jobA)?.id).toBe(backend.id)
    expect(getVariantByJob(jobB)?.id).toBe(backend.id)
    expect(listJobsUsingVariant(backend.id).map((job) => job.id).sort()).toEqual([jobA, jobB].sort())

    expect(assignVariant(jobA, null).resumeVariantId).toBeNull()
    expect(getVariantByJob(jobA)).toBeNull()
    expect(getVariantByJob('missing')).toBeNull()

    try {
      assignVariant('missing', backend.id)
      expect.unreachable()
    } catch (err) {
      expect((err as ResumeVariantError).code).toBe('jobNotFound')
    }
    try {
      assignVariant(jobA, 'missing')
      expect.unreachable()
    } catch (err) {
      expect((err as ResumeVariantError).code).toBe('variantNotFound')
    }
  })

  it('lists summaries by name with the jobs using each, without a job join dropping unused variants', async () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const backend = saveVariant({ name: 'backend', content: tailored() })
    const concise = saveVariant({ name: 'Concise', content: SAMPLE_RESUME_CONTENT, templateId: 'compact' })
    const jobA = trackJob('https://example.com/job/a')
    const jobB = trackJob('https://example.com/job/b')
    assignVariant(jobA, backend.id)
    assignVariant(jobB, backend.id)

    const summaries = listVariantSummaries()
    expect(summaries.map((summary) => summary.name)).toEqual(['backend', 'Concise'])
    expect(summaries[0]).toMatchObject({ id: backend.id, templateId: 'classic', stale: false, jobCount: 2 })
    expect(summaries[0]!.jobs.map((job) => job.id).sort()).toEqual([jobA, jobB].sort())
    expect(summaries[0]!.jobs[0]).toMatchObject({ title: 'Engineer', company: 'Acme', status: 'queued' })
    expect(summaries[1]).toEqual({
      id: concise.id,
      name: 'Concise',
      templateId: 'compact',
      updatedAt: concise.updatedAt,
      stale: false,
      jobCount: 0,
      jobs: []
    })

    await tick()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })
    expect(listVariantSummaries().every((summary) => summary.stale)).toBe(true)
    expect(isVariantStale(getVariantByJob(jobA)!)).toBe(true)

    await tick()
    saveVariant({ name: 'Backend', content: tailored() })
    expect(listVariantSummaries().find((summary) => summary.id === backend.id)?.stale).toBe(false)
  })

  it('keeps the variant when a job is removed, and clears the assignment when the variant is deleted', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const backend = saveVariant({ name: 'Backend', content: tailored() })
    const jobA = trackJob('https://example.com/job/a')
    const jobB = trackJob('https://example.com/job/b')
    assignVariant(jobA, backend.id)
    assignVariant(jobB, backend.id)

    removeJob(jobA)
    expect(countVariants()).toBe(1)
    expect(listVariantSummaries()[0]?.jobCount).toBe(1)

    expect(deleteVariant('missing')).toEqual({ removed: false, unassignedJobs: 0 })
    expect(deleteVariant(backend.id)).toEqual({ removed: true, unassignedJobs: 1 })
    expect(getJob(jobB)?.resumeVariantId).toBeNull()
    expect(getVariantByJob(jobB)).toBeNull()
    expect(countVariants()).toBe(0)
    expect(deleteVariant(backend.id)).toEqual({ removed: false, unassignedJobs: 0 })
  })

  it('deleting the master unassigns every job', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const backend = saveVariant({ name: 'Backend', content: tailored() })
    const jobId = trackJob()
    assignVariant(jobId, backend.id)
    deleteMasterResume()
    expect(countVariants()).toBe(0)
    expect(getJob(jobId)?.resumeVariantId).toBeNull()
  })
})

describe('migration 0010 (named variants)', () => {
  it('carries per-job variants over as named variants assigned to their jobs, deduplicating names', () => {
    const { db, sqlite } = createTestDbAt(9)
    sqlite
      .prepare(
        "INSERT INTO jobs (id, title, company, url) VALUES ('j1','Engineer','Acme','u1'),('j2','engineer','ACME','u2'),('j3','Other','X','u3'),('j4','No variant','Y','u4')"
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO resume_variants (id, job_id, secure_payload, template_id, based_on_master_updated_at, created_at) VALUES ('v1','j1','{\"a\":1}','classic','t','2026-01-01'),('v2','j2','{\"a\":2}','modern','t','2026-01-02'),('v3','j3','{\"a\":3}','compact','t','2026-01-03')"
      )
      .run()
    migrateTestDb(db)

    expect(sqlite.prepare('SELECT id, name, secure_payload, template_id FROM resume_variants ORDER BY created_at').all()).toEqual([
      { id: 'v1', name: 'Engineer at Acme', secure_payload: '{"a":1}', template_id: 'classic' },
      { id: 'v2', name: 'engineer at ACME (2)', secure_payload: '{"a":2}', template_id: 'modern' },
      { id: 'v3', name: 'Other at X', secure_payload: '{"a":3}', template_id: 'compact' }
    ])
    expect(sqlite.prepare('SELECT id, resume_variant_id FROM jobs ORDER BY id').all()).toEqual([
      { id: 'j1', resume_variant_id: 'v1' },
      { id: 'j2', resume_variant_id: 'v2' },
      { id: 'j3', resume_variant_id: 'v3' },
      { id: 'j4', resume_variant_id: null }
    ])
    // The new foreign key is live: deleting a variant clears the assignment.
    sqlite.prepare("DELETE FROM resume_variants WHERE id = 'v1'").run()
    expect(sqlite.prepare("SELECT resume_variant_id FROM jobs WHERE id = 'j1'").get()).toEqual({ resume_variant_id: null })
    // And the exact-name index holds.
    expect(() =>
      sqlite
        .prepare("INSERT INTO resume_variants (id, name, secure_payload, template_id, based_on_master_updated_at) VALUES ('v9','Other at X','{}','classic','t')")
        .run()
    ).toThrow(/UNIQUE/)
  })

  it('is a no-op on a database with no variants', () => {
    const { db, sqlite } = createTestDbAt(9)
    sqlite.prepare("INSERT INTO jobs (id, title, company, url) VALUES ('j1','Engineer','Acme','u1')").run()
    migrateTestDb(db)
    expect(sqlite.prepare('SELECT count(*) AS n FROM resume_variants').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('SELECT resume_variant_id FROM jobs').all()).toEqual([{ resume_variant_id: null }])
  })
})

describe('rewriteResumeStorageMode', () => {
  it('re-encodes master and variants both ways without touching updatedAt', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const variant = saveVariant({ name: 'Backend', content: tailored() })
    const masterBefore = getMasterResume()!

    rewriteResumeStorageMode('encrypted')
    expect(testDb.select().from(resumeMaster).get()!.securePayload.startsWith('enc:v1:')).toBe(true)
    expect(testDb.select().from(resumeVariants).get()!.securePayload.startsWith('enc:v1:')).toBe(true)
    expect(getMasterResume()).toEqual(masterBefore)
    expect(getVariant(variant.id)).toEqual(variant)
    expect(listVariantSummaries()[0]?.stale).toBe(false)

    rewriteResumeStorageMode('plaintext')
    expect(testDb.select().from(resumeMaster).get()!.securePayload.startsWith('{')).toBe(true)
    expect(testDb.select().from(resumeVariants).get()!.securePayload.startsWith('{')).toBe(true)
    expect(getVariant(variant.id)).toEqual(variant)
  })

  it('is a no-op with nothing stored', () => {
    expect(() => rewriteResumeStorageMode('encrypted')).not.toThrow()
  })
})

describe('importResumes / listAllVariants / linkVariantsByName', () => {
  it('replaces the master and upserts variants by name', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: tailored() })
    const existing = saveVariant({ name: 'Backend', content: tailored() })
    const result = importResumes({
      master: { content: SAMPLE_RESUME_CONTENT, templateId: 'modern', pageSize: 'a4' },
      variants: [
        { name: 'backend', content: SAMPLE_RESUME_CONTENT, templateId: 'compact' },
        { name: 'Concise', content: tailored(), templateId: 'classic' }
      ]
    })
    expect(result).toEqual({ imported: 3, skipped: 0 })
    expect(getMasterResume()).toMatchObject({ templateId: 'modern', pageSize: 'a4', sourceDocumentId: null })
    const all = listAllVariants()
    expect(all.map((variant) => variant.name)).toEqual(['backend', 'Concise'])
    expect(all[0]).toMatchObject({ id: existing.id, templateId: 'compact' })
    expect(all[0]!.content).toEqual(SAMPLE_RESUME_CONTENT)
  })

  it('skips every variant when the bundle has no master and none exists locally', () => {
    setStorageMode('plaintext')
    expect(importResumes({ master: null, variants: [{ name: 'Backend', content: tailored(), templateId: 'classic' }] })).toEqual({
      imported: 0,
      skipped: 1
    })
  })

  it('links jobs to variants by URL and name, leaving existing assignments and counting unknown names', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const backend = saveVariant({ name: 'Backend', content: tailored() })
    const concise = saveVariant({ name: 'Concise', content: SAMPLE_RESUME_CONTENT })
    const jobA = trackJob('https://example.com/job/a')
    const jobB = trackJob('https://example.com/job/b')
    const jobC = trackJob('https://example.com/job/c')
    assignVariant(jobB, concise.id)

    const result = linkVariantsByName([
      { jobUrl: 'https://example.com/job/a', variantName: 'backend' },
      { jobUrl: 'https://example.com/job/b', variantName: 'Backend' },
      { jobUrl: 'https://example.com/job/c', variantName: 'Gone' },
      { jobUrl: 'https://example.com/job/missing', variantName: 'Backend' }
    ])
    expect(result).toEqual({ linked: 1, unresolved: 2 })
    expect(getJob(jobA)?.resumeVariantId).toBe(backend.id)
    expect(getJob(jobB)?.resumeVariantId).toBe(concise.id)
    expect(getJob(jobC)?.resumeVariantId).toBeNull()
  })
})

describe('resume settings', () => {
  it('defaults to original/off and round-trips, ignoring corrupt values field by field', () => {
    expect(getResumeSettings()).toEqual({ fallbackAttachment: 'original', autoTailor: false })
    setResumeSettings({ fallbackAttachment: 'master', autoTailor: true })
    expect(getResumeSettings()).toEqual({ fallbackAttachment: 'master', autoTailor: true })
    testDb.update(appSettings).set({ value: '{"fallbackAttachment":"nope","autoTailor":"yes"}' }).run()
    expect(getResumeSettings()).toEqual({ fallbackAttachment: 'original', autoTailor: false })
  })
})
