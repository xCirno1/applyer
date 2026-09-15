import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { runClickButtonTask } from '../../browser/fillTaskRunner'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { getJob } from '../../db/repositories/jobsRepository'
import { recordRunEvent } from '../../runs/runTracker'
import { jsonResult, textError } from '../toolResult'
import type { clickApplicationButtonShape } from '../schemas'

type Args = { [K in keyof typeof clickApplicationButtonShape]: z.infer<(typeof clickApplicationButtonShape)[K]> }

export async function clickApplicationButtonTool(args: Args): Promise<CallToolResult> {
  try {
    const result = await runClickButtonTask(args.jobId, args.buttonId)
    logActivity('info', `click_application_button -> ${result.status}`, { jobId: args.jobId })
    recordRunEvent('button_clicked', {
      source: getJob(args.jobId)?.source ?? null,
      jobId: args.jobId,
      meta: {
        status: result.status,
        ...(result.status === 'clicked' ? { label: result.button.label } : {}),
        ...('reasonTag' in result ? { reasonTag: result.reasonTag } : {})
      }
    })
    return jsonResult(result)
  } catch (error) {
    logActivity('error', 'click_application_button threw unexpectedly', { jobId: args.jobId, error: String(error) })
    return textError(`Failed to click application button: ${String(error)}`)
  }
}
