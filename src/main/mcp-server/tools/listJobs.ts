import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { listJobs } from '../../db/repositories/jobsRepository'
import { findStage, listStages } from '../../db/repositories/applicationStagesRepository'
import { appLogger } from '../../logger'
import { jsonResult, textError } from '../toolResult'
import type { listJobsShape } from '../schemas'

type Args = { [K in keyof typeof listJobsShape]: z.infer<(typeof listJobsShape)[K]> }

/** The `stage` filter value that means "Submitted, but no stage yet". */
const NO_STAGE = 'none'

export async function listJobsTool(args: Args): Promise<CallToolResult> {
  try {
    const stages = listStages()
    const stageNames = new Map(stages.map((stage) => [stage.id, stage.label]))

    // A stage filter implies Submitted: no other status carries a stage.
    let stageId: string | null | undefined
    if (args.stage !== undefined) {
      if (args.status && args.status !== 'submitted') {
        return textError('The stage filter only applies to Submitted jobs; leave status out or set it to submitted.')
      }
      if (args.stage.trim().toLowerCase() === NO_STAGE) stageId = null
      else {
        const stage = findStage(args.stage)
        if (!stage) {
          return textError(
            `No application stage named "${args.stage}". Existing stages: ${stages.map((item) => `"${item.label}"`).join(', ')}, or "${NO_STAGE}".`
          )
        }
        stageId = stage.id
      }
    }

    const result = listJobs({
      status: stageId !== undefined ? 'submitted' : args.status,
      stageId,
      limit: args.limit,
      offset: args.offset
    })
    return jsonResult({
      jobs: result.jobs.map((j) => {
        const stage = j.stageId ? (stageNames.get(j.stageId) ?? null) : null
        if (j.stageId && stage === null) {
          appLogger.warn(`Job ${j.id} points at unknown stage ${j.stageId}; reporting it as having no stage`)
        }
        return {
          jobId: j.id,
          title: j.title,
          company: j.company,
          status: j.status,
          matchScore: j.matchScore,
          failureTag: j.failureTag,
          ...(j.status === 'submitted' ? { stage } : {})
        }
      }),
      total: result.total
    })
  } catch (err) {
    return textError(`Failed to list jobs: ${String(err)}`)
  }
}
