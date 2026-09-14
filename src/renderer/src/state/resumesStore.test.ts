// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import type { JobRecord } from '@shared/types/job'
import type { MasterResume, ResumeVariant, ResumeVariantSummary } from '@shared/types/resume'

const api = {
  getMaster: vi.fn(),
  saveMaster: vi.fn(),
  deleteMaster: vi.fn(),
  listVariants: vi.fn(),
  getVariant: vi.fn(),
  saveVariant: vi.fn(),
  deleteVariant: vi.fn(),
  assignVariant: vi.fn(),
  exportPdf: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn()
}
let onChangedHandlers: (() => void)[] = []

function master(): MasterResume {
  return {
    content: SAMPLE_RESUME_CONTENT,
    templateId: 'classic',
    pageSize: 'letter',
    style: {},
    sourceDocumentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function summary(id: string, name: string, jobIds: string[] = [], stale = false): ResumeVariantSummary {
  return {
    id,
    name,
    templateId: 'classic',
    updatedAt: '2026-01-02T00:00:00.000Z',
    stale,
    jobCount: jobIds.length,
    jobs: jobIds.map((jobId) => ({ id: jobId, title: 'Engineer', company: 'Acme', status: 'queued' as const }))
  }
}

function variant(id: string, name: string): ResumeVariant & { stale: boolean } {
  return {
    id,
    name,
    content: SAMPLE_RESUME_CONTENT,
    templateId: 'classic',
    basedOnMasterUpdatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    stale: false
  }
}

function job(id: string, resumeVariantId: string | null): JobRecord {
  return {
    id,
    externalId: null,
    source: null,
    title: 'Engineer',
    company: 'Acme',
    location: null,
    url: `https://example.com/${id}`,
    description: null,
    salaryRange: null,
    status: 'queued',
    matchScore: null,
    matchReasons: null,
    applicationUrl: null,
    applyMethod: null,
    screenshotPath: null,
    screenshotPaths: [],
    failureTag: null,
    failureMessage: null,
    blockingReason: null,
    blockingTaskId: null,
    queuedAt: '2026-01-01T00:00:00.000Z',
    filledAt: null,
    submittedAt: null,
    resumeVariantId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

beforeEach(() => {
  vi.resetModules()
  for (const fn of Object.values(api)) fn.mockReset()
  onChangedHandlers = []
  api.getMaster.mockResolvedValue({ master: master() })
  api.listVariants.mockResolvedValue({
    variants: [summary('v-1', 'Backend', ['job-1', 'job-2']), summary('v-2', 'Concise', [], true)]
  })
  api.getSettings.mockResolvedValue({ settings: { fallbackAttachment: 'master', autoTailor: true } })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      resumes: {
        ...api,
        onChanged: (callback: () => void) => {
          onChangedHandlers.push(callback)
          return () => {
            onChangedHandlers = onChangedHandlers.filter((h) => h !== callback)
          }
        }
      }
    }
  })
})

describe('resumesStore', () => {
  it('fetches master, variants and settings together and indexes variants by job', async () => {
    const { useResumesStore } = await import('./resumesStore')
    expect(useResumesStore.getState().loadedOnce).toBe(false)
    await useResumesStore.getState().fetch()
    const state = useResumesStore.getState()
    expect(state.master?.templateId).toBe('classic')
    expect(state.variants).toHaveLength(2)
    expect(state.variantIdByJob.get('job-1')).toBe('v-1')
    expect(state.variantIdByJob.get('job-2')).toBe('v-1')
    expect(state.variantIdByJob.has('job-3')).toBe(false)
    expect(state.settings).toEqual({ fallbackAttachment: 'master', autoTailor: true })
    expect(state.loading).toBe(false)
    expect(state.loadedOnce).toBe(true)
  })

  it('survives a master read that throws and a malformed variant list', async () => {
    api.getMaster.mockRejectedValue(new Error('keychain unavailable'))
    api.listVariants.mockResolvedValue({ variants: 'nope' })
    const { useResumesStore } = await import('./resumesStore')
    await useResumesStore.getState().fetch()
    const state = useResumesStore.getState()
    expect(state.master).toBeNull()
    expect(state.variants).toEqual([])
    expect(state.loadedOnce).toBe(true)

    api.listVariants.mockResolvedValue({ variants: [summary('v-1', 'Backend'), { id: 'broken' }, null] })
    await useResumesStore.getState().fetch()
    expect(useResumesStore.getState().variants.map((item) => item.id)).toEqual(['v-1'])
  })

  it('caches variant content per id until the next fetch', async () => {
    api.getVariant.mockResolvedValue({ variant: variant('v-1', 'Backend') })
    const { useResumesStore } = await import('./resumesStore')
    expect(await useResumesStore.getState().loadVariant('v-1')).toMatchObject({ name: 'Backend' })
    expect(await useResumesStore.getState().loadVariant('v-1')).toMatchObject({ name: 'Backend' })
    expect(api.getVariant).toHaveBeenCalledTimes(1)
    expect(api.getVariant).toHaveBeenCalledWith('v-1')
    await useResumesStore.getState().fetch()
    await useResumesStore.getState().loadVariant('v-1')
    expect(api.getVariant).toHaveBeenCalledTimes(2)
  })

  it('applies successful writes locally and passes failures through', async () => {
    const { useResumesStore } = await import('./resumesStore')
    await useResumesStore.getState().fetch()

    api.saveMaster.mockResolvedValue({ ok: true, value: { ...master(), templateId: 'modern' } })
    const saved = await useResumesStore.getState().saveMaster({ content: SAMPLE_RESUME_CONTENT, templateId: 'modern' })
    expect(saved.ok).toBe(true)
    expect(useResumesStore.getState().master?.templateId).toBe('modern')

    api.saveVariant.mockResolvedValue({ ok: false, error: { code: 'variantNameTaken', params: { name: 'Backend' } } })
    const failed = await useResumesStore.getState().saveVariant({ id: 'v-2', name: 'backend' })
    expect(failed).toEqual({ ok: false, error: { code: 'variantNameTaken', params: { name: 'Backend' } } })

    // A rename patches the summary in place, keeping its job links; a new
    // variant is appended until the refetch orders it.
    api.saveVariant.mockResolvedValue({ ok: true, value: { ...variant('v-1', 'Backend (detailed)'), templateId: 'modern' } })
    await useResumesStore.getState().saveVariant({ id: 'v-1', name: 'Backend (detailed)', templateId: 'modern' })
    expect(useResumesStore.getState().variants[0]).toMatchObject({ id: 'v-1', name: 'Backend (detailed)', templateId: 'modern', jobCount: 2 })
    expect(useResumesStore.getState().variantsById['v-1']?.name).toBe('Backend (detailed)')
    api.saveVariant.mockResolvedValue({ ok: true, value: variant('v-3', 'Research') })
    await useResumesStore.getState().saveVariant({ name: 'Research', content: SAMPLE_RESUME_CONTENT })
    expect(useResumesStore.getState().variants.map((item) => item.name)).toEqual(['Backend (detailed)', 'Concise', 'Research'])

    api.deleteVariant.mockResolvedValue({ ok: true, value: { unassignedJobs: 2 } })
    useResumesStore.getState().select('v-1')
    const deleted = await useResumesStore.getState().deleteVariant('v-1')
    expect(deleted).toEqual({ ok: true, value: { unassignedJobs: 2 } })
    expect(useResumesStore.getState().variantIdByJob.has('job-1')).toBe(false)
    expect(useResumesStore.getState().variants.map((item) => item.id)).toEqual(['v-2', 'v-3'])
    expect(useResumesStore.getState().selectedVariantId).toBeNull()
    expect(useResumesStore.getState().variantsById['v-1']).toBeUndefined()

    api.deleteMaster.mockResolvedValue({ ok: true, value: null })
    await useResumesStore.getState().deleteMaster()
    expect(useResumesStore.getState().master).toBeNull()
    expect(useResumesStore.getState().variants).toEqual([])
    expect(useResumesStore.getState().variantIdByJob.size).toBe(0)
  })

  it('moves a job between variants on assignment and back to none on unassignment', async () => {
    const { useResumesStore } = await import('./resumesStore')
    await useResumesStore.getState().fetch()

    api.assignVariant.mockResolvedValue({ ok: true, value: job('job-1', 'v-2') })
    const result = await useResumesStore.getState().assignVariant('job-1', 'v-2')
    expect(result.ok).toBe(true)
    expect(api.assignVariant).toHaveBeenCalledWith('job-1', 'v-2')
    let state = useResumesStore.getState()
    expect(state.variantIdByJob.get('job-1')).toBe('v-2')
    expect(state.variants.find((item) => item.id === 'v-1')).toMatchObject({ jobCount: 1, jobs: [{ id: 'job-2' }] })
    expect(state.variants.find((item) => item.id === 'v-2')).toMatchObject({ jobCount: 1, jobs: [{ id: 'job-1' }] })

    api.assignVariant.mockResolvedValue({ ok: true, value: job('job-3', 'v-2') })
    await useResumesStore.getState().assignVariant('job-3', 'v-2')
    expect(useResumesStore.getState().variants.find((item) => item.id === 'v-2')?.jobs.map((item) => item.id)).toEqual(['job-3', 'job-1'])

    api.assignVariant.mockResolvedValue({ ok: true, value: job('job-1', null) })
    await useResumesStore.getState().assignVariant('job-1', null)
    state = useResumesStore.getState()
    expect(state.variantIdByJob.has('job-1')).toBe(false)
    expect(state.variants.find((item) => item.id === 'v-2')).toMatchObject({ jobCount: 1, jobs: [{ id: 'job-3' }] })

    api.assignVariant.mockResolvedValue({ ok: false, error: { code: 'variantNotFound' } })
    expect(await useResumesStore.getState().assignVariant('job-1', 'gone')).toEqual({ ok: false, error: { code: 'variantNotFound' } })
    expect(useResumesStore.getState().variantIdByJob.has('job-1')).toBe(false)
  })

  it('turns a rejected bridge call into a typed failure', async () => {
    api.setSettings.mockRejectedValue(new Error('bridge down'))
    api.assignVariant.mockRejectedValue(new Error('bridge down'))
    const { useResumesStore } = await import('./resumesStore')
    const result = await useResumesStore.getState().setSettings({ fallbackAttachment: 'original', autoTailor: false })
    expect(result).toEqual({ ok: false, error: { code: 'unexpected' } })
    expect(await useResumesStore.getState().assignVariant('job-1', 'v-1')).toEqual({ ok: false, error: { code: 'unexpected' } })
  })

  it('refetches on the change signal and unsubscribes cleanly', async () => {
    const { useResumesStore } = await import('./resumesStore')
    const unsubscribe = useResumesStore.getState().subscribeToUpdates()
    expect(onChangedHandlers).toHaveLength(1)
    onChangedHandlers[0]!()
    await vi.waitFor(() => expect(useResumesStore.getState().loadedOnce).toBe(true))
    unsubscribe()
    expect(onChangedHandlers).toHaveLength(0)
  })
})
