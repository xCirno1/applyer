import { create } from 'zustand'
import { callIpc } from '../lib/ipcCall'
import { appError, type AppError } from '@shared/types/errorCodes'
import type { RunRecord, RunStats } from '@shared/types/run'

/**
 * The Runs screen's state: which run is being looked at, its folded statistics,
 * and the list of past runs to pick from.
 *
 * "Active" is the run in progress (at most one), which the main process
 * owns; "selected" is what the tab is showing, which is the active run
 * unless the user picked an older one. The main process pushes a
 * payload-less `runs:changed` for every burst of events, and the store
 * answers it by re-reading whichever run is on screen: the active one is
 * what changes, but a selected past run is refetched too in case it was
 * renamed or deleted elsewhere.
 *
 * Statistics come folded from the main process rather than being kept here
 * as counters, so a reconnect or a restart mid-run shows the same numbers
 * the database holds.
 *
 * The history is read a page at a time, newest first: the first page on
 * every refresh and older pages only when the header asks for them
 * (`fetchMoreHistory`), so someone with hundreds of runs can still reach
 * the oldest without every event burst re-reading all of them. A refresh
 * re-reads only the first page and keeps the older pages already loaded;
 * runs are appended at the top (a new run has the highest sequence) and a
 * delete from this window is applied locally, so the kept tail only goes
 * stale if another window renames an old run, which the next select
 * corrects.
 */

const HISTORY_PAGE = 50

/** What a mutation answers when the bridge itself failed; the toast reads it like any refused request. */
const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

type ActionResult = { ok: true } | { ok: false; error: AppError }

interface RunsState {
  active: RunRecord | null
  selectedRunId: string | null
  stats: RunStats | null
  history: RunRecord[]
  /** How many runs exist in all; `history` holds the newest `history.length` of them. */
  historyTotal: number
  /** True while an older page of the history is being read. */
  historyLoadingMore: boolean
  loading: boolean
  loadedOnce: boolean
  /** True while start/stop/rename/delete is in flight; the header disables its controls. */
  acting: boolean
  fetchActive: () => Promise<void>
  fetchHistory: () => Promise<void>
  fetchMoreHistory: () => Promise<void>
  select: (runId: string | null) => Promise<void>
  refresh: () => Promise<void>
  start: (label?: string | null) => Promise<ActionResult>
  stop: () => Promise<ActionResult>
  rename: (runId: string, label: string | null) => Promise<ActionResult>
  remove: (runId: string) => Promise<ActionResult>
  subscribeToChanges: () => () => void
}

/**
 * A fresh first page followed by the already-loaded runs older than it. A
 * run the page also lists (renamed, or one that slid down after a delete)
 * takes the page's copy. A page shorter than `pageSize` is the whole
 * history, so anything loaded but missing from it was deleted elsewhere
 * and is dropped rather than kept.
 */
export function keepOlderPages(firstPage: RunRecord[], loaded: RunRecord[], pageSize: number): RunRecord[] {
  const oldest = firstPage[firstPage.length - 1]
  if (!oldest || firstPage.length < pageSize) return firstPage
  const listed = new Set(firstPage.map((run) => run.id))
  return [...firstPage, ...loaded.filter((run) => run.sequence < oldest.sequence && !listed.has(run.id))]
}

async function statsFor(runId: string): Promise<RunStats | null> {
  const result = await callIpc('runs.getStats', () => window.api.runs.getStats(runId), BRIDGE_FAILURE)
  return result.ok ? result.stats : null
}

