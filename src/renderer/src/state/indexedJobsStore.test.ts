// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IndexedJobDateBucket, IndexedJobRecord, ListIndexedJobsResult } from '@shared/types/indexedJob'

const listMock = vi.fn<(...args: unknown[]) => Promise<ListIndexedJobsResult>>()
const listDatesMock = vi.fn<() => Promise<IndexedJobDateBucket[]>>()
const onChangedHandlers: (() => void)[] = []

beforeEach(() => {
  // The store is a module-level zustand singleton — reset the module
  // registry so each test's `await import('./indexedJobsStore')` gets a
  // fresh store instead of accumulating state left over from earlier tests.
  vi.resetModules()
  listMock.mockReset()
  listDatesMock.mockReset()
  listDatesMock.mockResolvedValue([])
  onChangedHandlers.length = 0
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      indexedJobs: {
        list: listMock,
        listDates: listDatesMock,
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

function item(overrides: Partial<IndexedJobRecord> = {}): IndexedJobRecord {
  return {
    id: 'item-1',
    url: 'https://example.com/1',
    title: 'Backend Engineer',
    company: 'Acme',
    location: null,
    source: 'indeed',
    snippet: null,
    salaryRange: null,
    postedAt: null,
    searchQuery: 'engineer',
    searchLocation: null,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    seenCount: 1,
    matchedJobId: null,
    matchedStatus: null,
    matchedScore: null,
    ...overrides
  }
}

describe('indexedJobsStore', () => {
  it('fetch populates items/total/loading/loadedOnce', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValue({ items: [item()], total: 1 })

    await useIndexedJobsStore.getState().fetch()

    const state = useIndexedJobsStore.getState()
    expect(state.items).toHaveLength(1)
    expect(state.total).toBe(1)
    expect(state.loading).toBe(false)
    expect(state.loadedOnce).toBe(true)
  })

  it('fetch passes the current filters through to window.api.indexedJobs.list', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValue({ items: [], total: 0 })
    useIndexedJobsStore.getState().setFilters({ search: 'engineer', source: 'indeed', matched: 'matched' })
    listMock.mockClear()

    await useIndexedJobsStore.getState().fetch()

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, search: 'engineer', source: 'indeed', matched: 'matched' })
    )
  })

  it('fetch passes the selected date filter through, and omits it when cleared', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValue({ items: [], total: 0 })

    useIndexedJobsStore.getState().setFilters({ date: '2026-01-01' })
    await Promise.resolve()
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-01-01' }))

    useIndexedJobsStore.getState().setFilters({ date: null })
    await Promise.resolve()
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ date: undefined }))
  })

  it('setFilters triggers a refetch', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValue({ items: [], total: 0 })
    listMock.mockClear()

    useIndexedJobsStore.getState().setFilters({ search: 'x' })
    await Promise.resolve()

    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('setFilters resets to page 1', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValue({ items: [], total: 0 })
    await useIndexedJobsStore.getState().setPage(3)

    useIndexedJobsStore.getState().setFilters({ search: 'x' })
    await Promise.resolve()

    expect(useIndexedJobsStore.getState().page).toBe(1)
  })

  it('setPage fetches that page at the right offset, replacing the items in place', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValueOnce({ items: [item({ id: 'a' })], total: 45 })
    await useIndexedJobsStore.getState().fetch()

    listMock.mockResolvedValueOnce({ items: [item({ id: 'b' })], total: 45 })
    await useIndexedJobsStore.getState().setPage(3)

    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ offset: 40, limit: 20 }))
    expect(useIndexedJobsStore.getState().items.map((i) => i.id)).toEqual(['b'])
    expect(useIndexedJobsStore.getState().page).toBe(3)
  })

  it('setPageSize refetches at the new limit and resets to page 1', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValueOnce({ items: [item()], total: 45 })
    await useIndexedJobsStore.getState().setPage(3) // page 3 of a 20-per-page list

    listMock.mockResolvedValueOnce({ items: [item()], total: 45 })
    await useIndexedJobsStore.getState().setPageSize(50)

    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, limit: 50 }))
    expect(useIndexedJobsStore.getState().page).toBe(1)
    expect(useIndexedJobsStore.getState().pageSize).toBe(50)
  })

  it('toggleCompact flips the compact flag', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    expect(useIndexedJobsStore.getState().compact).toBe(false)
    useIndexedJobsStore.getState().toggleCompact()
    expect(useIndexedJobsStore.getState().compact).toBe(true)
    useIndexedJobsStore.getState().toggleCompact()
    expect(useIndexedJobsStore.getState().compact).toBe(false)
  })

  it('refresh is a no-op before the first fetch has happened', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    await useIndexedJobsStore.getState().refresh()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('fetchDateBuckets populates the date strip options', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listDatesMock.mockResolvedValue([
      { date: '2026-01-02', count: 1 },
      { date: '2026-01-01', count: 2 }
    ])

    await useIndexedJobsStore.getState().fetchDateBuckets()

    const state = useIndexedJobsStore.getState()
    expect(state.dateBuckets).toEqual([
      { date: '2026-01-02', count: 1 },
      { date: '2026-01-01', count: 2 }
    ])
    expect(state.dateBucketsLoaded).toBe(true)
  })

  it('refresh also re-fetches the date buckets, since a new search can add or grow one', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValue({ items: [item()], total: 1 })
    await useIndexedJobsStore.getState().fetch()
    listDatesMock.mockClear()
    listDatesMock.mockResolvedValue([{ date: '2026-01-03', count: 1 }])

    await useIndexedJobsStore.getState().refresh()

    expect(listDatesMock).toHaveBeenCalledTimes(1)
    expect(useIndexedJobsStore.getState().dateBuckets).toEqual([{ date: '2026-01-03', count: 1 }])
  })

  it('refresh re-fetches the current page in place', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValueOnce({ items: [item({ id: 'a' })], total: 1 })
    await useIndexedJobsStore.getState().fetch()

    listMock.mockResolvedValueOnce({ items: [item({ id: 'a' }), item({ id: 'b' })], total: 2 })
    await useIndexedJobsStore.getState().refresh()

    const state = useIndexedJobsStore.getState()
    expect(state.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(state.total).toBe(2)
  })

  it('refresh lands on the new last page if the total shrank out from under the current page', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValueOnce({ items: [item()], total: 45 })
    await useIndexedJobsStore.getState().setPage(3) // offset 40, within a 45-total (3 pages)

    // The next search's results got pruned/filtered down to under a page's worth.
    listMock.mockResolvedValueOnce({ items: [], total: 5 })
    listMock.mockResolvedValueOnce({ items: [item()], total: 5 })
    await useIndexedJobsStore.getState().refresh()

    expect(useIndexedJobsStore.getState().page).toBe(1)
    expect(useIndexedJobsStore.getState().items).toHaveLength(1)
  })

  it('refresh computes the last page against the current pageSize, not the default', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    // At the default pageSize (20), a total of 15 is only 1 page — so if
    // refresh ignored the current pageSize and fell back to the default,
    // page 2 (valid at pageSize 10) would incorrectly look past the end.
    listMock.mockResolvedValueOnce({ items: [item()], total: 15 })
    await useIndexedJobsStore.getState().setPageSize(10)

    listMock.mockResolvedValueOnce({ items: [item()], total: 15 })
    await useIndexedJobsStore.getState().setPage(2) // page 2 of 2 at pageSize 10

    listMock.mockResolvedValueOnce({ items: [item()], total: 15 })
    await useIndexedJobsStore.getState().refresh()

    expect(useIndexedJobsStore.getState().page).toBe(2)
  })

  it('subscribeToChanges wires refresh to the IPC push event, and the returned cleanup unsubscribes', async () => {
    const { useIndexedJobsStore } = await import('./indexedJobsStore')
    listMock.mockResolvedValue({ items: [item()], total: 1 })
    await useIndexedJobsStore.getState().fetch()
    listMock.mockClear()

    const unsubscribe = useIndexedJobsStore.getState().subscribeToChanges()
    onChangedHandlers[0]!()
    await Promise.resolve()

    expect(listMock).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(onChangedHandlers).toEqual([])
  })
})
