import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { runInspectTask } from '../../browser/fillTaskRunner'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { jsonResult, textError } from '../toolResult'
import type { inspectApplicationShape } from '../schemas'

type Args = { [K in keyof typeof inspectApplicationShape]: z.infer<(typeof inspectApplicationShape)[K]> }

export async function inspectApplicationTool(args: Args): Promise<CallToolResult> {
  try {
    const result = await runInspectTask(args.jobId)
    logActivity('info', `inspect_application -> ${result.status}`, { jobId: args.jobId })
    return jsonResult(result)
  } catch (error) {
    logActivity('error', 'inspect_application threw unexpectedly', { jobId: args.jobId, error: String(error) })
    return textError(`Failed to inspect application: ${String(error)}`)
  }
}
