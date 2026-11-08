import { create } from 'zustand'
import { callIpc } from '../lib/ipcCall'
import { appError, type AppError } from '@shared/types/errorCodes'
import type { JobRecord } from '@shared/types/job'
import {
  applyStageOrder,
  sanitizeStageCounts,
  sanitizeStages,
  type ApplicationStage,
  type StageCount
} from '@shared/types/applicationStage'
import { indexStages } from './stagesStoreLogic'

/*
 * Renderer-side state for the Submitted column's stages: the list (in the
 * user's order), the per-stage Submitted counts the overview shows, and the
 * writes the stage manager and the job actions make.
 *
 * The list is refetched whole on every `stages:changed` signal, since the
 * agent's `set_application_stage` and an import write it too. Counts also
 * move whenever a job changes status (a job leaving Submitted leaves its
 * stage's count), so they are refetched, debounced, on every
 * `jobs:updated`/`jobs:removed` as well: a bulk action pushes one update per
 * job, and one count query covers the lot.
 *
 * Subscribed from `App`'s `MainShell` like the resumes store, because the
 * board's cards and the overview read it on every screen that shows them.
 * Everything read from the bridge goes through `sanitizeStages`/
 * `sanitizeStageCounts`, so a malformed reply degrades to "no stages"
 * rather than a card that throws.
 */

type WriteResult<T> = { ok: true; value: T } | { ok: false; error: AppError }

const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

/** Long enough to fold a bulk action's burst of job updates into one count query. */
export const COUNTS_REFRESH_DELAY_MS = 250

interface StagesState {
  stages: ApplicationStage[]
  stagesById: Map<string, ApplicationStage>
  counts: StageCount[]
  loading: boolean
  loadedOnce: boolean

  fetch: () => Promise<void>
  fetchCounts: () => Promise<void>
  create: (label: string) => Promise<WriteResult<ApplicationStage>>
  rename: (stageId: string, label: string) => Promise<WriteResult<ApplicationStage>>
  reorder: (orderedIds: string[]) => Promise<WriteResult<ApplicationStage[]>>
  remove: (stageId: string) => Promise<WriteResult<{ clearedJobs: number }>>
  setJobStage: (
    jobIds: string[],
    stageId: string | null
  ) => Promise<WriteResult<{ jobs: JobRecord[]; skippedIds: string[] }>>
  subscribeToUpdates: () => () => void
}

function withStages(stages: ApplicationStage[]): Pick<StagesState, 'stages' | 'stagesById'> {
  return { stages, stagesById: indexStages(stages) }
}

export const useStagesStore = create<StagesState>((set, get) => ({
  stages: [],
  stagesById: new Map(),
  counts: [],
  loading: false,
  loadedOnce: false,

  fetch: async () => {
    set({ loading: true })
    const [listResult, countsResult] = await Promise.all([
      callIpc('stages.list', () => window.api.stages.list(), { stages: [] }),
      callIpc('stages.counts', () => window.api.stages.counts(), { counts: [] })
    ])
    set({
      ...withStages(sanitizeStages(listResult?.stages)),
      counts: sanitizeStageCounts(countsResult?.counts),
      loading: false,
      loadedOnce: true
    })
  },

  fetchCounts: async () => {
    const result = await callIpc('stages.counts', () => window.api.stages.counts(), { counts: [] })
    set({ counts: sanitizeStageCounts(result?.counts) })
  },

  create: async (label) => {
    const result = await callIpc('stages.create', () => window.api.stages.create(label), BRIDGE_FAILURE)
    if (result.ok) {
      // Appended locally so the manager's list grows on the same frame as
      // the Add button settles; the broadcast's refetch confirms the order.
      // A reply that is not a readable stage refetches instead.
      const [created] = sanitizeStages([result.value])
      if (created) set(withStages([...get().stages.filter((stage) => stage.id !== created.id), created]))
      else void get().fetch()
    }
    return result
  },

  rename: async (stageId, label) => {
    const result = await callIpc('stages.rename', () => window.api.stages.rename(stageId, label), BRIDGE_FAILURE)
    if (result.ok) {
      const [renamed] = sanitizeStages([result.value])
      if (renamed) set(withStages(get().stages.map((stage) => (stage.id === stageId ? renamed : stage))))
      else void get().fetch()
    }
    return result
  },

  reorder: async (orderedIds) => {
    // Optimistic: an arrow click moves the row at once, and a refused or
    // failed write puts the previous order back.
    const previous = get().stages
    set(withStages(applyStageOrder(previous, orderedIds)))
    const result = await callIpc('stages.reorder', () => window.api.stages.reorder(orderedIds), BRIDGE_FAILURE)
    if (result.ok) set(withStages(sanitizeStages(result.value)))
    else set(withStages(previous))
    return result
  },

  remove: async (stageId) => {
    const result = await callIpc('stages.remove', () => window.api.stages.remove(stageId), BRIDGE_FAILURE)
    if (result.ok) {
      set(withStages(applyStageOrder(get().stages.filter((stage) => stage.id !== stageId), [])))
      void get().fetchCounts()
    }
    return result
  },

  setJobStage: async (jobIds, stageId) => {
    if (jobIds.length === 0) return { ok: true, value: { jobs: [], skippedIds: [] } }
    return callIpc('stages.setJobStage', () => window.api.stages.setJobStage(jobIds, stageId), BRIDGE_FAILURE)
  },

  subscribeToUpdates: () => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleCounts = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void get().fetchCounts()
      }, COUNTS_REFRESH_DELAY_MS)
    }
    const removeChanged = window.api.stages.onChanged(() => void get().fetch())
    const removeUpdated = window.api.jobs.onUpdated(scheduleCounts)
    const removeRemoved = window.api.jobs.onRemoved(scheduleCounts)
    return () => {
      if (timer) clearTimeout(timer)
      removeChanged()
      removeUpdated()
      removeRemoved()
    }
  }
}))
