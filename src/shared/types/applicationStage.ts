/**
 * Post-submission stages: what happened to an application after the user
 * submitted it ("Awaiting response", "Interviewing", "Offer", ...).
 *
 * Only a Submitted job carries a stage; the four board statuses describe the
 * application's progress through Applyer, a stage describes its progress
 * through the employer's process, which Applyer never sees on its own. A
 * stage is one ordered list shared by every job: a handful of built-in ones
 * (fixed ids, translated labels, never renamed or deleted, so the agent can
 * always address them the same way) plus whatever the user adds.
 *
 * This module is the plain rules both processes share: the built-in set, how
 * a label is normalised and validated, and how a stage reference is resolved
 * by name. The database side is `main/db/repositories/applicationStagesRepository.ts`.
 */

export const BUILTIN_STAGE_IDS = ['awaiting_response', 'interviewing', 'offer', 'rejected', 'withdrawn'] as const

export type BuiltinStageId = (typeof BUILTIN_STAGE_IDS)[number]

/**
 * English labels for the built-in stages. The renderer shows a translated
 * label instead (`board:stages.builtin.<id>`); these are what the agent, the
 * CSV export and the logs read, since the main process has no locale.
 */
export const BUILTIN_STAGE_LABELS: Record<BuiltinStageId, string> = {
  awaiting_response: 'Awaiting response',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn'
}

export function isBuiltinStageId(value: unknown): value is BuiltinStageId {
  return typeof value === 'string' && (BUILTIN_STAGE_IDS as readonly string[]).includes(value)
}

export interface ApplicationStage {
  id: string
  /** The user's label for a custom stage; the English default for a built-in one (see `BUILTIN_STAGE_LABELS`). */
  label: string
  isBuiltin: boolean
  /** 0-based display order; unique across all stages. */
  position: number
}

/** How many Submitted jobs sit in each stage. `stageId: null` is "no stage yet". */
export interface StageCount {
  stageId: string | null
  count: number
}

export const STAGE_LABEL_MAX_LENGTH = 40
/** Custom stages only; the built-in ones never count against it. */
export const MAX_CUSTOM_STAGES = 30

/** Collapses inner whitespace and trims, so "  Phone   screen " and "Phone screen" are the same stage. */
export function normalizeStageLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export type StageLabelProblem = 'empty' | 'tooLong'

export function checkStageLabel(raw: unknown): { ok: true; label: string } | { ok: false; problem: StageLabelProblem } {
  if (typeof raw !== 'string') return { ok: false, problem: 'empty' }
  const label = normalizeStageLabel(raw)
  if (label.length === 0) return { ok: false, problem: 'empty' }
  if (label.length > STAGE_LABEL_MAX_LENGTH) return { ok: false, problem: 'tooLong' }
  return { ok: true, label }
}

/** The key stage names are compared on: case-insensitive, whitespace-normalised. */
export function stageNameKey(raw: string): string {
  return normalizeStageLabel(raw).toLocaleLowerCase('en-US')
}

/**
 * Finds the stage a free-text reference means: a stage id, a built-in's
 * English label, or a custom label, all case-insensitively. Used by the
 * agent's tools (which address stages by name, the way they address resume
 * variants) and by import, where ids from another install mean nothing.
 */
export function findStageByReference(stages: readonly ApplicationStage[], reference: string): ApplicationStage | null {
  const key = stageNameKey(reference)
  if (key.length === 0) return null
  return (
    stages.find((stage) => stage.id === reference) ??
    stages.find((stage) => stageNameKey(stage.id) === key) ??
    stages.find((stage) => stageNameKey(stage.label) === key) ??
    null
  )
}

/** True when `label` would clash with an existing stage other than `exceptId` (built-in labels and ids included). */
export function isStageLabelTaken(stages: readonly ApplicationStage[], label: string, exceptId?: string): boolean {
  const key = stageNameKey(label)
  return stages.some(
    (stage) => stage.id !== exceptId && (stageNameKey(stage.label) === key || (stage.isBuiltin && stageNameKey(stage.id) === key))
  )
}

/**
 * Drops anything that is not a stage with the fields the UI reads, and
 * orders what is left by position. A malformed list from the bridge
 * degrades to the stages that are readable rather than breaking every card.
 */
export function sanitizeStages(value: unknown): ApplicationStage[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is ApplicationStage =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ApplicationStage).id === 'string' &&
        (item as ApplicationStage).id.length > 0 &&
        typeof (item as ApplicationStage).label === 'string' &&
        typeof (item as ApplicationStage).isBuiltin === 'boolean' &&
        typeof (item as ApplicationStage).position === 'number' &&
        Number.isFinite((item as ApplicationStage).position)
    )
    .map((item) => ({ id: item.id, label: item.label, isBuiltin: item.isBuiltin, position: item.position }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}

/** Same idea for the per-stage counts: unreadable entries are dropped, negative or fractional counts refused. */
export function sanitizeStageCounts(value: unknown): StageCount[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is StageCount =>
      typeof item === 'object' &&
      item !== null &&
      ((item as StageCount).stageId === null || typeof (item as StageCount).stageId === 'string') &&
      Number.isInteger((item as StageCount).count) &&
      (item as StageCount).count >= 0
  )
}

/**
 * Applies a requested order to the current stages: ids named in `orderedIds`
 * come first in that order, unknown or repeated ids are ignored, and any
 * stage the request left out keeps its relative place after them. Positions
 * come back dense from 0. Tolerant on purpose: a reorder request that raced
 * a delete (or a create from the agent) still lands on a valid order rather
 * than being refused.
 */
export function applyStageOrder(stages: readonly ApplicationStage[], orderedIds: readonly string[]): ApplicationStage[] {
  const byId = new Map(stages.map((stage) => [stage.id, stage]))
  const seen = new Set<string>()
  const ordered: ApplicationStage[] = []
  for (const id of orderedIds) {
    const stage = byId.get(id)
    if (!stage || seen.has(id)) continue
    seen.add(id)
    ordered.push(stage)
  }
  const rest = [...stages]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .filter((stage) => !seen.has(stage.id))
  return [...ordered, ...rest].map((stage, position) => ({ ...stage, position }))
}

/** Moves one stage by `delta` places (clamped), for the manager's up/down buttons; returns the new id order. */
export function moveStage(stages: readonly ApplicationStage[], id: string, delta: number): string[] {
  const ids = [...stages].sort((a, b) => a.position - b.position).map((stage) => stage.id)
  const from = ids.indexOf(id)
  if (from === -1) return ids
  const to = Math.min(Math.max(from + delta, 0), ids.length - 1)
  if (to === from) return ids
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  return ids
}
