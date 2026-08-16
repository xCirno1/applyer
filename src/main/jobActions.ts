import { setFailed, listBlockedJobs, getJobByUrl, removeJob } from './db/repositories/jobsRepository'
import { ensureFailureTag } from './db/repositories/failureTagsRepository'
import { logActivity } from './db/repositories/activityLogRepository'
import { excludeUrl } from './db/repositories/jobExclusionsRepository'
import { broadcastJobUpdate, broadcastJobRemoved } from './ipc/jobsBroadcast'
import type { JobRecord } from '@shared/types/job'
import type { ExclusionRecord, ExcludedBy } from '@shared/types/exclusion'

/**
 * Shared job-state-transition helpers used by both the MCP tool layer
 * (flag_failure, get_job_details hitting a captcha) and the browser layer
 * (fillTaskRunner failing a job it couldn't fill) — kept neutral here
 * rather than under mcp-server/ so browser/ doesn't have to import "up"
 * through the MCP layer.
 */
export function failJob(jobId: string, reasonTag: string, message?: string | null): JobRecord {
  ensureFailureTag(reasonTag)
  const job = setFailed(jobId, reasonTag, message)
  logActivity('warn', `Job failed: ${reasonTag}`, { jobId, message: message ?? undefined })
  broadcastJobUpdate(job)
  return job
}

/**
 * Called once at startup. The captcha gate (and the headed browser page it
 * points at) only ever lives in this process's memory — if the app was
 * closed or crashed while a job was mid-fill or waiting on a challenge,
 * the DB still shows it as blocked but nothing is actually waiting for it
 * anymore. Left alone, that job would sit stuck forever with no way to
 * resume or cancel it from the UI.
 */
export function reconcileOrphanedBlockedJobs(): void {
  for (const job of listBlockedJobs()) {
    failJob(job.id, 'interrupted', 'The app was closed or restarted while this job was waiting on a verification challenge. Retry it to try again.')
  }
}

export interface ExcludeJobInput {
  url: string
  title?: string | null
  company?: string | null
  reason?: string | null
  excludedBy: ExcludedBy
}

/**
 * Adds a URL to the permanent exclusion list (search_jobs/queue_job both
 * consult it) and, if that URL is currently tracked on the board, removes
 * it — shared between the user-facing "Exclude" action on a job and the
 * agent-facing exclude_job MCP tool so both paths behave identically.
 */
export function excludeJob(input: ExcludeJobInput): { exclusion: ExclusionRecord; wasExisting: boolean } {
  const result = excludeUrl({
    url: input.url,
    title: input.title,
    company: input.company,
    reason: input.reason,
    excludedBy: input.excludedBy
  })

  const trackedJob = getJobByUrl(input.url)
  if (trackedJob) {
    removeJob(trackedJob.id)
    broadcastJobRemoved(trackedJob.id)
  }

  if (!result.wasExisting) {
    logActivity('info', `Excluded job posting (${input.excludedBy}): ${input.url}`, { reason: input.reason ?? undefined })
  }

  return result
}
