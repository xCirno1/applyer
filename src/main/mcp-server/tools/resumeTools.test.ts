import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { z } from 'zod'
import { createTestDb } from '../../db/testDb'
import { __resetElectronMock } from '../../../../test/mocks/electron'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

const broadcastResumesChanged = vi.fn()
const broadcastJobUpdate = vi.fn()
vi.mock('../../ipc/jobsBroadcast', () => ({
  broadcastResumesChanged: (): void => broadcastResumesChanged(),
  broadcastJobUpdate: (job: unknown): void => broadcastJobUpdate(job)
}))

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
  broadcastResumesChanged.mockClear()
  broadcastJobUpdate.mockClear()
})

import { getResumeTool } from './getResume'
import { setMasterResumeTool } from './setMasterResume'
import { saveResumeVariantTool } from './saveResumeVariant'
import { assignResumeTool } from './assignResume'
import { deleteResumeVariantTool } from './deleteResumeVariant'
import {
  assignResumeShape,
  deleteResumeVariantShape,
  getResumeShape,
  saveResumeVariantShape,
  setMasterResumeShape
} from '../schemas'
import {
  assignVariant,
  getMasterResume,
  getVariantByJob,
  getVariantByName,
  saveMasterResume,
  saveVariant
} from '../../db/repositories/resumeRepository'
import { markOnboardingCompleted, setResumeSettings, setStorageMode } from '../../db/repositories/settingsRepository'
import { addDocument } from '../../db/repositories/documentsRepository'
import { listActivity } from '../../db/repositories/activityLogRepository'
import { getJob, queueJob } from '../../db/repositories/jobsRepository'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import type { ResumeContent } from '@shared/types/resume'

function parse(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return (result.content[0] as { text: string }).text
}

function ready(): void {
  setStorageMode('plaintext')
  markOnboardingCompleted()
}

function trackJob(url = 'https://example.com/job/1'): string {
  return queueJob({ title: 'Payments Engineer', company: 'Northwind', url }).job.id
}

function tailored(): ResumeContent {
  const content = structuredClone(SAMPLE_RESUME_CONTENT)
  content.header.headline = 'Payments Engineer'
  content.sections = content.sections.filter((section) => section.id !== 's-certs')
  return content
}

describe('get_resume', () => {
  it('requires onboarding', async () => {
    const result = await getResumeTool({ jobId: undefined })
    expect(result.isError).toBe(true)
  })

  it('explains how to build a master when none exists, naming the uploaded resume', async () => {
    ready()
    const upload = await addDocument({
      kind: 'resume',
      originalFilename: 'jane.txt',
      mimeType: 'text/plain',
      data: Buffer.from('Jane Doe, engineer')
    })
    const result = await getResumeTool({ jobId: undefined })
    expect(result.isError).toBeUndefined()
    const body = parse(result)
    expect(body.master).toBeNull()
    expect(body.variants).toEqual([])
    expect(body.message).toContain('jane.txt')
    expect(body.message).toContain(upload.id)
    expect(body.settings).toEqual({ fallbackAttachment: 'original', autoTailor: false })
  })

  it('returns the master and the variant list, and with a jobId the assigned variant with staleness and diff summary', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'compact' })
    const jobId = trackJob()
    const backend = saveVariant({ name: 'Backend', content: tailored() })
    saveVariant({ name: 'Concise', content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })

    const withoutVariant = parse(await getResumeTool({ jobId }))
    expect(withoutVariant.variant).toBeNull()
    expect(withoutVariant.willAttach).toBe('original')
    expect((withoutVariant.master as { templateId: string }).templateId).toBe('compact')
    expect(withoutVariant.variants).toEqual([
      { name: 'Backend', templateId: 'compact', stale: false, updatedAt: backend.updatedAt, jobsUsing: [] },
      expect.objectContaining({ name: 'Concise', templateId: 'modern', jobsUsing: [] })
    ])

    assignVariant(jobId, backend.id)
    const withVariant = parse(await getResumeTool({ jobId }))
    const variant = withVariant.variant as { name: string; stale: boolean; diffSummary: { removed: number } }
    expect(variant.name).toBe('Backend')
    expect(variant.stale).toBe(false)
    expect(variant.diffSummary.removed).toBeGreaterThan(0)
    expect(withVariant.willAttach).toBe('variant')
    expect(withVariant.job).toMatchObject({ title: 'Payments Engineer', company: 'Northwind' })
    expect((withVariant.variants as Array<{ jobsUsing: Array<{ id: string }> }>)[0]!.jobsUsing).toEqual([
      { id: jobId, title: 'Payments Engineer', company: 'Northwind', status: 'queued' }
    ])
  })

  it('rejects an unknown job id', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const result = await getResumeTool({ jobId: 'nope' })
    expect(result.isError).toBe(true)
  })
})

