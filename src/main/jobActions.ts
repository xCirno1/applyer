import { setFailed, listBlockedJobs } from './db/repositories/jobsRepository'
import { ensureFailureTag } from './db/repositories/failureTagsRepository'
import { logActivity } from './db/repositories/activityLogRepository'
import { broadcastJobUpdate } from './ipc/jobsBroadcast'
import type { JobRecord } from '@shared/types/job'

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
