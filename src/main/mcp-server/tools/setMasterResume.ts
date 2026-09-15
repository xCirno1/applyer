import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { saveMasterResume, listVariantSummaries } from '../../db/repositories/resumeRepository'
import { isOnboardingCompleted } from '../../db/repositories/settingsRepository'
import { listDocuments } from '../../db/repositories/documentsRepository'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { recordRunEvent } from '../../runs/runTracker'
import { broadcastResumesChanged } from '../../ipc/jobsBroadcast'
import { validateResumeContent } from '@shared/resume/resumeContentSchema'
import { jsonResult, textError } from '../toolResult'
import type { setMasterResumeShape } from '../schemas'

type Args = { [K in keyof typeof setMasterResumeShape]: z.infer<(typeof setMasterResumeShape)[K]> }

/**
 * Writes (or replaces) the master. The shape is already enforced by the tool
 * schema; what is re-checked here is the whole-document rule the schema
 * cannot express (unique ids). Existing variants are left in place and become
 * stale, which the result says, so the agent can offer to refresh them.
 */
export async function setMasterResumeTool(args: Args): Promise<CallToolResult> {
  if (!isOnboardingCompleted()) {
    return textError('No profile found. Open Applyer and complete onboarding before working with resumes.')
  }

  const validation = validateResumeContent(args.content)
  if (!validation.ok) return textError(`Invalid resume content: ${validation.message}`)

  if (args.sourceDocumentId && !listDocuments().some((document) => document.id === args.sourceDocumentId)) {
    return textError(`No uploaded document with id ${args.sourceDocumentId}. Call get_profile to see the uploaded documents.`)
  }

  let master
  try {
    master = saveMasterResume({
      content: validation.content,
      templateId: args.templateId,
      pageSize: args.pageSize,
      sourceDocumentId: args.sourceDocumentId
    })
  } catch (err) {
    logActivity('error', 'Agent master resume save failed', { error: String(err) })
    return textError(`Failed to save the master resume: ${String(err)}`)
  }

  const sections = master.content.sections.length
  logActivity('info', `Agent saved the master resume (${sections} sections)`, { templateId: master.templateId })
  broadcastResumesChanged()
  recordRunEvent('resume_master_saved', { meta: { sections, templateId: master.templateId } })

  const staleVariants = listVariantSummaries().filter((variant) => variant.stale).length
  return jsonResult({
    status: 'saved',
    templateId: master.templateId,
    pageSize: master.pageSize,
    sections,
    staleVariants,
    message:
      staleVariants > 0
        ? `Master resume saved. ${staleVariants} existing resume variant(s) are now based on an older master; offer to refresh them with save_resume_variant (same name, updated content).`
        : 'Master resume saved. The user can review it on the Resume Variants page.'
  })
}
