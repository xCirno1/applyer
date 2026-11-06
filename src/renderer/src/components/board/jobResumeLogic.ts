import type { JobStatus } from '@shared/types/job'
import type { JobAttachedResume, ResumeAttachmentSource } from '@shared/resume/attachedResume'
import type { ResumeFallbackAttachment } from '@shared/types/resume'

/*
 * The plain-module half of `JobResumeBlock`: which resume the next fill
 * would attach, and how that compares with what the job's application
 * already got. No React, so the rules are testable without mounting the
 * modal (same split as `workspace/workspaceLayout.ts` vs
 * `useWorkspaceLayout.ts`).
 */

export interface PlannedResume {
  source: ResumeAttachmentSource
  /** Variant only. */
  variantId: string | null
}

/**
 * What a fill attaches by default, mirroring the main process's
 * `resolveResumeAttachment`: the assigned variant, else (only once a master
 * exists, since nothing else can be rendered) the fallback setting.
 */
export function plannedResume(
  assignedVariantId: string | null,
  hasMaster: boolean,
  fallback: ResumeFallbackAttachment
): PlannedResume {
  if (hasMaster && assignedVariantId) return { source: 'variant', variantId: assignedVariantId }
  if (hasMaster && fallback === 'master') return { source: 'master', variantId: null }
  return { source: 'original', variantId: null }
}

/**
 * Whether what was attached is not what would be attached now. A variant
 * record without an id (imported from another machine) is compared by
 * source only, since there is no id to compare and a name match against the
 * current list would be a guess.
 */
export function attachmentDiffersFromPlan(record: JobAttachedResume, plan: PlannedResume): boolean {
  if (record.source !== plan.source) return true
  if (record.source !== 'variant' || record.variantId === null) return false
  return record.variantId !== plan.variantId
}

export type AttachedNote = 'pendingChange' | 'alreadySent' | null

/**
 * What to say under the "attached" line when the selection no longer
 * matches it. A Queued job's open form can still be refilled, so the next
 * fill fixes it; a Filled or Submitted one already holds (or sent) the old
 * file, and editing never changes attachments. A Failed job is retried as a
 * fresh application, so its old attachment needs no warning.
 */
export function attachedNote(status: JobStatus, differs: boolean): AttachedNote {
  if (!differs) return null
  if (status === 'queued') return 'pendingChange'
  if (status === 'filled' || status === 'submitted') return 'alreadySent'
  return null
}

/**
 * Whether the "will be attached" sentence still means anything: once a
 * Filled or Submitted application has its resume recorded, nothing further
 * will be attached to it, and the record is the answer to show instead.
 */
export function showsPlannedSentence(status: JobStatus, record: JobAttachedResume | null): boolean {
  return record === null || status === 'queued' || status === 'failed'
}
