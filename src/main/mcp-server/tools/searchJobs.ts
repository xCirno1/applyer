import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { searchJobs } from '../../browser/jobSearch'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { jsonResult, textError } from '../toolResult'
import type { searchJobsShape } from '../schemas'
import { SEARCH_JOBS_DEFAULT_LIMIT } from '@shared/constants'

type Args = { [K in keyof typeof searchJobsShape]: z.infer<(typeof searchJobsShape)[K]> }

export async function searchJobsTool(args: Args): Promise<CallToolResult> {
  try {
    const outcome = await searchJobs({
      query: args.query,
      location: args.location,
      sources: args.sources,
      limit: args.limit ?? SEARCH_JOBS_DEFAULT_LIMIT
    })

    logActivity('info', `search_jobs "${args.query}" -> ${outcome.results.length} results`, {
      sources: outcome.searchedSources
    })

    return jsonResult(outcome)
  } catch (err) {
    logActivity('error', 'search_jobs failed', { error: String(err) })
    return textError(`Search failed: ${String(err)}`)
  }
}
