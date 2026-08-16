import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { getJob, IllegalTransitionError } from '../../db/repositories/jobsRepository'
import { failJob } from '../../jobActions'
import { jsonResult, textError } from '../toolResult'
import type { flagFailureShape } from '../schemas'

type Args = { [K in keyof typeof flagFailureShape]: z.infer<(typeof flagFailureShape)[K]> }

export async function flagFailureTool(args: Args): Promise<CallToolResult> {
  const job = getJob(args.jobId)
  if (!job) {
    return textError(`No job found with id ${args.jobId}`)
  }

  try {
    const updated = failJob(args.jobId, args.reasonTag, args.message)
    return jsonResult({ jobId: updated.id, status: updated.status })
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return textError(err.message)
    }
    return textError(`Failed to flag job: ${String(err)}`)
  }
}
