import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { runEditTask } from '../../browser/fillTaskRunner'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { jsonResult, textError } from '../toolResult'
import type { editApplicationShape } from '../schemas'

type Args = { [K in keyof typeof editApplicationShape]: z.infer<(typeof editApplicationShape)[K]> }

export async function editApplicationTool(args: Args): Promise<CallToolResult> {
  try {
    const result = await runEditTask(args.jobId, args.answers)
    logActivity('info', `edit_application -> ${result.status}`, { jobId: args.jobId })
    return jsonResult(result)
  } catch (error) {
    logActivity('error', 'edit_application threw unexpectedly', { jobId: args.jobId, error: String(error) })
    return textError(`Failed to edit application: ${String(error)}`)
  }
}