describe('set_master_resume', () => {
  it('saves valid content, records activity, and broadcasts', async () => {
    ready()
    const result = await setMasterResumeTool({ content: SAMPLE_RESUME_CONTENT, templateId: 'modern', pageSize: 'a4', sourceDocumentId: undefined })
    expect(result.isError).toBeUndefined()
    expect(parse(result)).toMatchObject({ status: 'saved', templateId: 'modern', pageSize: 'a4', staleVariants: 0 })
    expect(getMasterResume()?.content).toEqual(SAMPLE_RESUME_CONTENT)
    expect(broadcastResumesChanged).toHaveBeenCalledTimes(1)
    expect(listActivity({}).entries.some((entry) => entry.message.includes('saved the master resume'))).toBe(true)
  })

  it('refuses duplicate ids and an unknown source document', async () => {
    ready()
    const duplicate = structuredClone(SAMPLE_RESUME_CONTENT)
    duplicate.sections[1]!.id = duplicate.sections[0]!.id
    const result = await setMasterResumeTool({ content: duplicate, templateId: undefined, pageSize: undefined, sourceDocumentId: undefined })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Duplicate ids')

    const missingSource = await setMasterResumeTool({ content: SAMPLE_RESUME_CONTENT, templateId: undefined, pageSize: undefined, sourceDocumentId: 'missing' })
    expect(missingSource.isError).toBe(true)
    expect(getMasterResume()).toBeNull()
    expect(broadcastResumesChanged).not.toHaveBeenCalled()
  })

  it('reports how many variants went stale', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    saveVariant({ name: 'Backend', content: tailored() })
    await new Promise((resolve) => setTimeout(resolve, 2))
    const result = parse(await setMasterResumeTool({ content: tailored(), templateId: undefined, pageSize: undefined, sourceDocumentId: undefined }))
    expect(result.staleVariants).toBe(1)
    expect(result.message).toContain('save_resume_variant')
  })

  it('the tool schemas reject over-limit content and empty names before the handlers run', () => {
    const schema = z.object(setMasterResumeShape)
    expect(schema.safeParse({ content: SAMPLE_RESUME_CONTENT }).success).toBe(true)
    expect(schema.safeParse({ content: { header: { fullName: '', contacts: [] }, sections: [] } }).success).toBe(false)
    expect(schema.safeParse({ content: SAMPLE_RESUME_CONTENT, templateId: 'gothic' }).success).toBe(false)
    expect(z.object(getResumeShape).safeParse({}).success).toBe(true)
    const save = z.object(saveResumeVariantShape)
    expect(save.safeParse({ content: SAMPLE_RESUME_CONTENT }).success).toBe(false)
    expect(save.safeParse({ name: '   ', content: SAMPLE_RESUME_CONTENT }).success).toBe(false)
    expect(save.safeParse({ name: 'x'.repeat(81), content: SAMPLE_RESUME_CONTENT }).success).toBe(false)
    expect(save.safeParse({ name: '  Backend  focused ', content: SAMPLE_RESUME_CONTENT }).data?.name).toBe('Backend focused')
    const assign = z.object(assignResumeShape)
    expect(assign.safeParse({ jobId: 'j' }).success).toBe(true)
    expect(assign.safeParse({ jobId: 'j', variantName: null }).success).toBe(true)
    expect(assign.safeParse({ jobId: 'j', variantName: '' }).success).toBe(false)
    expect(z.object(deleteResumeVariantShape).safeParse({ name: 'Backend' }).success).toBe(true)
    expect(z.object(deleteResumeVariantShape).safeParse({ jobId: 'j' }).success).toBe(false)
  })
})

