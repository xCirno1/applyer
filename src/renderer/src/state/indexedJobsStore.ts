import { create } from 'zustand'
import type { IndexedJobDateBucket, IndexedJobMatchFilter, IndexedJobRecord } from '@shared/types/indexedJob'
import { LIST_INDEXED_JOBS_DEFAULT_LIMIT, LIST_INDEXED_JOBS_MAX_LIMIT } from '@shared/constants'

/** Choices for the "Indexed" tab's rows-per-page control, capped at what the server will actually honor. */
export const INDEXED_JOBS_PAGE_SIZE_OPTIONS = [10, 20, 50].filter(
  (size) => size <= LIST_INDEXED_JOBS_MAX_LIMIT
)

export interface IndexedJobFilters {
  search: string
  source: string | null
  matched: IndexedJobMatchFilter
  /** `YYYY-MM-DD`, restricting the list to jobs first indexed that day. */
  date: string | null
}

interface IndexedJobsState {
  items: IndexedJobRecord[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  loadedOnce: boolean
  compact: boolean
  filters: IndexedJobFilters
  /** The date strip's options, most recent first — only days with rows come back. */
  dateBuckets: IndexedJobDateBucket[]
  dateBucketsLoaded: boolean
  setFilters: (partial: Partial<IndexedJobFilters>) => void
  setPage: (page: number) => Promise<void>
  setPageSize: (pageSize: number) => Promise<void>
  toggleCompact: () => void
  fetch: () => Promise<void>
  fetchDateBuckets: () => Promise<void>
  /** Re-fetches the current page in place, for the live "a new search just ran" push. */
  refresh: () => Promise<void>
  subscribeToChanges: () => () => void
}

const DEFAULT_FILTERS: IndexedJobFilters = { search: '', source: null, matched: 'all', date: null }

function totalPagesFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export const useIndexedJobsStore = create<IndexedJobsState>((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: LIST_INDEXED_JOBS_DEFAULT_LIMIT,
  loading: false,
  loadedOnce: false,
  compact: false,
  filters: DEFAULT_FILTERS,
  dateBuckets: [],
  dateBucketsLoaded: false,

  setFilters: (partial) => {
    set((state) => ({ filters: { ...state.filters, ...partial }, page: 1 }))
    get().fetch()
  },

  setPage: async (page) => {
    set({ page })
    await get().fetch()
  },

  setPageSize: async (pageSize) => {
    set({ pageSize, page: 1 })
    await get().fetch()
  },

  toggleCompact: () => set((state) => ({ compact: !state.compact })),

  fetch: async () => {
    const { search, source, matched, date } = get().filters
    const { page, pageSize } = get()
    set({ loading: true })
    const result = await window.api.indexedJobs.list({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      search: search || undefined,
      source: source || undefined,
      matched,
      date: date || undefined
    })
    set({ items: result.items, total: result.total, loading: false, loadedOnce: true })
  },

  fetchDateBuckets: async () => {
    const dateBuckets = await window.api.indexedJobs.listDates()
    set({ dateBuckets, dateBucketsLoaded: true })
  },

  refresh: async () => {
    if (!get().loadedOnce) return
    await get().fetch()
    // The live push can shrink the total (e.g. retention pruning) out from
    // under whatever page the user was sitting on — land on the new last
    // page instead of showing an empty one.
    const { page, total, pageSize } = get()
    const lastPage = totalPagesFor(total, pageSize)
    if (page > lastPage) {
      set({ page: lastPage })
      await get().fetch()
    }
    // A new search can add today's bucket or bump an existing day's count.
    await get().fetchDateBuckets()
  },

  subscribeToChanges: () => {
    return window.api.indexedJobs.onChanged(() => get().refresh())
  }
}))
