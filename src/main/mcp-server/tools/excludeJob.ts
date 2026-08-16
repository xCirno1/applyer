import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { excludeJob } from '../../jobActions'
import { jsonResult, textError } from '../toolResult'
import type { excludeJobShape } from '../schemas'

type Args = { [K in keyof typeof excludeJobShape]: z.infer<(typeof excludeJobShape)[K]> }

export async function excludeJobTool(args: Args): Promise<CallToolResult> {
  try {
    const { exclusion, wasExisting } = excludeJob({
      url: args.url,
      title: args.title,
      company: args.company,
      reason: args.reason,
      excludedBy: 'agent'
    })

    return jsonResult({
      status: wasExisting ? 'already_excluded' : 'excluded',
      url: exclusion.url,
      message: wasExisting
        ? 'This URL was already on the exclusion list.'
        : 'Added to the exclusion list. It will no longer be returned by search_jobs and cannot be queued.'
    })
  } catch (err) {
    return textError(`Failed to exclude job: ${String(err)}`)
  }
}