describe('save_resume_variant', () => {
  it('requires a master, and a tracked job when assignJobId is given', async () => {
    ready()
    const noMaster = await saveResumeVariantTool({ name: 'Backend', content: tailored(), templateId: undefined, assignJobId: undefined })
    expect(noMaster.isError).toBe(true)
    expect(text(noMaster)).toContain('set_master_resume')

    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const noJob = await saveResumeVariantTool({ name: 'Backend', content: tailored(), templateId: undefined, assignJobId: 'nope' })
    expect(noJob.isError).toBe(true)
    expect(text(noJob)).toContain('queue_job')
    expect(getVariantByName('Backend')).toBeNull()
  })

  it('creates a variant that only reuses master ids, with a diff summary, and assigns it in the same call', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const jobId = trackJob()
    const result = await saveResumeVariantTool({ name: 'Backend', content: tailored(), templateId: 'modern', assignJobId: jobId })
    expect(result.isError).toBeUndefined()
    const body = parse(result)
    expect(body).toMatchObject({ status: 'created', name: 'Backend', templateId: 'modern', assignedJobId: jobId, jobsUsing: 1 })
    expect((body.diffSummary as { removed: number }).removed).toBeGreaterThan(0)
    expect(getVariantByJob(jobId)?.content.header.headline).toBe('Payments Engineer')
    expect(getJob(jobId)?.resumeVariantId).toBe(getVariantByName('Backend')?.id)
    expect(broadcastResumesChanged).toHaveBeenCalledTimes(1)
    expect(broadcastJobUpdate).toHaveBeenCalledTimes(1)
    expect(listActivity({ jobId }).entries.some((entry) => entry.message.includes('assigned it to Payments Engineer'))).toBe(true)
  })

  it('creates an unassigned variant when no job is given', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const body = parse(await saveResumeVariantTool({ name: 'Concise', content: tailored(), templateId: undefined, assignJobId: undefined }))
    expect(body).toMatchObject({ status: 'created', name: 'Concise', assignedJobId: null, jobsUsing: 0 })
    expect(broadcastJobUpdate).not.toHaveBeenCalled()
  })

  it('refuses invented entries and groups, naming the ids', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const invented = tailored()
    invented.sections.push({
      id: 's-more',
      title: 'More experience',
      layout: { kind: 'entries', entries: [{ id: 'e-fake', title: 'CTO', subtitle: 'Made Up Inc', bullets: [] }] }
    })
    const skills = invented.sections.find((section) => section.id === 's-skills')!
    if (skills.layout.kind === 'groups') skills.layout.groups.push({ id: 'g-fake', label: 'Leadership', items: ['x'] })

    const result = await saveResumeVariantTool({ name: 'Backend', content: invented, templateId: undefined, assignJobId: undefined })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('e-fake')
    expect(text(result)).toContain('g-fake')
    expect(getVariantByName('Backend')).toBeNull()
    expect(broadcastResumesChanged).not.toHaveBeenCalled()
    expect(listActivity({ level: 'warn' }).entries.length).toBe(1)
  })

  it('allows added text/list sections and moving entries between sections', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const content = tailored()
    content.sections.unshift({ id: 's-highlights', title: 'Highlights', layout: { kind: 'list', items: ['Ledger service'] } })
    const result = await saveResumeVariantTool({ name: 'Backend', content, templateId: undefined, assignJobId: undefined })
    expect(result.isError).toBeUndefined()
  })

  it('replaces an existing variant by name (case-insensitively) for every job using it', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const jobA = trackJob('https://example.com/job/a')
    const jobB = trackJob('https://example.com/job/b')
    await saveResumeVariantTool({ name: 'Backend', content: tailored(), templateId: undefined, assignJobId: jobA })
    assignVariant(jobB, getVariantByName('Backend')!.id)
    const first = getVariantByName('Backend')!
    const body = parse(await saveResumeVariantTool({ name: 'backend', content: SAMPLE_RESUME_CONTENT, templateId: undefined, assignJobId: undefined }))
    expect(body).toMatchObject({ status: 'replaced', jobsUsing: 2 })
    expect(body.message).toContain('2 job(s)')
    const second = getVariantByName('Backend')!
    expect(second.id).toBe(first.id)
    expect(second.content).toEqual(SAMPLE_RESUME_CONTENT)
    expect(getVariantByJob(jobB)?.content).toEqual(SAMPLE_RESUME_CONTENT)
  })
})

