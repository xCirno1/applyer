// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ApplicationStage } from '@shared/types/applicationStage'

const api = {
  list: vi.fn(),
  counts: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
  setJobStage: vi.fn()
}
let stagesChanged: (() => void) | null = null
let jobsUpdated: (() => void) | null = null
let jobsRemoved: (() => void) | null = null

const OFFER: ApplicationStage = { id: 'offer', label: 'Offer', isBuiltin: true, position: 0 }
const REJECTED: ApplicationStage = { id: 'rejected', label: 'Rejected', isBuiltin: true, position: 1 }
const PHONE: ApplicationStage = { id: 'uuid-phone', label: 'Phone screen', isBuiltin: false, position: 2 }

beforeEach(() => {
  vi.resetModules()
  for (const fn of Object.values(api)) fn.mockReset()
  api.list.mockResolvedValue({ stages: [OFFER, REJECTED] })
  api.counts.mockResolvedValue({ counts: [{ stageId: 'offer', count: 1 }, { stageId: null, count: 2 }] })
  stagesChanged = null
  jobsUpdated = null
  jobsRemoved = null
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      stages: {
        ...api,
        onChanged: (fn: () => void) => {
          stagesChanged = fn
          return () => (stagesChanged = null)
        }
      },
      jobs: {
        onUpdated: (fn: () => void) => {
          jobsUpdated = fn
          return () => (jobsUpdated = null)
        },
        onRemoved: (fn: () => void) => {
          jobsRemoved = fn
          return () => (jobsRemoved = null)
        }
      }
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('stagesStore', () => {
  it('fetches the list and counts together', async () => {
    const { useStagesStore } = await import('./stagesStore')
    await useStagesStore.getState().fetch()
    const state = useStagesStore.getState()
    expect(state.stages.map((stage) => stage.id)).toEqual(['offer', 'rejected'])
    expect(state.stagesById.get('offer')).toEqual(OFFER)
    expect(state.counts).toHaveLength(2)
    expect(state).toMatchObject({ loading: false, loadedOnce: true })
  })

  it('degrades a failed or malformed reply to empty instead of throwing', async () => {
    const { useStagesStore } = await import('./stagesStore')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.list.mockRejectedValue(new Error('bridge down'))
    api.counts.mockResolvedValue({ counts: 'nonsense' })
    await useStagesStore.getState().fetch()
    expect(useStagesStore.getState()).toMatchObject({ stages: [], counts: [], loading: false, loadedOnce: true })

    api.list.mockResolvedValue({ stages: [OFFER, { id: 3 }, null] })
    await useStagesStore.getState().fetch()
    expect(useStagesStore.getState().stages).toEqual([OFFER])
  })

  it('appends a created stage and keeps a rename in place', async () => {
    const { useStagesStore } = await import('./stagesStore')
    await useStagesStore.getState().fetch()
    api.create.mockResolvedValue({ ok: true, value: PHONE })
    expect((await useStagesStore.getState().create('Phone screen')).ok).toBe(true)
    expect(useStagesStore.getState().stages.map((stage) => stage.id)).toEqual(['offer', 'rejected', 'uuid-phone'])

    api.rename.mockResolvedValue({ ok: true, value: { ...PHONE, label: 'Recruiter call' } })
    await useStagesStore.getState().rename(PHONE.id, 'Recruiter call')
    expect(useStagesStore.getState().stagesById.get(PHONE.id)?.label).toBe('Recruiter call')
  })

  it('passes a refused write back without touching the list', async () => {
    const { useStagesStore } = await import('./stagesStore')
    await useStagesStore.getState().fetch()
    api.create.mockResolvedValue({ ok: false, error: { code: 'stageNameTaken', params: { name: 'Offer' } } })
    const result = await useStagesStore.getState().create('Offer')
    expect(result).toEqual({ ok: false, error: { code: 'stageNameTaken', params: { name: 'Offer' } } })
    expect(useStagesStore.getState().stages).toHaveLength(2)
  })

  it('turns a bridge failure into an unexpected error', async () => {
    const { useStagesStore } = await import('./stagesStore')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.remove.mockRejectedValue(new Error('bridge down'))
    expect(await useStagesStore.getState().remove('x')).toEqual({ ok: false, error: { code: 'unexpected' } })
  })

  it('reorders optimistically and rolls back a failed reorder', async () => {
    const { useStagesStore } = await import('./stagesStore')
    await useStagesStore.getState().fetch()
    let settle: (value: unknown) => void = () => {}
    api.reorder.mockImplementation(() => new Promise((resolve) => (settle = resolve)))
    const pending = useStagesStore.getState().reorder(['rejected', 'offer'])
    expect(useStagesStore.getState().stages.map((stage) => stage.id)).toEqual(['rejected', 'offer'])
    settle({ ok: false, error: { code: 'unexpected' } })
    await pending
    expect(useStagesStore.getState().stages.map((stage) => stage.id)).toEqual(['offer', 'rejected'])
  })

  it('removes a deleted stage, closing the gap, and refreshes the counts', async () => {
    const { useStagesStore } = await import('./stagesStore')
    await useStagesStore.getState().fetch()
    api.counts.mockClear()
    api.remove.mockResolvedValue({ ok: true, value: { clearedJobs: 1 } })
    await useStagesStore.getState().remove('offer')
    expect(useStagesStore.getState().stages).toEqual([{ ...REJECTED, position: 0 }])
    expect(api.counts).toHaveBeenCalledTimes(1)
  })

  it('does not call the bridge to set the stage of no jobs', async () => {
    const { useStagesStore } = await import('./stagesStore')
    expect(await useStagesStore.getState().setJobStage([], 'offer')).toEqual({ ok: true, value: { jobs: [], skippedIds: [] } })
    expect(api.setJobStage).not.toHaveBeenCalled()
  })

  it('refetches on a stage signal and folds a burst of job updates into one count query', async () => {
    vi.useFakeTimers()
    const { useStagesStore, COUNTS_REFRESH_DELAY_MS } = await import('./stagesStore')
    const unsubscribe = useStagesStore.getState().subscribeToUpdates()
    stagesChanged?.()
    expect(api.list).toHaveBeenCalledTimes(1)

    api.counts.mockClear()
    jobsUpdated?.()
    jobsUpdated?.()
    jobsRemoved?.()
    expect(api.counts).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(COUNTS_REFRESH_DELAY_MS)
    expect(api.counts).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(stagesChanged).toBeNull()
    expect(jobsUpdated).toBeNull()
    expect(jobsRemoved).toBeNull()
  })
})
