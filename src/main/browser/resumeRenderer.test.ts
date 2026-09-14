import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

const browserMocks = vi.hoisted(() => ({ newHeadlessContext: vi.fn() }))
vi.mock('./browserController', () => ({ newHeadlessContext: browserMocks.newHeadlessContext }))

beforeEach(() => {
  testDb = createTestDb().db
  browserMocks.newHeadlessContext.mockReset()
})

import { renderResumePdf, resolveResumeAttachment, resumeFileName } from './resumeRenderer'
import { assignVariant, deleteVariant, saveMasterResume, saveVariant } from '../db/repositories/resumeRepository'
import { setResumeSettings, setStorageMode } from '../db/repositories/settingsRepository'
import { queueJob } from '../db/repositories/jobsRepository'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'

function fakeContext(): { page: { setContent: ReturnType<typeof vi.fn>; pdf: ReturnType<typeof vi.fn> }; close: ReturnType<typeof vi.fn> } {
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4'))
  }
  const close = vi.fn().mockResolvedValue(undefined)
  browserMocks.newHeadlessContext.mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page), close })
  return { page, close }
}

describe('renderResumePdf', () => {
  it('renders the template HTML in a fresh headless context and closes it', async () => {
    const { page, close } = fakeContext()
    const bytes = await renderResumePdf(SAMPLE_RESUME_CONTENT, 'modern', 'a4')
    expect(bytes.toString()).toBe('%PDF-1.4')
    const html = page.setContent.mock.calls[0]![0] as string
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Alex Morgan')
    expect(html).toContain('size: 8.27in 11.69in')
    expect(page.pdf).toHaveBeenCalledWith({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes the context when rendering throws, and surfaces the error', async () => {
    const { page, close } = fakeContext()
    page.pdf.mockRejectedValue(new Error('pdf unsupported'))
    await expect(renderResumePdf(SAMPLE_RESUME_CONTENT, 'classic', 'letter')).rejects.toThrow('pdf unsupported')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('propagates a browser that could not be obtained', async () => {
    browserMocks.newHeadlessContext.mockRejectedValue(new Error('Browser download was declined'))
    await expect(renderResumePdf(SAMPLE_RESUME_CONTENT, 'classic', 'letter')).rejects.toThrow('declined')
  })
})

describe('resolveResumeAttachment', () => {
  beforeEach(() => setStorageMode('plaintext'))

  it('is the original upload when no master exists, whatever the fallback setting', () => {
    setResumeSettings({ fallbackAttachment: 'master', autoTailor: false })
    expect(resolveResumeAttachment('any')).toEqual({ kind: 'original' })
  })

  it('prefers the variant, then the master fallback, then the original', () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'compact', pageSize: 'a4' })
    expect(resolveResumeAttachment(job.id)).toEqual({ kind: 'original' })

    setResumeSettings({ fallbackAttachment: 'master', autoTailor: false })
    expect(resolveResumeAttachment(job.id)).toMatchObject({ kind: 'master', templateId: 'compact', pageSize: 'a4' })

    const variant = saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })
    // A variant that exists but is not assigned changes nothing.
    expect(resolveResumeAttachment(job.id)).toMatchObject({ kind: 'master' })
    assignVariant(job.id, variant.id)
    expect(resolveResumeAttachment(job.id)).toMatchObject({
      kind: 'variant',
      name: 'Backend',
      templateId: 'modern',
      pageSize: 'a4',
      stale: false
    })
    // Another job still gets the fallback until it is assigned the same variant.
    const other = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/other' }).job
    expect(resolveResumeAttachment(other.id)).toMatchObject({ kind: 'master' })
    assignVariant(other.id, variant.id)
    expect(resolveResumeAttachment(other.id)).toMatchObject({ kind: 'variant', name: 'Backend' })
    // Unassigning goes back to the fallback; deleting the variant does too.
    assignVariant(other.id, null)
    expect(resolveResumeAttachment(other.id)).toMatchObject({ kind: 'master' })
    deleteVariant(variant.id)
    expect(resolveResumeAttachment(job.id)).toMatchObject({ kind: 'master' })
  })

  it('marks a variant stale once the master changed after it', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    assignVariant(job.id, saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT }).id)
    await new Promise((resolve) => setTimeout(resolve, 2))
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })
    expect(resolveResumeAttachment(job.id)).toMatchObject({ kind: 'variant', stale: true })
  })
})

describe('resumeFileName', () => {
  it('uses the full name and strips characters a filesystem or ATS rejects', () => {
    expect(resumeFileName(SAMPLE_RESUME_CONTENT)).toBe('Alex Morgan - Resume.pdf')
    const odd = structuredClone(SAMPLE_RESUME_CONTENT)
    odd.header.fullName = '  J/o:h*n  "Q" <Doe>|  '
    expect(resumeFileName(odd)).toBe('J o h n Q Doe - Resume.pdf')
    odd.header.fullName = ''
    expect(resumeFileName(odd)).toBe('Resume.pdf')
    odd.header.fullName = 'x'.repeat(200)
    expect(resumeFileName(odd).length).toBeLessThan(100)
  })
})
