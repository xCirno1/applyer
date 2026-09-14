import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { IPC } from '@shared/types/ipcEvents'
import { createTestDb } from '../db/testDb'
import { __invokeIpc, __resetElectronMock } from '../../../test/mocks/electron'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

const mocks = vi.hoisted(() => ({
  broadcastResumesChanged: vi.fn(),
  broadcastJobUpdate: vi.fn(),
  writeAgentInstructions: vi.fn(),
  renderResumePdf: vi.fn(),
  showSaveDialog: vi.fn()
}))
vi.mock('./jobsBroadcast', () => ({
  broadcastResumesChanged: mocks.broadcastResumesChanged,
  broadcastJobUpdate: mocks.broadcastJobUpdate
}))
vi.mock('../config/agentInstructions', () => ({ writeAgentInstructions: mocks.writeAgentInstructions }))
vi.mock('../browser/resumeRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../browser/resumeRenderer')>()),
  renderResumePdf: mocks.renderResumePdf
}))
vi.mock('electron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('electron')>()),
  dialog: { showSaveDialog: mocks.showSaveDialog }
}))

import { registerResumesIpc } from './resumes'
import { getMasterResume, getVariant, getVariantByJob, saveMasterResume, saveVariant } from '../db/repositories/resumeRepository'
import { getResumeSettings, setStorageMode } from '../db/repositories/settingsRepository'
import { queueJob } from '../db/repositories/jobsRepository'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let registered = false

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
  setStorageMode('plaintext')
  mocks.broadcastResumesChanged.mockReset()
  mocks.broadcastJobUpdate.mockReset()
  mocks.writeAgentInstructions.mockReset()
  mocks.renderResumePdf.mockReset()
  mocks.showSaveDialog.mockReset()
  // The electron mock throws on double registration, as Electron does; the
  // reset clears handlers, so register once per test after it.
  registerResumesIpc()
  registered = true
})

function trackJob(): string {
  return queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' }).job.id
}

