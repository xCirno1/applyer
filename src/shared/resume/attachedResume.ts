import { isResumeTemplateId, normalizeResumeVariantName, type ResumeTemplateId } from '../types/resume'

/*
 * Which resume an application got, recorded on the job the moment the form
 * accepted the file, plus the shape the agent is told ahead of time about
 * which resume a fill would attach.
 *
 * The record is a snapshot rather than a pointer: a variant can be renamed,
 * rewritten or deleted after the application went out, and "what did this
 * application send" must keep its answer. It lives on the `jobs` row, which
 * whole-database encryption already covers like every other job column; it
 * holds no resume content and no file name (the file name is the user's full
 * name), only which kind of resume it was, the variant's name and template,
 * and when.
 *
 * Plain module, no Node or DOM: the main process normalizes what it reads
 * back from the database (and from an import bundle) with it, and the
 * renderer reads the same type off `JobRecord`.
 */

export type ResumeAttachmentSource = 'variant' | 'master' | 'original'

export const RESUME_ATTACHMENT_SOURCES: readonly ResumeAttachmentSource[] = ['variant', 'master', 'original']

export interface JobAttachedResume {
  source: ResumeAttachmentSource
  /** Variant only: its id when attached. Dropped on import, where ids are minted afresh, and cleared nowhere else: a deleted variant leaves a dangling id, which is why `variantName` is kept too. */
  variantId: string | null
  /** Variant only: its name when attached. */
  variantName: string | null
  /** The template a rendered resume used; null for the original upload. */
  templateId: ResumeTemplateId | null
  /** Variant only: it was written against an older master than the one current at attach time. */
  stale: boolean
  attachedAt: string
}

/**
 * Which resume a fill attaches to a resume file field. `assigned` (the
 * default) is the job's variant, else whatever the fallback setting says;
 * `master` and `original` force one of those, which is how the agent retries
 * a field after the assigned resume could not be rendered, or follows a user
 * who asked for a specific one.
 */
export type ResumeAttachmentPreference = 'assigned' | 'master' | 'original'

export const RESUME_ATTACHMENT_PREFERENCES: readonly ResumeAttachmentPreference[] = ['assigned', 'master', 'original']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSource(value: unknown): value is ResumeAttachmentSource {
  return typeof value === 'string' && (RESUME_ATTACHMENT_SOURCES as readonly string[]).includes(value)
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !Number.isNaN(Date.parse(value))
}

/**
 * Reads a stored or imported record, never trusting its shape. Anything
 * that is not a usable record is null ("nothing recorded") rather than a
 * crash, and fields that do not belong to the record's source are dropped:
 * an original upload has no variant name or template, whatever the row says.
 * A variant record without a usable name is not a usable record, since the
 * name is the one thing the user would be shown.
 */
export function normalizeAttachedResume(value: unknown): JobAttachedResume | null {
  if (!isRecord(value)) return null
  if (!isSource(value.source) || !isIsoTimestamp(value.attachedAt)) return null
  const source = value.source
  const templateId = source !== 'original' && isResumeTemplateId(value.templateId) ? value.templateId : null
  if (source === 'variant') {
    const variantName = normalizeResumeVariantName(value.variantName)
    if (!variantName) return null
    const variantId = typeof value.variantId === 'string' && value.variantId.length > 0 && value.variantId.length <= 64
      ? value.variantId
      : null
    return { source, variantId, variantName, templateId, stale: value.stale === true, attachedAt: value.attachedAt }
  }
  return { source, variantId: null, variantName: null, templateId, stale: false, attachedAt: value.attachedAt }
}

export function isResumeAttachmentPreference(value: unknown): value is ResumeAttachmentPreference {
  return typeof value === 'string' && (RESUME_ATTACHMENT_PREFERENCES as readonly string[]).includes(value)
}
