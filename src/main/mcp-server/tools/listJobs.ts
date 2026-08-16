import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { listJobs } from '../../db/repositories/jobsRepository'
import { jsonResult, textError } from '../toolResult'
import type { listJobsShape } from '../schemas'

type Args = { [K in keyof typeof listJobsShape]: z.infer<(typeof listJobsShape)[K]> }

export async function listJobsTool(args: Args): Promise<CallToolResult> {
  try {
    const result = listJobs({ status: args.status, limit: args.limit, offset: args.offset })
    return jsonResult({
      jobs: result.jobs.map((j) => ({
        jobId: j.id,
        title: j.title,
        company: j.company,
        status: j.status,
        matchScore: j.matchScore,
        failureTag: j.failureTag
      })),
      total: result.total
    })
  } catch (err) {
    return textError(`Failed to list jobs: ${String(err)}`)
  }
}