export const useRunsStore = create<RunsState>((set, get) => ({
  active: null,
  selectedRunId: null,
  stats: null,
  history: [],
  historyTotal: 0,
  historyLoadingMore: false,
  loading: false,
  loadedOnce: false,
  acting: false,

  fetchActive: async () => {
    set({ loading: true })
    const { run, stats } = await callIpc('runs.getActive', () => window.api.runs.getActive(), { run: null, stats: null })
    const { selectedRunId } = get()
    // With nothing chosen, the tab follows the run in progress; once the
    // user picks a past run it stays there until they pick again.
    const followActive = selectedRunId === null || selectedRunId === run?.id
    if (followActive) {
      set({ active: run, selectedRunId: run?.id ?? null, stats, loading: false, loadedOnce: true })
      return
    }
    const selectedStats = await statsFor(selectedRunId)
    if (selectedStats === null) {
      // The run being looked at is gone; fall back to the run in progress.
      set({ active: run, selectedRunId: run?.id ?? null, stats, loading: false, loadedOnce: true })
      return
    }
    set({ active: run, stats: selectedStats, loading: false, loadedOnce: true })
  },

  fetchHistory: async () => {
    const result = await callIpc('runs.list', () => window.api.runs.list({ limit: HISTORY_PAGE }), {
      items: [],
      total: 0
    })
    set({ history: keepOlderPages(result.items, get().history, HISTORY_PAGE), historyTotal: result.total })
  },

  fetchMoreHistory: async () => {
    const { history, historyTotal, historyLoadingMore } = get()
    if (historyLoadingMore || history.length >= historyTotal) return
    set({ historyLoadingMore: true })
    const result = await callIpc(
      'runs.list',
      () => window.api.runs.list({ limit: HISTORY_PAGE, offset: history.length }),
      { items: [], total: historyTotal }
    )
    const known = new Set(get().history.map((run) => run.id))
    set({
      history: [...get().history, ...result.items.filter((run) => !known.has(run.id))],
      historyTotal: result.total,
      historyLoadingMore: false
    })
  },

  select: async (runId) => {
    if (runId === null) {
      const { active } = get()
      set({ selectedRunId: active?.id ?? null, stats: null })
      await get().fetchActive()
      return
    }
    set({ selectedRunId: runId, loading: true })
    const stats = await statsFor(runId)
    // Ignore a reply for a run the user has since navigated away from.
    if (get().selectedRunId !== runId) return
    set({ stats, loading: false, loadedOnce: true })
  },

  refresh: async () => {
    await Promise.all([get().fetchActive(), get().fetchHistory()])
  },

  start: async (label) => {
    set({ acting: true })
    const result = await callIpc('runs.start', () => window.api.runs.start(label ?? null), BRIDGE_FAILURE)
    if (result.ok) {
      set({ active: result.run, selectedRunId: result.run.id, stats: result.stats, acting: false, loadedOnce: true })
      await get().fetchHistory()
      return { ok: true }
    }
    set({ acting: false })
    return { ok: false, error: result.error }
  },

  stop: async () => {
    set({ acting: true })
    const result = await callIpc('runs.stop', () => window.api.runs.stop(), BRIDGE_FAILURE)
    if (result.ok) {
      const { selectedRunId } = get()
      set({
        active: null,
        acting: false,
        ...(selectedRunId === result.run.id ? { stats: result.stats } : {})
      })
      await get().fetchHistory()
      return { ok: true }
    }
    set({ acting: false })
    return { ok: false, error: result.error }
  },

  rename: async (runId, label) => {
    set({ acting: true })
    const result = await callIpc('runs.rename', () => window.api.runs.rename(runId, label), BRIDGE_FAILURE)
    if (result.ok) {
      const { active, stats } = get()
      set({
        acting: false,
        active: active?.id === runId ? result.run : active,
        stats: stats?.run.id === runId ? { ...stats, run: result.run } : stats,
        history: get().history.map((run) => (run.id === runId ? result.run : run))
      })
      return { ok: true }
    }
    set({ acting: false })
    return { ok: false, error: result.error }
  },

  remove: async (runId) => {
    set({ acting: true })
    const result = await callIpc('runs.delete', () => window.api.runs.delete(runId), BRIDGE_FAILURE)
    if (result.ok) {
      const { selectedRunId, active } = get()
      set({
        acting: false,
        history: get().history.filter((run) => run.id !== runId),
        historyTotal: Math.max(0, get().historyTotal - 1),
        ...(active?.id === runId ? { active: null } : {}),
        ...(selectedRunId === runId ? { selectedRunId: null, stats: null } : {})
      })
      if (selectedRunId === runId) await get().fetchActive()
      return { ok: true }
    }
    set({ acting: false })
    return { ok: false, error: result.error }
  },

  subscribeToChanges: () => {
    return window.api.runs.onChanged(() => {
      void get().refresh()
    })
  }
}))
