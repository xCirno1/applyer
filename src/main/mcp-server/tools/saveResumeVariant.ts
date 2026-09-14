import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { getJob } from '../../db/repositories/jobsRepository'
import {
  ResumeVariantError,
  assignVariant,
  getMasterResume,
  getVariantByName,
  listJobsUsingVariant,
  saveVariant
} from '../../db/repositories/resumeRepository'
import { isOnboardingCompleted } from '../../db/repositories/settingsRepository'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { broadcastJobUpdate, broadcastResumesChanged } from '../../ipc/jobsBroadcast'
import { validateResumeContent } from '@shared/resume/resumeContentSchema'
import { diffResumeContent, unknownResumeIds } from '@shared/resume/resumeDiff'
import { jsonResult, textError } from '../toolResult'
import type { saveResumeVariantShape } from '../schemas'

type Args = { [K in keyof typeof saveResumeVariantShape]: z.infer<(typeof saveResumeVariantShape)[K]> }

/**
 * Creates or replaces a named variant, and optionally assigns it to a job
 * in the same call (the common "tailor for this posting" case is one call,
 * not two). The one rule enforced beyond the schema is the fabrication
 * check: every `entries` entry and every `groups` group in the variant must
 * carry an id that exists somewhere in the master. A job, degree, project
 * or skill category the user never listed is refused with the offending
 * ids, since rewording and reordering are the whole point and adding a
 * credential is the one thing tailoring must never do. Sections themselves
 * are free-form: dropping, reordering, retitling, or adding a `text`/`list`
 * section (a targeted summary, a "Highlights" list) is allowed.
 */
export async function saveResumeVariantTool(args: Args): Promise<CallToolResult> {
  if (!isOnboardingCompleted()) {
    return textError('No profile found. Open Applyer and complete onboarding before working with resumes.')
  }

  const job = args.assignJobId ? getJob(args.assignJobId) : null
  if (args.assignJobId && !job) {
    return textError(`No tracked job with id ${args.assignJobId}. Queue it with queue_job first, or leave assignJobId out.`)
  }

  let master
  try {
    master = getMasterResume()
  } catch (err) {
    return textError(`The stored master resume could not be read: ${String(err)}`)
  }
  if (!master) {
    return textError(
      'No master resume exists yet. Call get_resume for how to build one with set_master_resume, then write variants from it.'
    )
  }

  const validation = validateResumeContent(args.content)
  if (!validation.ok) return textError(`Invalid resume content: ${validation.message}`)

  const unknown = unknownResumeIds(master.content, validation.content)
  if (unknown.entries.length > 0 || unknown.groups.length > 0) {
    const parts: string[] = []
    if (unknown.entries.length > 0) parts.push(`entries ${unknown.entries.join(', ')}`)
    if (unknown.groups.length > 0) parts.push(`skill groups ${unknown.groups.join(', ')}`)
    logActivity('warn', 'Agent resume variant refused: content not in the master', {
      name: args.name,
      unknownEntries: unknown.entries,
      unknownGroups: unknown.groups
    })
    return textError(
      `Refused: the variant contains ${parts.join(' and ')} that do not exist in the master resume. A tailored resume may reword, reorder, drop, or regroup what the user already has, but never add a job, degree, project, or skill category. Reuse the master's ids for every entry and group; if the user genuinely has new experience, add it to the master with set_master_resume first.`
    )
  }

  let replaced = false
  let previouslyUsedBy = 0
  try {
    const existing = getVariantByName(args.name)
    if (existing) {
      replaced = true
      previouslyUsedBy = listJobsUsingVariant(existing.id).length
    }
  } catch (err) {
    return textError(`The stored resume variant could not be read: ${String(err)}`)
  }

  let variant
  try {
    variant = saveVariant({ name: args.name, content: validation.content, templateId: args.templateId })
  } catch (err) {
    if (err instanceof ResumeVariantError) return textError(err.message)
    logActivity('error', 'Agent resume variant save failed', { name: args.name, error: String(err) })
    return textError(`Failed to save the resume variant: ${String(err)}`)
  }

  if (job) {
    try {
      const updated = assignVariant(job.id, variant.id)
      broadcastJobUpdate(updated)
    } catch (err) {
      logActivity('error', 'Agent resume variant assignment failed', { jobId: job.id, error: String(err) })
      broadcastResumesChanged()
      return textError(`The variant "${variant.name}" was saved but could not be assigned to the job: ${String(err)}`)
    }
  }

  const diff = diffResumeContent(master.content, validation.content)
  logActivity(
    'info',
    job
      ? `Agent wrote the resume variant "${variant.name}" and assigned it to ${job.title} at ${job.company}`
      : `Agent ${replaced ? 'replaced' : 'wrote'} the resume variant "${variant.name}"`,
    {
      variantId: variant.id,
      jobId: job?.id,
      templateId: variant.templateId,
      added: diff.summary.added,
      removed: diff.summary.removed,
      changed: diff.summary.changed
    }
  )
  broadcastResumesChanged()

  const jobsUsing = listJobsUsingVariant(variant.id).length
  const assignedNote = job ? ` It is assigned to ${job.title} at ${job.company} and will be attached when fill_application uploads the resume for that job.` : ''
  const replacedNote =
    replaced && previouslyUsedBy > 0
      ? ` The previous content was replaced; the ${previouslyUsedBy} job(s) already using this variant get the new content too.`
      : replaced
        ? ' The previous content was replaced.'
        : ''
  return jsonResult({
    status: replaced ? 'replaced' : 'created',
    name: variant.name,
    templateId: variant.templateId,
    assignedJobId: job?.id ?? null,
    jobsUsing,
    diffSummary: diff.summary,
    message: `Resume variant "${variant.name}" ${replaced ? 'replaced' : 'saved'}.${assignedNote}${replacedNote} The user can review the changes against the master on the Resume Variants page. Use assign_resume to point other jobs at it.`
  })
}
