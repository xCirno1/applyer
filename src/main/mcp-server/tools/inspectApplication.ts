import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { runInspectTask } from '../../browser/fillTaskRunner'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { getJob } from '../../db/repositories/jobsRepository'
import { recordRunEvent } from '../../runs/runTracker'
import { jsonResult, textError } from '../toolResult'
import type { inspectApplicationShape } from '../schemas'

type Args = { [K in keyof typeof inspectApplicationShape]: z.infer<(typeof inspectApplicationShape)[K]> }

export async function inspectApplicationTool(args: Args): Promise<CallToolResult> {
  try {
    const result = await runInspectTask(args.jobId)
    logActivity('info', `inspect_application -> ${result.status}`, { jobId: args.jobId })
    // A challenge is recorded where it is detected (the runner), so here only
    // the outcomes that are the inspection's own.
    if (result.status !== 'paused_captcha') {
      recordRunEvent('form_inspected', {
        source: getJob(args.jobId)?.source ?? null,
        jobId: args.jobId,
        meta: {
          status: result.status,
          ...(result.status === 'inspected' ? { mode: result.mode, fields: result.fields.length, buttons: result.buttons.length } : {}),
          ...('reasonTag' in result ? { reasonTag: result.reasonTag } : {})
        }
      })
    }
    return jsonResult(result)
  } catch (error) {
    logActivity('error', 'inspect_application threw unexpectedly', { jobId: args.jobId, error: String(error) })
    return textError(`Failed to inspect application: ${String(error)}`)
  }
}
