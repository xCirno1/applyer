import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { runFillTask } from '../../browser/fillTaskRunner'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { jsonResult, textError } from '../toolResult'
import type { fillApplicationShape } from '../schemas'

type Args = { [K in keyof typeof fillApplicationShape]: z.infer<(typeof fillApplicationShape)[K]> }

export async function fillApplicationTool(args: Args): Promise<CallToolResult> {
  try {
    const result = await runFillTask(args.jobId)
    logActivity('info', `fill_application -> ${result.status}`, { jobId: args.jobId })
    return jsonResult(result)
  } catch (err) {
    logActivity('error', 'fill_application threw unexpectedly', { jobId: args.jobId, error: String(err) })
    return textError(`Failed to fill application: ${String(err)}`)
  }
}
