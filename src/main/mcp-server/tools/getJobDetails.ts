import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { fetchJobDetails } from '../../browser/jobDetails'
import { getCachedJobDetails, setCachedJobDetails } from '../../db/repositories/jobDetailsCacheRepository'
import { getJobByUrl } from '../../db/repositories/jobsRepository'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { failJob } from '../../jobActions'
import { jsonResult, textError } from '../toolResult'
import type { getJobDetailsShape } from '../schemas'

type Args = { [K in keyof typeof getJobDetailsShape]: z.infer<(typeof getJobDetailsShape)[K]> }

export async function getJobDetailsTool(args: Args): Promise<CallToolResult> {
  const url = args.url

  const cached = getCachedJobDetails(url)
  if (cached) {
    return jsonResult(cached)
  }

  let outcome
  try {
    outcome = await fetchJobDetails(url)
  } catch (err) {
    logActivity('error', 'get_job_details threw unexpectedly', { url, error: String(err) })
    return textError(`Failed to fetch job details: ${String(err)}`)
  }

  if (outcome.status === 'ok') {
    setCachedJobDetails(url, outcome.details)
    return jsonResult(outcome.details)
  }

  if (outcome.status === 'blocked') {
    const existingJob = getJobByUrl(url)
    if (existingJob && existingJob.status === 'queued') {
      failJob(existingJob.id, outcome.reasonTag, outcome.message)
    }
    logActivity('warn', 'get_job_details blocked', { url, reasonTag: outcome.reasonTag })
    return jsonResult({ status: 'blocked', reasonTag: outcome.reasonTag, message: outcome.message })
  }

  return jsonResult({ status: 'not_found', message: outcome.message })
}
