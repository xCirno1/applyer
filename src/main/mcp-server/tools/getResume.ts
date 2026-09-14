import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { getJob } from '../../db/repositories/jobsRepository'
import {
  getMasterResume,
  getVariantByJob,
  isVariantStale,
  listVariantSummaries
} from '../../db/repositories/resumeRepository'
import { getResumeSettings, isOnboardingCompleted } from '../../db/repositories/settingsRepository'
import { listDocuments } from '../../db/repositories/documentsRepository'
import { diffResumeContent } from '@shared/resume/resumeDiff'
import { jsonResult, textError } from '../toolResult'
import type { getResumeShape } from '../schemas'

type Args = { [K in keyof typeof getResumeShape]: z.infer<(typeof getResumeShape)[K]> }

/**
 * The agent's read of the structured resume: the master, the list of
 * variants (names, not content, since that is what it picks from before
 * `assign_resume`), and with a job the variant assigned to it. With no
 * master yet, this is a normal (non-error) result that says so and points
 * at the uploaded resume it could be built from, since "no master" is the
 * expected state the first time and the next step is `set_master_resume`,
 * not a retry.
 */
export async function getResumeTool(args?: Args): Promise<CallToolResult> {
  if (!isOnboardingCompleted()) {
    return textError('No profile found. Open Applyer and complete onboarding before working with resumes.')
  }

  let master
  try {
    master = getMasterResume()
  } catch (err) {
    return textError(`The stored master resume could not be read: ${String(err)}`)
  }
  const settings = getResumeSettings()

  if (!master) {
    const uploadedResume = listDocuments().find((document) => document.kind === 'resume')
    return jsonResult({
      master: null,
      variants: [],
      settings,
      message: uploadedResume
        ? `No master resume exists yet. Build one from the uploaded resume "${uploadedResume.originalFilename}": call get_profile with includeDocumentText true, convert the text into structured content without changing any wording, and send it to set_master_resume with sourceDocumentId "${uploadedResume.id}".`
        : 'No master resume exists yet and no resume has been uploaded. Ask the user for their resume, or build the master from what they tell you, then call set_master_resume.'
    })
  }

  const result: Record<string, unknown> = {
    master: {
      content: master.content,
      templateId: master.templateId,
      pageSize: master.pageSize,
      style: master.style,
      sourceDocumentId: master.sourceDocumentId,
      updatedAt: master.updatedAt
    },
    variants: listVariantSummaries().map((variant) => ({
      name: variant.name,
      templateId: variant.templateId,
      stale: variant.stale,
      updatedAt: variant.updatedAt,
      jobsUsing: variant.jobs.map((job) => ({ id: job.id, title: job.title, company: job.company, status: job.status }))
    })),
    settings
  }

  if (args?.jobId) {
    const job = getJob(args.jobId)
    if (!job) return textError(`No tracked job with id ${args.jobId}.`)
    let variant
    try {
      variant = getVariantByJob(args.jobId)
    } catch (err) {
      return textError(`The stored resume variant could not be read: ${String(err)}`)
    }
    result.job = { id: job.id, title: job.title, company: job.company, status: job.status }
    result.variant = variant
      ? {
          name: variant.name,
          content: variant.content,
          templateId: variant.templateId,
          updatedAt: variant.updatedAt,
          stale: isVariantStale(variant),
          diffSummary: diffResumeContent(master.content, variant.content).summary
        }
      : null
    result.willAttach = variant ? 'variant' : settings.fallbackAttachment
  }

  return jsonResult(result)
}
