import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { runEditTask } from '../../browser/fillTaskRunner'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { getJob } from '../../db/repositories/jobsRepository'
import { recordRunEvent } from '../../runs/runTracker'
import { jsonResult, textError } from '../toolResult'
import type { editApplicationShape } from '../schemas'

type Args = { [K in keyof typeof editApplicationShape]: z.infer<(typeof editApplicationShape)[K]> }

export async function editApplicationTool(args: Args): Promise<CallToolResult> {
  try {
    const result = await runEditTask(args.jobId, args.answers)
    logActivity('info', `edit_application -> ${result.status}`, { jobId: args.jobId })
    recordRunEvent('form_filled', {
      source: getJob(args.jobId)?.source ?? null,
      jobId: args.jobId,
      meta: {
        status: result.status,
        mode: 'edit',
        ...('filledFields' in result ? { filledFields: result.filledFields.length, skippedFields: result.skippedFields.length } : {}),
        ...('reasonTag' in result ? { reasonTag: result.reasonTag } : {})
      }
    })
    return jsonResult(result)
  } catch (error) {
    logActivity('error', 'edit_application threw unexpectedly', { jobId: args.jobId, error: String(error) })
    return textError(`Failed to edit application: ${String(error)}`)
  }
}
