// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { JobRecord, ListJobsResult } from '@shared/types/job'

const listMock = vi.fn<(...args: unknown[]) => Promise<ListJobsResult>>()
const getMock = vi.fn<(...args: unknown[]) => Promise<{ job: JobRecord | null }>>()
const onUpdatedHandlers: ((job: JobRecord) => void)[] = []
const onRemovedHandlers: ((payload: { jobId: string }) => void)[] = []

beforeEach(() => {
  // The store is a module-level zustand singleton — reset the module
  // registry so each test's `await import('./jobsStore')` gets a fresh
  // store instead of accumulating state left over from earlier tests.
  vi.resetModules()
  listMock.mockReset()
  getMock.mockReset()
  getMock.mockResolvedValue({ job: null })
  onUpdatedHandlers.length = 0
  onRemovedHandlers.length = 0
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      jobs: {
        list: listMock,
        get: getMock,
        onUpdated: (fn: (job: JobRecord) => void) => {
          onUpdatedHandlers.push(fn)
          return () => {
            const i = onUpdatedHandlers.indexOf(fn)
            if (i >= 0) onUpdatedHandlers.splice(i, 1)
          }
        },
        onRemoved: (fn: (payload: { jobId: string }) => void) => {
          onRemovedHandlers.push(fn)
          return () => {
            const i = onRemovedHandlers.indexOf(fn)
            if (i >= 0) onRemovedHandlers.splice(i, 1)
          }
        }
      }
    }
  })
})

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    externalId: null,
    source: null,
    title: 'Engineer',
    company: 'Acme',
    location: null,
    url: 'https://example.com/1',
    description: null,
    salaryRange: null,
    status: 'queued',
    matchScore: null,
    matchReasons: null,
    applicationUrl: null,
    applyMethod: null,
    screenshotPath: null,
    failureTag: null,
    failureMessage: null,
    blockingReason: null,
    blockingTaskId: null,
    queuedAt: '2026-01-01T00:00:00.000Z',
    filledAt: null,
    submittedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('jobsStore', () => {
  it('fetchColumn populates jobs/total/loading/loadedOnce for the given status', async () => {
    const { useJobsStore } = await import('./jobsStore')
    listMock.mockResolvedValue({ jobs: [job()], total: 1 })

    await useJobsStore.getState().fetchColumn('queued')

    const column = useJobsStore.getState().columns.queued
    expect(column.jobs).toHaveLength(1)
    expect(column.total).toBe(1)
    expect(column.loading).toBe(false)
    expect(column.loadedOnce).toBe(true)
  })

  it('fetchColumn passes the current filters through to window.api.jobs.list', async () => {
    const { useJobsStore } = await import('./jobsStore')
    listMock.mockResolvedValue({ jobs: [], total: 0 })
    useJobsStore.getState().setFilters({ search: 'engineer', source: 'indeed', sortBy: 'matchScore' })
    listMock.mockClear()

    await useJobsStore.getState().fetchColumn('failed')

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', search: 'engineer', source: 'indeed', sortBy: 'matchScore' })
    )
  })

  it('setFilters triggers a refetch of every column', async () => {
    const { useJobsStore } = await import('./jobsStore')
    listMock.mockResolvedValue({ jobs: [], total: 0 })
    listMock.mockClear()

    useJobsStore.getState().setFilters({ search: 'x' })
    await Promise.resolve()

    expect(listMock).toHaveBeenCalledTimes(4) // queued, filled, submitted, failed
  })

  it('loadMore appends to the existing page rather than replacing it', async () => {
    const { useJobsStore } = await import('./jobsStore')
    listMock.mockResolvedValueOnce({ jobs: [job({ id: 'a' })], total: 2 })
    await useJobsStore.getState().fetchColumn('queued')

    listMock.mockResolvedValueOnce({ jobs: [job({ id: 'b' })], total: 2 })
    await useJobsStore.getState().loadMore('queued')

    const column = useJobsStore.getState().columns.queued
    expect(column.jobs.map((j) => j.id)).toEqual(['a', 'b'])
  })

  it('loadMore is a no-op once every job for that column is already loaded', async () => {
    const { useJobsStore } = await import('./jobsStore')
    listMock.mockResolvedValueOnce({ jobs: [job()], total: 1 })
    await useJobsStore.getState().fetchColumn('queued')
    listMock.mockClear()

    await useJobsStore.getState().loadMore('queued')
    expect(listMock).not.toHaveBeenCalled()
  })

  it('applyUpdate adds a brand-new job to its status column', async () => {
    const { useJobsStore } = await import('./jobsStore')
    useJobsStore.getState().applyUpdate(job({ id: 'new-job' }))
    expect(useJobsStore.getState().columns.queued.jobs.map((j) => j.id)).toContain('new-job')
    expect(useJobsStore.getState().columns.queued.total).toBe(1)
  })

  it('applyUpdate moves a job between columns when its status changes', async () => {
    const { useJobsStore } = await import('./jobsStore')
    useJobsStore.getState().applyUpdate(job({ id: 'job-1', status: 'queued' }))
    useJobsStore.getState().applyUpdate(job({ id: 'job-1', status: 'filled' }))

    const state = useJobsStore.getState()
    expect(state.columns.queued.jobs).toEqual([])
    expect(state.columns.queued.total).toBe(0)
    expect(state.columns.filled.jobs.map((j) => j.id)).toEqual(['job-1'])
    expect(state.columns.filled.total).toBe(1)
  })

  it('applyUpdate replaces the job in place when the status is unchanged', async () => {
    const { useJobsStore } = await import('./jobsStore')
    useJobsStore.getState().applyUpdate(job({ id: 'job-1', title: 'Old Title' }))
    useJobsStore.getState().applyUpdate(job({ id: 'job-1', title: 'New Title' }))

    const state = useJobsStore.getState()
    expect(state.columns.queued.jobs).toHaveLength(1)
    expect(state.columns.queued.jobs[0]!.title).toBe('New Title')
    expect(state.columns.queued.total).toBe(1)
  })

  it('removeJobLocal removes the job from its column and clears its selection', async () => {
    const { useJobsStore } = await import('./jobsStore')
    useJobsStore.getState().applyUpdate(job({ id: 'job-1' }))
    useJobsStore.getState().toggleSelected('job-1')

    useJobsStore.getState().removeJobLocal('job-1')

    const state = useJobsStore.getState()
    expect(state.columns.queued.jobs).toEqual([])
    expect(state.selectedJobIds.has('job-1')).toBe(false)
  })

  it('subscribeToUpdates wires applyUpdate/removeJobLocal to the IPC push events, and the returned cleanup unsubscribes', async () => {
    const { useJobsStore } = await import('./jobsStore')
    const unsubscribe = useJobsStore.getState().subscribeToUpdates()

    onUpdatedHandlers[0]!(job({ id: 'pushed-job' }))
    expect(useJobsStore.getState().columns.queued.jobs.map((j) => j.id)).toContain('pushed-job')

    onRemovedHandlers[0]!({ jobId: 'pushed-job' })
    expect(useJobsStore.getState().columns.queued.jobs).toEqual([])

    unsubscribe()
    expect(onUpdatedHandlers).toEqual([])
    expect(onRemovedHandlers).toEqual([])
  })

  describe('selection', () => {
    it('toggleSelected adds then removes an id', async () => {
      const { useJobsStore } = await import('./jobsStore')
      useJobsStore.getState().toggleSelected('a')
      expect(useJobsStore.getState().selectedJobIds.has('a')).toBe(true)
      useJobsStore.getState().toggleSelected('a')
      expect(useJobsStore.getState().selectedJobIds.has('a')).toBe(false)
    })

    it('selectOnly replaces the whole selection with a single id', async () => {
      const { useJobsStore } = await import('./jobsStore')
      useJobsStore.getState().toggleSelected('a')
      useJobsStore.getState().toggleSelected('b')
      useJobsStore.getState().selectOnly('c')
      expect(useJobsStore.getState().selectedJobIds).toEqual(new Set(['c']))
    })

    it('clearSelection empties it', async () => {
      const { useJobsStore } = await import('./jobsStore')
      useJobsStore.getState().toggleSelected('a')
      useJobsStore.getState().clearSelection()
      expect(useJobsStore.getState().selectedJobIds.size).toBe(0)
    })
  })

  describe('detail modal target', () => {
    it('openJob/closeJob track which job id is open', async () => {
      const { useJobsStore } = await import('./jobsStore')
      useJobsStore.getState().openJob('job-1')
      expect(useJobsStore.getState().openJobId).toBe('job-1')
      useJobsStore.getState().closeJob()
      expect(useJobsStore.getState().openJobId).toBeNull()
    })

    it('openJob sets activeJob instantly from an already-loaded column, without hitting IPC', async () => {
      const { useJobsStore } = await import('./jobsStore')
      useJobsStore.getState().applyUpdate(job({ id: 'job-1', title: 'Loaded' }))

      useJobsStore.getState().openJob('job-1')

      expect(useJobsStore.getState().activeJob?.title).toBe('Loaded')
      expect(getMock).not.toHaveBeenCalled()
    })

    it('openJob falls back to window.api.jobs.get when the job is not in any loaded column', async () => {
      const { useJobsStore } = await import('./jobsStore')
      getMock.mockResolvedValue({ job: job({ id: 'job-9', title: 'Fetched' }) })

      useJobsStore.getState().openJob('job-9')
      expect(useJobsStore.getState().activeJob).toBeNull()
      await Promise.resolve()
      await Promise.resolve()

      expect(getMock).toHaveBeenCalledWith('job-9')
      expect(useJobsStore.getState().activeJob?.title).toBe('Fetched')
    })

    it('a stale jobs.get response is discarded if the modal was closed (or a different job opened) first', async () => {
      const { useJobsStore } = await import('./jobsStore')
      let resolveGet!: (value: { job: JobRecord | null }) => void
      getMock.mockReturnValue(new Promise((resolve) => (resolveGet = resolve)))

      useJobsStore.getState().openJob('job-9')
      useJobsStore.getState().closeJob()
      resolveGet({ job: job({ id: 'job-9' }) })
      await Promise.resolve()
      await Promise.resolve()

      expect(useJobsStore.getState().activeJob).toBeNull()
    })

    it('closeJob clears activeJob along with openJobId', async () => {
      const { useJobsStore } = await import('./jobsStore')
      useJobsStore.getState().applyUpdate(job({ id: 'job-1' }))
      useJobsStore.getState().openJob('job-1')

      useJobsStore.getState().closeJob()

      expect(useJobsStore.getState().activeJob).toBeNull()
    })

    it('applyUpdate patches activeJob in place when it matches the currently-open job', async () => {
      const { useJobsStore } = await import('./jobsStore')
      useJobsStore.getState().applyUpdate(job({ id: 'job-1', title: 'Old Title' }))
      useJobsStore.getState().openJob('job-1')

      useJobsStore.getState().applyUpdate(job({ id: 'job-1', title: 'New Title' }))

      expect(useJobsStore.getState().activeJob?.title).toBe('New Title')
    })

    it('applyUpdate leaves activeJob untouched when it does not match the currently-open job', async () => {
      const { useJobsStore } = await import('./jobsStore')
      useJobsStore.getState().applyUpdate(job({ id: 'job-1', title: 'Open Job' }))
      useJobsStore.getState().openJob('job-1')

      useJobsStore.getState().applyUpdate(job({ id: 'other-job', title: 'Someone Else' }))

      expect(useJobsStore.getState().activeJob?.id).toBe('job-1')
      expect(useJobsStore.getState().activeJob?.title).toBe('Open Job')
    })
  })
})
