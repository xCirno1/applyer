// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RunRecord, RunStats } from '@shared/types/run'

const getActive = vi.fn()
const getStats = vi.fn()
const list = vi.fn()
const start = vi.fn()
const stop = vi.fn()
const rename = vi.fn()
const del = vi.fn()
const onChangedHandlers: (() => void)[] = []

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    label: null,
    sequence: 1,
    startedAt: '2026-09-15T10:00:00.000Z',
    endedAt: null,
    eventCount: 0,
    ...overrides
  }
}

function stats(record: RunRecord): RunStats {
  // Only `run` is read by the store; the rest is whatever the fold returns.
  return { run: record } as RunStats
}

beforeEach(() => {
  vi.resetModules()
  for (const mock of [getActive, getStats, list, start, stop, rename, del]) mock.mockReset()
  list.mockResolvedValue({ items: [], total: 0 })
  onChangedHandlers.length = 0
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      runs: {
        getActive,
        getStats,
        list,
        start,
        stop,
        rename,
        delete: del,
        onChanged: (fn: () => void) => {
          onChangedHandlers.push(fn)
          return () => {
            const i = onChangedHandlers.indexOf(fn)
            if (i >= 0) onChangedHandlers.splice(i, 1)
          }
        }
      }
    }
  })
})

describe('runsStore', () => {
  it('follows the run in progress when nothing is selected', async () => {
    const active = run()
    getActive.mockResolvedValue({ run: active, stats: stats(active) })
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().fetchActive()
    const state = useRunsStore.getState()
    expect(state.active).toEqual(active)
    expect(state.selectedRunId).toBe('run-1')
    expect(state.stats?.run.id).toBe('run-1')
    expect(state.loadedOnce).toBe(true)
    expect(state.loading).toBe(false)
  })

  it('shows the empty state when no run is in progress', async () => {
    getActive.mockResolvedValue({ run: null, stats: null })
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().fetchActive()
    expect(useRunsStore.getState().stats).toBeNull()
    expect(useRunsStore.getState().loadedOnce).toBe(true)
  })

  it('keeps a selected past run on screen across a live update', async () => {
    const active = run({ id: 'run-2', sequence: 2 })
    const past = run({ id: 'run-1', endedAt: '2026-09-15T11:00:00.000Z' })
    getActive.mockResolvedValue({ run: active, stats: stats(active) })
    getStats.mockResolvedValue({ ok: true, stats: stats(past) })
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().select('run-1')
    expect(useRunsStore.getState().stats?.run.id).toBe('run-1')

    await useRunsStore.getState().fetchActive()
    expect(useRunsStore.getState().active?.id).toBe('run-2')
    expect(useRunsStore.getState().stats?.run.id).toBe('run-1')
  })

  it('falls back to the run in progress when the selected run is gone', async () => {
    const active = run({ id: 'run-2', sequence: 2 })
    getActive.mockResolvedValue({ run: active, stats: stats(active) })
    getStats.mockResolvedValueOnce({ ok: true, stats: stats(run()) }).mockResolvedValue({ ok: false, error: { code: 'runNotFound' } })
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().select('run-1')
    await useRunsStore.getState().fetchActive()
    expect(useRunsStore.getState().selectedRunId).toBe('run-2')
    expect(useRunsStore.getState().stats?.run.id).toBe('run-2')
  })

  it('ignores a stats reply for a run the user has moved away from', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    getStats.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    getStats.mockResolvedValueOnce({ ok: true, stats: stats(run({ id: 'run-2' })) })
    const { useRunsStore } = await import('./runsStore')
    const first = useRunsStore.getState().select('run-1')
    await useRunsStore.getState().select('run-2')
    resolveFirst({ ok: true, stats: stats(run({ id: 'run-1' })) })
    await first
    expect(useRunsStore.getState().stats?.run.id).toBe('run-2')
  })

  it('start selects the new run and refreshes the history', async () => {
    const started = run({ id: 'run-3', sequence: 3 })
    start.mockResolvedValue({ ok: true, run: started, stats: stats(started) })
    list.mockResolvedValue({ items: [started], total: 1 })
    const { useRunsStore } = await import('./runsStore')
    const result = await useRunsStore.getState().start('batch')
    expect(result).toEqual({ ok: true })
    expect(start).toHaveBeenCalledWith('batch')
    const state = useRunsStore.getState()
    expect(state.active?.id).toBe('run-3')
    expect(state.selectedRunId).toBe('run-3')
    expect(state.history).toEqual([started])
    expect(state.acting).toBe(false)
  })

  it('start reports the error and clears acting on refusal', async () => {
    start.mockResolvedValue({ ok: false, error: { code: 'unexpected' } })
    const { useRunsStore } = await import('./runsStore')
    const result = await useRunsStore.getState().start()
    expect(result).toEqual({ ok: false, error: { code: 'unexpected' } })
    expect(useRunsStore.getState().acting).toBe(false)
  })

  it('reports a bridge failure like a refused request', async () => {
    start.mockRejectedValue(new Error('bridge down'))
    const { useRunsStore } = await import('./runsStore')
    const result = await useRunsStore.getState().start()
    expect(result).toEqual({ ok: false, error: { code: 'unexpected' } })
  })

  it('stop clears the active run and keeps the stopped run on screen with its final stats', async () => {
    const active = run()
    getActive.mockResolvedValue({ run: active, stats: stats(active) })
    const ended = run({ endedAt: '2026-09-15T11:00:00.000Z', eventCount: 4 })
    stop.mockResolvedValue({ ok: true, run: ended, stats: stats(ended) })
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().fetchActive()
    const result = await useRunsStore.getState().stop()
    expect(result).toEqual({ ok: true })
    const state = useRunsStore.getState()
    expect(state.active).toBeNull()
    expect(state.stats?.run.endedAt).toBe('2026-09-15T11:00:00.000Z')
    expect(state.selectedRunId).toBe('run-1')
  })

  it('rename patches the run everywhere it is held', async () => {
    const active = run()
    getActive.mockResolvedValue({ run: active, stats: stats(active) })
    list.mockResolvedValue({ items: [active], total: 1 })
    rename.mockResolvedValue({ ok: true, run: run({ label: 'Renamed' }) })
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().refresh()
    await useRunsStore.getState().rename('run-1', 'Renamed')
    const state = useRunsStore.getState()
    expect(state.active?.label).toBe('Renamed')
    expect(state.stats?.run.label).toBe('Renamed')
    expect(state.history[0]?.label).toBe('Renamed')
  })

  it('remove drops the run from the history and falls back to the run in progress', async () => {
    const past = run({ id: 'run-1', endedAt: '2026-09-15T11:00:00.000Z' })
    const active = run({ id: 'run-2', sequence: 2 })
    getActive.mockResolvedValue({ run: active, stats: stats(active) })
    getStats.mockResolvedValue({ ok: true, stats: stats(past) })
    list.mockResolvedValue({ items: [active, past], total: 2 })
    del.mockResolvedValue({ ok: true })
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().refresh()
    await useRunsStore.getState().select('run-1')
    await useRunsStore.getState().remove('run-1')
    const state = useRunsStore.getState()
    expect(state.history.map((r) => r.id)).toEqual(['run-2'])
    expect(state.historyTotal).toBe(1)
    expect(state.selectedRunId).toBe('run-2')
    expect(state.stats?.run.id).toBe('run-2')
  })

  it('reads older pages of the history on request and keeps them across a refresh', async () => {
    const page = (from: number, count: number): RunRecord[] =>
      Array.from({ length: count }, (_, i) => run({ id: `run-${from - i}`, sequence: from - i, endedAt: '2026-09-15T11:00:00.000Z' }))
    getActive.mockResolvedValue({ run: null, stats: null })
    list.mockImplementation(async ({ offset = 0 }: { offset?: number }) => ({ items: page(120 - offset, 50), total: 120 }))
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().refresh()
    expect(useRunsStore.getState().history).toHaveLength(50)
    expect(useRunsStore.getState().historyTotal).toBe(120)

    await useRunsStore.getState().fetchMoreHistory()
    expect(list).toHaveBeenLastCalledWith({ limit: 50, offset: 50 })
    expect(useRunsStore.getState().history).toHaveLength(100)
    expect(useRunsStore.getState().history[99]?.sequence).toBe(21)

    // A refresh re-reads the newest page only; the older page stays.
    list.mockClear()
    await useRunsStore.getState().refresh()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ limit: 50 })
    expect(useRunsStore.getState().history).toHaveLength(100)

    // The last page is short and asking again past the end does nothing.
    list.mockImplementation(async ({ offset = 0 }: { offset?: number }) => ({ items: page(120 - offset, 20), total: 120 }))
    await useRunsStore.getState().fetchMoreHistory()
    expect(useRunsStore.getState().history).toHaveLength(120)
    list.mockClear()
    await useRunsStore.getState().fetchMoreHistory()
    expect(list).not.toHaveBeenCalled()
  })

  it('does not read two older pages at once', async () => {
    getActive.mockResolvedValue({ run: null, stats: null })
    let release: () => void = () => {}
    list.mockResolvedValueOnce({ items: [run({ id: 'run-2', sequence: 2 }), run({ id: 'run-1', sequence: 1 })], total: 3 })
    const { useRunsStore } = await import('./runsStore')
    await useRunsStore.getState().refresh()
    // The store's page is 50, so the first page above is "short"; pretend
    // the total says otherwise and hold the next reply open.
    list.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ items: [run({ id: 'run-0', sequence: 0 })], total: 3 })))
    )
    const first = useRunsStore.getState().fetchMoreHistory()
    expect(useRunsStore.getState().historyLoadingMore).toBe(true)
    await useRunsStore.getState().fetchMoreHistory()
    expect(list).toHaveBeenCalledTimes(2)
    release()
    await first
    expect(useRunsStore.getState().historyLoadingMore).toBe(false)
    expect(useRunsStore.getState().history.map((r) => r.id)).toEqual(['run-2', 'run-1', 'run-0'])
  })

  it('refreshes on the main-process push and unsubscribes cleanly', async () => {
    getActive.mockResolvedValue({ run: null, stats: null })
    const { useRunsStore } = await import('./runsStore')
    const unsubscribe = useRunsStore.getState().subscribeToChanges()
    expect(onChangedHandlers).toHaveLength(1)
    onChangedHandlers[0]?.()
    await vi.waitFor(() => expect(getActive).toHaveBeenCalledTimes(1))
    unsubscribe()
    expect(onChangedHandlers).toHaveLength(0)
  })
})

describe('keepOlderPages', () => {
  const ended = '2026-09-15T11:00:00.000Z'
  const r = (sequence: number, label: string | null = null): RunRecord => run({ id: `run-${sequence}`, sequence, label, endedAt: ended })

  it('puts a full fresh page in front of the older runs already loaded', async () => {
    const { keepOlderPages } = await import('./runsStore')
    const loaded = [r(6), r(5), r(4), r(3)]
    expect(keepOlderPages([r(7), r(6)], loaded, 2).map((x) => x.sequence)).toEqual([7, 6, 5, 4, 3])
  })

  it('takes the page copy of a run both hold', async () => {
    const { keepOlderPages } = await import('./runsStore')
    const merged = keepOlderPages([r(3, 'Renamed'), r(2)], [r(3), r(2), r(1)], 2)
    expect(merged.map((x) => x.label)).toEqual(['Renamed', null, null])
    expect(merged).toHaveLength(3)
  })

  it('treats a short page as the whole history', async () => {
    const { keepOlderPages } = await import('./runsStore')
    expect(keepOlderPages([r(3)], [r(3), r(2), r(1)], 2).map((x) => x.sequence)).toEqual([3])
    expect(keepOlderPages([], [r(1)], 2)).toEqual([])
  })
})
