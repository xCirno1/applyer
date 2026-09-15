import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { queueJob } from '../../db/repositories/jobsRepository'
import { isUrlExcluded } from '../../db/repositories/jobExclusionsRepository'
import { detectSource } from '../../browser/sourceRouter'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { broadcastJobUpdate } from '../../ipc/jobsBroadcast'
import { recordRunEvent } from '../../runs/runTracker'
import { jsonResult, textError } from '../toolResult'
import { sanitizeDescriptionHtml } from '../../browser/htmlContent'
import type { queueJobShape } from '../schemas'

type Args = { [K in keyof typeof queueJobShape]: z.infer<(typeof queueJobShape)[K]> }

export async function queueJobTool(args: Args): Promise<CallToolResult> {
  if (isUrlExcluded(args.url)) {
    recordRunEvent('job_queue_excluded', { source: args.source ?? detectSource(args.url) })
    return jsonResult({
      jobId: null,
      status: 'excluded',
      message: 'This URL is on the user\'s exclusion list and will not be queued.'
    })
  }

  try {
    const { job, wasExisting } = queueJob({
      title: args.title,
      company: args.company,
      url: args.url,
      location: args.location,
      source: args.source ?? detectSource(args.url),
      description: args.description ? sanitizeDescriptionHtml(args.description) : null,
      salaryRange: args.salaryRange,
      matchScore: args.matchScore,
      matchReasons: args.matchReasons
    })

    if (!wasExisting) {
      logActivity('info', `Queued job: ${job.title} @ ${job.company}`, { jobId: job.id })
      broadcastJobUpdate(job)
      recordRunEvent('job_queued', {
        source: job.source,
        jobId: job.id,
        meta: { matchScore: job.matchScore ?? null }
      })
    } else {
      recordRunEvent('job_queue_existing', { source: job.source, jobId: job.id })
    }

    return jsonResult({ jobId: job.id, status: wasExisting ? 'existing' : 'queued' })
  } catch (err) {
    return textError(`Failed to queue job: ${String(err)}`)
  }
}
