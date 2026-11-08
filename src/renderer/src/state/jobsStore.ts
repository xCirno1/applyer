import { create } from 'zustand'
import { callIpc } from '../lib/ipcCall'
import type { JobRecord, JobSortOrder, JobStatus } from '@shared/types/job'
import { STAGE_FILTER_ALL, jobMatchesStageFilter, stageFilterToQuery, type StageFilter } from './stagesStoreLogic'

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
  /**
   * Narrows the Submitted column only (no other status carries a stage):
   * `STAGE_FILTER_ALL`, `STAGE_FILTER_NONE`, or a stage id.
   */
  stage: StageFilter
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

const DEFAULT_FILTERS: JobFilters = { search: '', source: null, sortBy: 'newest', stage: STAGE_FILTER_ALL }

/** Per-column request counter, so only the newest `fetchColumn` call writes its page. */
const latestRequest: Record<JobStatus, number> = { queued: 0, filled: 0, submitted: 0, failed: 0 }

/** The stage part of a column's query: only Submitted is filtered by stage. */
function stageQuery(status: JobStatus, filters: JobFilters): { stageId?: string | null } {
  if (status !== 'submitted') return {}
  const stageId = stageFilterToQuery(filters.stage)
  return stageId === undefined ? {} : { stageId }
}

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
    const previous = get().filters
    const next = { ...previous, ...partial }
    set({ filters: next })
    // The stage filter only changes what Submitted shows, so changing it
    // alone refetches that one column rather than all four.
    const onlyStage = (Object.keys(partial) as (keyof JobFilters)[]).every((key) => key === 'stage' || partial[key] === previous[key])
    if (onlyStage && next.stage !== previous.stage) void get().fetchColumn('submitted')
    else if (!onlyStage) get().fetchAllColumns()
  },

  fetchAllColumns: () => {
    // Not awaited (the four columns load independently), so each is voided
    // explicitly — `fetchColumn` handles its own failure and never rejects.
    for (const status of STATUSES) {
      void get().fetchColumn(status)
    }
  },

  fetchColumn: async (status) => {
    const filters = get().filters
    const { search, source, sortBy } = filters
    const request = ++latestRequest[status]
    set((state) => ({ columns: { ...state.columns, [status]: { ...state.columns[status], loading: true } } }))
    // An empty page on failure, never a column stuck loading: `loading` is what
    // draws the skeleton, so a rejected call that skipped this `set` left one
    // spinning for the rest of the session.
    const result = await callIpc(`jobs.list(${status})`, () =>
      window.api.jobs.list({
        status,
        limit: PAGE_SIZE,
        offset: 0,
        search: search || undefined,
        source: source || undefined,
        sortBy,
        ...stageQuery(status, filters)
      }),
      { jobs: [], total: 0 }
    )
    // A newer request for this column started while this one was in
    // flight (a filter changed): it owns the column, so this stale page is
    // dropped rather than shown over it.
    if (latestRequest[status] !== request) return
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
    const filters = get().filters
    const { search, source, sortBy } = filters
    const request = latestRequest[status]
    set((state) => ({ columns: { ...state.columns, [status]: { ...state.columns[status], loading: true } } }))
    // Keeps the rows already loaded and reports the same total, so a failed
    // "load more" leaves the column exactly as it was, still able to retry.
    const result = await callIpc(`jobs.list(${status}, more)`, () =>
      window.api.jobs.list({
        status,
        limit: PAGE_SIZE,
        offset: column.jobs.length,
        search: search || undefined,
        source: source || undefined,
        sortBy,
        ...stageQuery(status, filters)
      }),
      { jobs: [], total: column.total }
    )
    // The column was refetched from the top meanwhile; this page belongs to
    // the old list, and the refetch is what settles `loading`.
    if (latestRequest[status] !== request) return
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
      // A Submitted job whose stage no longer matches the stage filter
      // leaves the column, the way a status change moves it to another.
      const belongs = jobMatchesStageFilter(job, state.filters.stage)
      for (const status of STATUSES) {
        const existingIndex = columns[status].jobs.findIndex((j) => j.id === job.id)
        if (existingIndex === -1) continue
        if (status === job.status && belongs) {
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
      if (belongs && !targetColumn.jobs.some((j) => j.id === job.id)) {
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
    void callIpc(`jobs.get(${id})`, () => window.api.jobs.get(id), { job: null }).then(({ job }) => {
      // Guarded because the modal may have been closed, or another job opened,
      // while this was in flight.
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
