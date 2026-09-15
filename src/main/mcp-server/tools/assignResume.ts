import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { getJob } from '../../db/repositories/jobsRepository'
import {
  ResumeVariantError,
  assignVariant,
  getVariantByName,
  isVariantStale,
  listVariantSummaries
} from '../../db/repositories/resumeRepository'
import { getResumeSettings, isOnboardingCompleted } from '../../db/repositories/settingsRepository'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { recordRunEvent } from '../../runs/runTracker'
import { broadcastJobUpdate, broadcastResumesChanged } from '../../ipc/jobsBroadcast'
import { jsonResult, textError } from '../toolResult'
import type { assignResumeShape } from '../schemas'

type Args = { [K in keyof typeof assignResumeShape]: z.infer<(typeof assignResumeShape)[K]> }

/**
 * Points a job at an existing variant by name, or back at the fallback when
 * the name is left out. This is the cheap half of tailoring: most postings
 * are close enough to a variant the user already has, and assigning one is
 * a lookup rather than a rewrite. An unknown name lists what exists, since
 * the agent's next move is to pick one of those or write a new one.
 */
export async function assignResumeTool(args: Args): Promise<CallToolResult> {
  if (!isOnboardingCompleted()) {
    return textError('No profile found. Open Applyer and complete onboarding before working with resumes.')
  }

  const job = getJob(args.jobId)
  if (!job) return textError(`No tracked job with id ${args.jobId}. Queue it with queue_job first.`)

  const settings = getResumeSettings()
  const fallbackLabel = settings.fallbackAttachment === 'master' ? 'master resume' : 'originally uploaded resume'

  if (!args.variantName) {
    try {
      const updated = assignVariant(job.id, null)
      broadcastJobUpdate(updated)
    } catch (err) {
      if (err instanceof ResumeVariantError) return textError(err.message)
      return textError(`Failed to unassign the resume variant: ${String(err)}`)
    }
    logActivity('info', `Agent unassigned the resume variant from ${job.title} at ${job.company}`, { jobId: job.id })
    broadcastResumesChanged()
    recordRunEvent('resume_assigned', { source: job.source, jobId: job.id, meta: { assigned: false } })
    return jsonResult({
      status: 'unassigned',
      jobId: job.id,
      variant: null,
      willAttach: settings.fallbackAttachment,
      message: `This job now gets the ${fallbackLabel}.`
    })
  }

  let variant
  try {
    variant = getVariantByName(args.variantName)
  } catch (err) {
    return textError(`The stored resume variant could not be read: ${String(err)}`)
  }
  if (!variant) {
    const names = listVariantSummaries().map((summary) => summary.name)
    return textError(
      names.length > 0
        ? `No resume variant named "${args.variantName}". Existing variants: ${names.map((name) => `"${name}"`).join(', ')}. Pick one of those, or write a new one with save_resume_variant.`
        : `No resume variant named "${args.variantName}", and no variants exist yet. Write one with save_resume_variant.`
    )
  }

  try {
    const updated = assignVariant(job.id, variant.id)
    broadcastJobUpdate(updated)
  } catch (err) {
    if (err instanceof ResumeVariantError) return textError(err.message)
    logActivity('error', 'Agent resume variant assignment failed', { jobId: job.id, error: String(err) })
    return textError(`Failed to assign the resume variant: ${String(err)}`)
  }
  logActivity('info', `Agent assigned the resume variant "${variant.name}" to ${job.title} at ${job.company}`, {
    jobId: job.id,
    variantId: variant.id
  })
  broadcastResumesChanged()
  recordRunEvent('resume_assigned', { source: job.source, jobId: job.id, meta: { assigned: true, name: variant.name } })

  const stale = isVariantStale(variant)
  return jsonResult({
    status: 'assigned',
    jobId: job.id,
    variant: { name: variant.name, templateId: variant.templateId, stale },
    willAttach: 'variant',
    message: `"${variant.name}" will be attached when fill_application uploads the resume for this job.${
      stale ? ' Note that it is based on an older master resume; offer to refresh it with save_resume_variant.' : ''
    }`
  })
}
