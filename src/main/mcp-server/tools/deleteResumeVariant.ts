import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { deleteVariant, getVariantByName, listJobsUsingVariant } from '../../db/repositories/resumeRepository'
import { getResumeSettings, isOnboardingCompleted } from '../../db/repositories/settingsRepository'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { broadcastJobUpdate, broadcastResumesChanged } from '../../ipc/jobsBroadcast'
import { getJob } from '../../db/repositories/jobsRepository'
import { jsonResult, textError } from '../toolResult'
import type { deleteResumeVariantShape } from '../schemas'

type Args = { [K in keyof typeof deleteResumeVariantShape]: z.infer<(typeof deleteResumeVariantShape)[K]> }

/**
 * Deletes a variant by name; every job using it goes back to the fallback
 * attachment, and the result says how many so the agent can tell the user.
 * A name that matches nothing is reported, not an error.
 */
export async function deleteResumeVariantTool(args: Args): Promise<CallToolResult> {
  if (!isOnboardingCompleted()) {
    return textError('No profile found. Open Applyer and complete onboarding before working with resumes.')
  }

  let variant
  try {
    variant = getVariantByName(args.name)
  } catch (err) {
    return textError(`The stored resume variant could not be read: ${String(err)}`)
  }
  const fallback = getResumeSettings().fallbackAttachment
  const fallbackLabel = fallback === 'master' ? 'master resume' : 'originally uploaded resume'
  if (!variant) {
    return jsonResult({
      status: 'not_found',
      name: args.name,
      unassignedJobs: 0,
      willAttach: fallback,
      message: `No resume variant named "${args.name}" exists.`
    })
  }

  const affectedJobIds = listJobsUsingVariant(variant.id).map((job) => job.id)
  let result: { removed: boolean; unassignedJobs: number }
  try {
    result = deleteVariant(variant.id)
  } catch (err) {
    return textError(`Failed to remove the resume variant: ${String(err)}`)
  }
  logActivity('info', `Agent removed the resume variant "${variant.name}"`, {
    variantId: variant.id,
    unassignedJobs: result.unassignedJobs
  })
  // The jobs' rows changed (their assignment was cleared by the database),
  // so the board hears about each one as well as the variant list.
  for (const jobId of affectedJobIds) {
    const job = getJob(jobId)
    if (job) broadcastJobUpdate(job)
  }
  broadcastResumesChanged()

  return jsonResult({
    status: 'removed',
    name: variant.name,
    unassignedJobs: result.unassignedJobs,
    willAttach: fallback,
    message:
      result.unassignedJobs > 0
        ? `Resume variant "${variant.name}" removed. ${result.unassignedJobs} job(s) were using it and will now get the ${fallbackLabel}.`
        : `Resume variant "${variant.name}" removed. No job was using it.`
  })
}
