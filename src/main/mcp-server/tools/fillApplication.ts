import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { runFillTask } from '../../browser/fillTaskRunner'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { getJob } from '../../db/repositories/jobsRepository'
import { recordRunEvent } from '../../runs/runTracker'
import { jsonResult, textError } from '../toolResult'
import type { fillApplicationShape } from '../schemas'

type Args = {
  jobId: z.infer<typeof fillApplicationShape.jobId>
  answers: z.infer<typeof fillApplicationShape.answers>
  finalStep?: z.infer<typeof fillApplicationShape.finalStep>
}

export async function fillApplicationTool(args: Args): Promise<CallToolResult> {
  try {
    const result = await runFillTask(args.jobId, args.answers, args.finalStep ?? false)
    logActivity('info', `fill_application -> ${result.status}`, { jobId: args.jobId })
    recordRunEvent('form_filled', {
      source: getJob(args.jobId)?.source ?? null,
      jobId: args.jobId,
      meta: {
        status: result.status,
        mode: 'fill',
        finalStep: args.finalStep ?? false,
        ...('filledFields' in result ? { filledFields: result.filledFields.length, skippedFields: result.skippedFields.length } : {}),
        ...('reasonTag' in result ? { reasonTag: result.reasonTag } : {})
      }
    })
    return jsonResult(result)
  } catch (err) {
    logActivity('error', 'fill_application threw unexpectedly', { jobId: args.jobId, error: String(err) })
    return textError(`Failed to fill application: ${String(err)}`)
  }
}
