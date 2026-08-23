import { create } from 'zustand'
import type { IndexedJobMatchFilter, IndexedJobRecord } from '@shared/types/indexedJob'
import { LIST_INDEXED_JOBS_DEFAULT_LIMIT } from '@shared/constants'

export interface IndexedJobFilters {
  search: string
  source: string | null
  matched: IndexedJobMatchFilter
}

interface IndexedJobsState {
  items: IndexedJobRecord[]
  total: number
  page: number
  loading: boolean
  loadedOnce: boolean
  compact: boolean
  filters: IndexedJobFilters
  setFilters: (partial: Partial<IndexedJobFilters>) => void
  setPage: (page: number) => Promise<void>
  toggleCompact: () => void
  fetch: () => Promise<void>
  /** Re-fetches the current page in place, for the live "a new search just ran" push. */
  refresh: () => Promise<void>
  subscribeToChanges: () => () => void
}

const DEFAULT_FILTERS: IndexedJobFilters = { search: '', source: null, matched: 'all' }

function totalPagesFor(total: number): number {
  return Math.max(1, Math.ceil(total / LIST_INDEXED_JOBS_DEFAULT_LIMIT))
}

export const useIndexedJobsStore = create<IndexedJobsState>((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  loading: false,
  loadedOnce: false,
  compact: false,
  filters: DEFAULT_FILTERS,

  setFilters: (partial) => {
    set((state) => ({ filters: { ...state.filters, ...partial }, page: 1 }))
    get().fetch()
  },

  setPage: async (page) => {
    set({ page })
    await get().fetch()
  },

  toggleCompact: () => set((state) => ({ compact: !state.compact })),

  fetch: async () => {
    const { search, source, matched } = get().filters
    const { page } = get()
    set({ loading: true })
    const result = await window.api.indexedJobs.list({
      limit: LIST_INDEXED_JOBS_DEFAULT_LIMIT,
      offset: (page - 1) * LIST_INDEXED_JOBS_DEFAULT_LIMIT,
      search: search || undefined,
      source: source || undefined,
      matched
    })
    set({ items: result.items, total: result.total, loading: false, loadedOnce: true })
  },

  refresh: async () => {
    if (!get().loadedOnce) return
    await get().fetch()
    // The live push can shrink the total (e.g. retention pruning) out from
    // under whatever page the user was sitting on — land on the new last
    // page instead of showing an empty one.
    const { page, total } = get()
    const lastPage = totalPagesFor(total)
    if (page > lastPage) {
      set({ page: lastPage })
      await get().fetch()
    }
  },

  subscribeToChanges: () => {
    return window.api.indexedJobs.onChanged(() => get().refresh())
  }
}))
