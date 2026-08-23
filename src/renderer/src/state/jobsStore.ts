import { create } from 'zustand'
import type { JobRecord, JobSortOrder, JobStatus } from '@shared/types/job'

const STATUSES: JobStatus[] = ['queued', 'filled', 'submitted', 'failed']
const PAGE_SIZE = 20

interface ColumnState {
  jobs: JobRecord[]
  total: number
  loading: boolean
  loadedOnce: boolean
}

export interface JobFilters {
  search: string
  source: string | null
  sortBy: JobSortOrder
}

interface JobsState {
  columns: Record<JobStatus, ColumnState>
  filters: JobFilters
  /** Job currently open in the detail modal — shared so any panel (board, sidebar, indexed jobs) can drive it. */
  openJobId: string | null
  /**
   * The open job's full record. Populated instantly from a loaded column
   * when available; otherwise fetched directly (e.g. a job opened from the
   * Indexed Jobs page may not be in any currently-loaded board page).
   */
  activeJob: JobRecord | null
  /** Checked job ids for the board's bulk-action toolbar and per-card right-click menu. */
  selectedJobIds: Set<string>
  setFilters: (partial: Partial<JobFilters>) => void
  fetchColumn: (status: JobStatus) => Promise<void>
  fetchAllColumns: () => void
  loadMore: (status: JobStatus) => Promise<void>
  applyUpdate: (job: JobRecord) => void
  removeJobLocal: (jobId: string) => void
  subscribeToUpdates: () => () => void
  openJob: (id: string) => void
  closeJob: () => void
  toggleSelected: (id: string) => void
  selectOnly: (id: string) => void
  clearSelection: () => void
}

function emptyColumn(): ColumnState {
  return { jobs: [], total: 0, loading: false, loadedOnce: false }
}

const DEFAULT_FILTERS: JobFilters = { search: '', source: null, sortBy: 'newest' }

export const useJobsStore = create<JobsState>((set, get) => ({
  columns: {
    queued: emptyColumn(),
    filled: emptyColumn(),
    submitted: emptyColumn(),
    failed: emptyColumn()
  },
  filters: DEFAULT_FILTERS,
  openJobId: null,
  activeJob: null,
  selectedJobIds: new Set(),

  setFilters: (partial) => {
    set((state) => ({ filters: { ...state.filters, ...partial } }))
    get().fetchAllColumns()
  },

  fetchAllColumns: () => {
    for (const status of STATUSES) {
      get().fetchColumn(status)
    }
  },

  fetchColumn: async (status) => {
    const { search, source, sortBy } = get().filters
    set((state) => ({ columns: { ...state.columns, [status]: { ...state.columns[status], loading: true } } }))
    const result = await window.api.jobs.list({
      status,
      limit: PAGE_SIZE,
      offset: 0,
      search: search || undefined,
      source: source || undefined,
      sortBy
    })
    set((state) => ({
      columns: {
        ...state.columns,
        [status]: { jobs: result.jobs, total: result.total, loading: false, loadedOnce: true }
      }
    }))
  },

  loadMore: async (status) => {
    const column = get().columns[status]
    if (column.loading || column.jobs.length >= column.total) return
    const { search, source, sortBy } = get().filters
    set((state) => ({ columns: { ...state.columns, [status]: { ...state.columns[status], loading: true } } }))
    const result = await window.api.jobs.list({
      status,
      limit: PAGE_SIZE,
      offset: column.jobs.length,
      search: search || undefined,
      source: source || undefined,
      sortBy
    })
    set((state) => ({
      columns: {
        ...state.columns,
        [status]: {
          jobs: [...state.columns[status].jobs, ...result.jobs],
          total: result.total,
          loading: false,
          loadedOnce: true
        }
      }
    }))
  },

  applyUpdate: (job) => {
    set((state) => {
      const columns = { ...state.columns }
      for (const status of STATUSES) {
        const existingIndex = columns[status].jobs.findIndex((j) => j.id === job.id)
        if (existingIndex === -1) continue
        if (status === job.status) {
          const jobs = [...columns[status].jobs]
          jobs[existingIndex] = job
          columns[status] = { ...columns[status], jobs }
        } else {
          columns[status] = {
            ...columns[status],
            jobs: columns[status].jobs.filter((j) => j.id !== job.id),
            total: Math.max(0, columns[status].total - 1)
          }
        }
      }
      const targetColumn = columns[job.status]
      if (!targetColumn.jobs.some((j) => j.id === job.id)) {
        columns[job.status] = {
          ...targetColumn,
          jobs: [job, ...targetColumn.jobs],
          total: targetColumn.total + 1
        }
      }
      return { columns, activeJob: state.activeJob?.id === job.id ? job : state.activeJob }
    })
  },

  removeJobLocal: (jobId) => {
    set((state) => {
      const columns = { ...state.columns }
      for (const status of STATUSES) {
        if (!columns[status].jobs.some((j) => j.id === jobId)) continue
        columns[status] = {
          ...columns[status],
          jobs: columns[status].jobs.filter((j) => j.id !== jobId),
          total: Math.max(0, columns[status].total - 1)
        }
      }
      if (!state.selectedJobIds.has(jobId)) return { columns }
      const selectedJobIds = new Set(state.selectedJobIds)
      selectedJobIds.delete(jobId)
      return { columns, selectedJobIds }
    })
  },

  subscribeToUpdates: () => {
    const removeUpdatedListener = window.api.jobs.onUpdated((job) => get().applyUpdate(job))
    const removeRemovedListener = window.api.jobs.onRemoved(({ jobId }) => get().removeJobLocal(jobId))
    return () => {
      removeUpdatedListener()
      removeRemovedListener()
    }
  },

  openJob: (id) => {
    const fromColumns = Object.values(get().columns)
      .flatMap((c) => c.jobs)
      .find((j) => j.id === id)
    set({ openJobId: id, activeJob: fromColumns ?? null })
    if (fromColumns) return
    window.api.jobs.get(id).then(({ job }) => {
      if (get().openJobId === id) set({ activeJob: job })
    })
  },
  closeJob: () => set({ openJobId: null, activeJob: null }),

  toggleSelected: (id) =>
    set((state) => {
      const selectedJobIds = new Set(state.selectedJobIds)
      if (selectedJobIds.has(id)) selectedJobIds.delete(id)
      else selectedJobIds.add(id)
      return { selectedJobIds }
    }),
  selectOnly: (id) => set({ selectedJobIds: new Set([id]) }),
  clearSelection: () => set({ selectedJobIds: new Set() })
}))