describe('assign_resume', () => {
  it('assigns an existing variant by name, reporting staleness, and unassigns with no name', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    setResumeSettings({ fallbackAttachment: 'master', autoTailor: false })
    const jobId = trackJob()
    const backend = saveVariant({ name: 'Backend', content: tailored() })

    const assigned = parse(await assignResumeTool({ jobId, variantName: 'backend' }))
    expect(assigned).toMatchObject({ status: 'assigned', jobId, variant: { name: 'Backend', stale: false }, willAttach: 'variant' })
    expect(getJob(jobId)?.resumeVariantId).toBe(backend.id)
    expect(broadcastResumesChanged).toHaveBeenCalledTimes(1)
    expect(broadcastJobUpdate).toHaveBeenCalledTimes(1)

    await new Promise((resolve) => setTimeout(resolve, 2))
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })
    const stale = parse(await assignResumeTool({ jobId, variantName: 'Backend' }))
    expect((stale.variant as { stale: boolean }).stale).toBe(true)
    expect(stale.message).toContain('older master')

    const unassigned = parse(await assignResumeTool({ jobId, variantName: undefined }))
    expect(unassigned).toMatchObject({ status: 'unassigned', variant: null, willAttach: 'master' })
    expect(getJob(jobId)?.resumeVariantId).toBeNull()
    expect(parse(await assignResumeTool({ jobId, variantName: null })).status).toBe('unassigned')
  })

  it('lists the existing variants when the name is unknown, and rejects an unknown job', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const jobId = trackJob()
    const none = await assignResumeTool({ jobId, variantName: 'Nope' })
    expect(none.isError).toBe(true)
    expect(text(none)).toContain('no variants exist yet')

    saveVariant({ name: 'Backend', content: tailored() })
    saveVariant({ name: 'Concise', content: tailored() })
    const some = await assignResumeTool({ jobId, variantName: 'Nope' })
    expect(some.isError).toBe(true)
    expect(text(some)).toContain('"Backend", "Concise"')
    expect(getJob(jobId)?.resumeVariantId).toBeNull()

    expect((await assignResumeTool({ jobId: 'nope', variantName: 'Backend' })).isError).toBe(true)
  })
})

describe('delete_resume_variant', () => {
  it('removes the variant by name, says how many jobs lost it, and broadcasts each of them', async () => {
    ready()
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    setResumeSettings({ fallbackAttachment: 'master', autoTailor: false })
    const jobA = trackJob('https://example.com/job/a')
    const jobB = trackJob('https://example.com/job/b')
    const backend = saveVariant({ name: 'Backend', content: tailored() })
    assignVariant(jobA, backend.id)
    assignVariant(jobB, backend.id)

    const removed = parse(await deleteResumeVariantTool({ name: 'BACKEND' }))
    expect(removed).toMatchObject({ status: 'removed', name: 'Backend', unassignedJobs: 2, willAttach: 'master' })
    expect(removed.message).toContain('master resume')
    expect(getVariantByName('Backend')).toBeNull()
    expect(getJob(jobA)?.resumeVariantId).toBeNull()
    expect(broadcastResumesChanged).toHaveBeenCalledTimes(1)
    expect(broadcastJobUpdate).toHaveBeenCalledTimes(2)

    const again = parse(await deleteResumeVariantTool({ name: 'Backend' }))
    expect(again.status).toBe('not_found')
    expect(broadcastResumesChanged).toHaveBeenCalledTimes(1)
  })

  it('requires onboarding', async () => {
    expect((await deleteResumeVariantTool({ name: 'Backend' })).isError).toBe(true)
  })
})
