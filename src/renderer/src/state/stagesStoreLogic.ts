import type { JobRecord } from '@shared/types/job'
import { isBuiltinStageId, type ApplicationStage, type BuiltinStageId, type StageCount } from '@shared/types/applicationStage'

/*
 * The rules behind the board's post-submission stages, kept free of React
 * and zustand so they are testable on their own (same split as
 * `chatStoreLogic.ts` vs `chatStore.ts`).
 *
 * A stage filter is one string: the two sentinels below, or a stage id.
 * Built-in ids are fixed snake_case words and custom ids are UUIDs, so
 * neither can collide with a sentinel.
 */

/** Every Submitted job, whatever its stage. */
export const STAGE_FILTER_ALL = '__all__'
/** Submitted jobs that have no stage yet. */
export const STAGE_FILTER_NONE = '__none__'

export type StageFilter = string

/**
 * What the Submitted column's `jobs.list` call should carry: `undefined`
 * for no filter, `null` for "no stage", or the stage id.
 */
export function stageFilterToQuery(filter: StageFilter): string | null | undefined {
  if (filter === STAGE_FILTER_ALL) return undefined
  if (filter === STAGE_FILTER_NONE) return null
  return filter
}

/**
 * Whether a job belongs in its column under the stage filter. Only the
 * Submitted column is filtered: no other status carries a stage.
 */
export function jobMatchesStageFilter(job: Pick<JobRecord, 'status' | 'stageId'>, filter: StageFilter): boolean {
  if (job.status !== 'submitted' || filter === STAGE_FILTER_ALL) return true
  if (filter === STAGE_FILTER_NONE) return job.stageId === null
  return job.stageId === filter
}

/**
 * A filter naming a stage that no longer exists (deleted here or by an
 * import elsewhere) falls back to showing everything, rather than leaving
 * the column empty for a reason nothing on screen explains.
 */
export function coerceStageFilter(filter: StageFilter, stages: readonly ApplicationStage[]): StageFilter {
  if (filter === STAGE_FILTER_ALL || filter === STAGE_FILTER_NONE) return filter
  return stages.some((stage) => stage.id === filter) ? filter : STAGE_FILTER_ALL
}

/**
 * Which built-in a stage is, for looking its translated name up, or `null`
 * for a custom stage, which shows exactly what the user typed. Built-ins
 * keep their English label in the database for the agent and exports; the
 * screen translates them.
 */
export function builtinStageKey(stage: Pick<ApplicationStage, 'id' | 'isBuiltin'>): BuiltinStageId | null {
  return stage.isBuiltin && isBuiltinStageId(stage.id) ? stage.id : null
}

const warnedUnknownStageIds = new Set<string>()

/**
 * Looks a job's stage id up in the loaded list. An id the list does not
 * have (a stage deleted a moment ago, or a list that has not loaded yet
 * while the jobs have) is shown as no stage, and warned about once per id so
 * a card re-rendering does not flood the console.
 */
export function findJobStage(
  stageId: string | null,
  stagesById: ReadonlyMap<string, ApplicationStage>,
  stagesLoaded: boolean
): ApplicationStage | null {
  if (!stageId) return null
  const stage = stagesById.get(stageId)
  if (stage) return stage
  if (stagesLoaded && !warnedUnknownStageIds.has(stageId)) {
    warnedUnknownStageIds.add(stageId)
    console.warn(`A job points at unknown stage ${stageId}; showing it as having no stage`)
  }
  return null
}

/** Test seam: forget which unknown ids were already warned about. */
export function resetUnknownStageWarnings(): void {
  warnedUnknownStageIds.clear()
}

export function indexStages(stages: readonly ApplicationStage[]): Map<string, ApplicationStage> {
  return new Map(stages.map((stage) => [stage.id, stage]))
}

export interface StageCountRow {
  /** `null` is the "no stage yet" bucket. */
  stage: ApplicationStage | null
  count: number
}

/**
 * The overview's stage rows: every stage in the user's order with its count
 * (zero when the counts have not caught up with a stage created a moment
 * ago), then the no-stage bucket. Counts for an id the list does not know
 * are folded into no stage, matching how the main process counts them.
 */
export function stageCountRows(stages: readonly ApplicationStage[], counts: readonly StageCount[]): {
  rows: StageCountRow[]
  total: number
} {
  const byId = new Map<string, number>()
  let none = 0
  const known = new Set(stages.map((stage) => stage.id))
  for (const entry of counts) {
    if (entry.stageId === null || !known.has(entry.stageId)) none += entry.count
    else byId.set(entry.stageId, (byId.get(entry.stageId) ?? 0) + entry.count)
  }
  const rows: StageCountRow[] = stages.map((stage) => ({ stage, count: byId.get(stage.id) ?? 0 }))
  rows.push({ stage: null, count: none })
  return { rows, total: rows.reduce((sum, row) => sum + row.count, 0) }
}

/** How many custom stages exist, for the "N of 30" line in the manager. */
export function customStageCount(stages: readonly ApplicationStage[]): number {
  return stages.filter((stage) => !stage.isBuiltin).length
}

/**
 * Splits a selection for "Set stage": the Submitted jobs it can apply to,
 * how many others were left out, and the stage they all already share
 * (`null` for "all have no stage", `undefined` when they differ or there
 * are none), which the picker marks as current.
 */
export function stageTargets(jobs: readonly Pick<JobRecord, 'id' | 'status' | 'stageId'>[]): {
  ids: string[]
  skipped: number
  current: string | null | undefined
} {
  const submitted = jobs.filter((job) => job.status === 'submitted')
  const first = submitted[0]
  const current = first && submitted.every((job) => job.stageId === first.stageId) ? first.stageId : undefined
  return { ids: submitted.map((job) => job.id), skipped: jobs.length - submitted.length, current }
}
