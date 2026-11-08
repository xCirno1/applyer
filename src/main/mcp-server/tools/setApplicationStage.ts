import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { getJob } from '../../db/repositories/jobsRepository'
import { StageError, findStage, listStages, setJobsStage } from '../../db/repositories/applicationStagesRepository'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { broadcastJobUpdate, broadcastStagesChanged } from '../../ipc/jobsBroadcast'
import { jsonResult, textError } from '../toolResult'
import type { setApplicationStageShape } from '../schemas'

type Args = { [K in keyof typeof setApplicationStageShape]: z.infer<(typeof setApplicationStageShape)[K]> }

function stageNames(): string {
  return listStages()
    .map((stage) => `"${stage.label}"`)
    .join(', ')
}

/**
 * Records what happened to a submitted application ("Interviewing",
 * "Rejected", ...), or with no stage clears it. Addressed by name like
 * `assign_resume`; an unknown name lists what exists instead of guessing,
 * and only a Submitted job takes a stage, since the stages describe the
 * employer's side of an application the user has already sent.
 */
export async function setApplicationStageTool(args: Args): Promise<CallToolResult> {
  let job
  try {
    job = getJob(args.jobId)
  } catch (err) {
    return textError(`The job could not be read: ${String(err)}`)
  }
  if (!job) return textError(`No tracked job with id ${args.jobId}. Use list_jobs to find it.`)
  if (job.status !== 'submitted') {
    return textError(
      `"${job.title}" at ${job.company} is ${job.status}, not submitted. Stages only apply to applications the user has submitted.`
    )
  }

  let stageId: string | null = null
  let stageName: string | null = null
  if (args.stage) {
    let stage
    try {
      stage = findStage(args.stage)
    } catch (err) {
      return textError(`The application stages could not be read: ${String(err)}`)
    }
    if (!stage) {
      return textError(
        `No application stage named "${args.stage}". Existing stages: ${stageNames()}. Pick one of those, or ask the user to add a new one in Applyer.`
      )
    }
    stageId = stage.id
    stageName = stage.label
  }

  try {
    const result = setJobsStage([job.id], stageId)
    for (const updated of result.updated) broadcastJobUpdate(updated)
    if (result.updated.length > 0) broadcastStagesChanged()
  } catch (err) {
    if (err instanceof StageError) return textError(err.message)
    logActivity('error', 'Agent stage change failed', { jobId: job.id, error: String(err) })
    return textError(`Failed to set the application stage: ${String(err)}`)
  }

  logActivity(
    'info',
    stageName
      ? `Agent moved ${job.title} at ${job.company} to the "${stageName}" stage`
      : `Agent cleared the stage of ${job.title} at ${job.company}`,
    { jobId: job.id, stageId }
  )
  return jsonResult({
    status: stageName ? 'stage_set' : 'stage_cleared',
    jobId: job.id,
    stage: stageName,
    message: stageName ? `"${job.title}" is now in the "${stageName}" stage.` : `"${job.title}" no longer has a stage.`
  })
}