describe('resumes IPC', () => {
  it('saves and returns the master, broadcasting on write', async () => {
    expect(registered).toBe(true)
    expect(__invokeIpc(IPC.resumes.getMaster)).toEqual({ master: null })
    const result = __invokeIpc(IPC.resumes.saveMaster, {
      content: SAMPLE_RESUME_CONTENT,
      templateId: 'modern',
      pageSize: 'a4'
    }) as { ok: boolean; value?: { templateId: string } }
    expect(result.ok).toBe(true)
    expect(result.value?.templateId).toBe('modern')
    expect((__invokeIpc(IPC.resumes.getMaster) as { master: { pageSize: string } }).master.pageSize).toBe('a4')
    expect(mocks.broadcastResumesChanged).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid content with a typed error and no write', () => {
    const shape = __invokeIpc(IPC.resumes.saveMaster, { content: { header: {} } }) as { ok: boolean; error: { code: string } }
    expect(shape).toMatchObject({ ok: false, error: { code: 'invalidResumeData' } })
    const duplicate = structuredClone(SAMPLE_RESUME_CONTENT)
    duplicate.sections[1]!.id = duplicate.sections[0]!.id
    const dup = __invokeIpc(IPC.resumes.saveMaster, { content: duplicate }) as { ok: boolean; error: { code: string; params?: { message: string } } }
    expect(dup.error.code).toBe('invalidResumeData')
    expect(dup.error.params?.message).toContain('Duplicate')
    expect(getMasterResume()).toBeNull()
    expect(mocks.broadcastResumesChanged).not.toHaveBeenCalled()
  })

  it('saves, renames, assigns and deletes variants, mapping repository errors to codes', () => {
    const jobId = trackJob()
    const noMaster = __invokeIpc(IPC.resumes.saveVariant, { name: 'Backend', content: SAMPLE_RESUME_CONTENT }) as { ok: boolean; error: { code: string } }
    expect(noMaster).toMatchObject({ ok: false, error: { code: 'masterResumeMissing' } })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const noName = __invokeIpc(IPC.resumes.saveVariant, { name: '  ', content: SAMPLE_RESUME_CONTENT }) as { ok: boolean; error: { code: string } }
    expect(noName).toMatchObject({ ok: false, error: { code: 'invalidResumeData' } })
    const noContent = __invokeIpc(IPC.resumes.saveVariant, { name: 'Backend' }) as { ok: boolean; error: { code: string } }
    expect(noContent).toMatchObject({ ok: false, error: { code: 'invalidResumeData' } })
    expect(mocks.broadcastResumesChanged).not.toHaveBeenCalled()

    const saved = __invokeIpc(IPC.resumes.saveVariant, { name: 'Backend', content: SAMPLE_RESUME_CONTENT, templateId: 'compact' }) as {
      ok: boolean
      value: { id: string; name: string; stale: boolean; templateId: string }
    }
    expect(saved.ok).toBe(true)
    expect(saved.value).toMatchObject({ name: 'Backend', stale: false, templateId: 'compact' })
    expect(mocks.broadcastResumesChanged).toHaveBeenCalledTimes(1)
    const variantId = saved.value.id
    expect((__invokeIpc(IPC.resumes.getVariant, { id: variantId }) as { variant: { stale: boolean } }).variant.stale).toBe(false)
    expect((__invokeIpc(IPC.resumes.getVariant, { id: 'x' }) as { variant: unknown }).variant).toBeNull()

    // Rename without content keeps the content.
    const renamed = __invokeIpc(IPC.resumes.saveVariant, { id: variantId, name: 'Backend (detailed)' }) as { ok: boolean; value: { name: string } }
    expect(renamed).toMatchObject({ ok: true, value: { name: 'Backend (detailed)' } })
    expect(getVariant(variantId)?.content).toEqual(SAMPLE_RESUME_CONTENT)
    __invokeIpc(IPC.resumes.saveVariant, { name: 'Concise', content: SAMPLE_RESUME_CONTENT })
    const clash = __invokeIpc(IPC.resumes.saveVariant, { id: variantId, name: 'concise' }) as { ok: boolean; error: { code: string; params?: { name: string } } }
    expect(clash).toMatchObject({ ok: false, error: { code: 'variantNameTaken', params: { name: 'Concise' } } })
    // A create (no id) under a taken name is refused too, rather than replacing by name like the agent's tool does.
    const create = __invokeIpc(IPC.resumes.saveVariant, { name: 'CONCISE', content: SAMPLE_RESUME_CONTENT }) as { ok: boolean; error: { code: string } }
    expect(create).toMatchObject({ ok: false, error: { code: 'variantNameTaken' } })
    expect(__invokeIpc(IPC.resumes.saveVariant, { id: 'missing', name: 'X' })).toMatchObject({ ok: false, error: { code: 'variantNotFound' } })

    const list = (__invokeIpc(IPC.resumes.listVariants) as { variants: Array<{ name: string; jobCount: number }> }).variants
    expect(list.map((variant) => variant.name)).toEqual(['Backend (detailed)', 'Concise'])

    // Assignment broadcasts the job and the variant list.
    mocks.broadcastJobUpdate.mockClear()
    mocks.broadcastResumesChanged.mockClear()
    const assigned = __invokeIpc(IPC.resumes.assignVariant, { jobId, variantId }) as { ok: boolean; value: { resumeVariantId: string | null } }
    expect(assigned).toMatchObject({ ok: true, value: { id: jobId, resumeVariantId: variantId } })
    expect(mocks.broadcastJobUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.broadcastResumesChanged).toHaveBeenCalledTimes(1)
    expect(getVariantByJob(jobId)?.id).toBe(variantId)
    expect((__invokeIpc(IPC.resumes.listVariants) as { variants: Array<{ jobCount: number; jobs: Array<{ id: string }> }> }).variants[0]).toMatchObject({
      jobCount: 1,
      jobs: [{ id: jobId }]
    })
    expect(__invokeIpc(IPC.resumes.assignVariant, { jobId, variantId: 'missing' })).toMatchObject({ ok: false, error: { code: 'variantNotFound' } })
    expect(__invokeIpc(IPC.resumes.assignVariant, { jobId: 'missing', variantId })).toMatchObject({ ok: false, error: { code: 'jobNotFound' } })
    expect(__invokeIpc(IPC.resumes.assignVariant, { jobId, variantId: null })).toMatchObject({ ok: true, value: { resumeVariantId: null } })
    __invokeIpc(IPC.resumes.assignVariant, { jobId, variantId })

    expect(__invokeIpc(IPC.resumes.deleteVariant, { id: variantId })).toEqual({ ok: true, value: { unassignedJobs: 1 } })
    expect(getVariant(variantId)).toBeNull()
    expect(getVariantByJob(jobId)).toBeNull()
    expect(__invokeIpc(IPC.resumes.deleteVariant, { id: variantId })).toEqual({ ok: true, value: { unassignedJobs: 0 } })
  })

  it('deleting the master also clears variants', () => {
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT })
    expect(__invokeIpc(IPC.resumes.deleteMaster)).toEqual({ ok: true, value: null })
    expect(getMasterResume()).toBeNull()
    expect((__invokeIpc(IPC.resumes.listVariants) as { variants: unknown[] }).variants).toEqual([])
  })

  it('settings round-trip and rewrite the agent instructions', () => {
    expect(__invokeIpc(IPC.resumes.getSettings)).toEqual({ settings: { fallbackAttachment: 'original', autoTailor: false } })
    const result = __invokeIpc(IPC.resumes.setSettings, { fallbackAttachment: 'master', autoTailor: true })
    expect(result).toEqual({ ok: true, value: { fallbackAttachment: 'master', autoTailor: true } })
    expect(getResumeSettings()).toEqual({ fallbackAttachment: 'master', autoTailor: true })
    expect(mocks.writeAgentInstructions).toHaveBeenCalledTimes(1)
    expect(__invokeIpc(IPC.resumes.setSettings, { fallbackAttachment: 'nope', autoTailor: true })).toMatchObject({
      ok: false,
      error: { code: 'invalidResumeData' }
    })
  })

  it('exports a PDF through the save dialog, and reports render failures', async () => {
    expect(await __invokeIpc(IPC.resumes.exportPdf, { target: { kind: 'master' } })).toMatchObject({
      ok: false,
      error: { code: 'masterResumeMissing' }
    })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'classic' })
    const variant = saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })

    mocks.showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await __invokeIpc(IPC.resumes.exportPdf, { target: { kind: 'master' } })).toEqual({ ok: false, canceled: true })
    expect(mocks.renderResumePdf).not.toHaveBeenCalled()
    expect(mocks.showSaveDialog.mock.calls[0]![0]).toMatchObject({ defaultPath: expect.stringContaining('Alex Morgan - Resume.pdf') })

    const filePath = join(tmpdir(), `applyer-resume-test-${Date.now()}.pdf`)
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    mocks.renderResumePdf.mockResolvedValue(Buffer.from('%PDF-1.4 variant'))
    expect(await __invokeIpc(IPC.resumes.exportPdf, { target: { kind: 'variant', id: variant.id } })).toEqual({ ok: true, filePath })
    expect(mocks.renderResumePdf).toHaveBeenCalledWith(SAMPLE_RESUME_CONTENT, 'modern', 'letter', {})
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, 'utf-8')).toBe('%PDF-1.4 variant')

    expect(await __invokeIpc(IPC.resumes.exportPdf, { target: { kind: 'variant', id: 'missing' } })).toMatchObject({
      ok: false,
      error: { code: 'variantNotFound' }
    })

    mocks.renderResumePdf.mockRejectedValue(new Error('no browser'))
    expect(await __invokeIpc(IPC.resumes.exportPdf, { target: { kind: 'master' } })).toMatchObject({
      ok: false,
      error: { code: 'resumeRenderFailed' }
    })
  })
})
