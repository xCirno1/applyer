import type { WebContents } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import type { JobRecord } from '@shared/types/job'
import type { CaptchaDetectedPayload, CaptchaResolvedPayload } from '@shared/types/ipcEvents'

let webContentsRef: WebContents | null = null

export function registerJobsBroadcastTarget(webContents: WebContents): void {
  webContentsRef = webContents
}

export function broadcastJobUpdate(job: JobRecord): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.jobs.onUpdated, job)
  }
}

export function broadcastJobRemoved(jobId: string): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.jobs.onRemoved, { jobId })
  }
}

/** Payload-less — the renderer just refetches its currently-loaded page on signal. */
export function broadcastIndexedJobsChanged(): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.indexedJobs.onChanged)
  }
}

/**
 * Payload-less, same reasoning as `broadcastIndexedJobsChanged`. Needed
 * because `ExclusionsPanel` fetches once on mount and then stays mounted
 * (Indexed Jobs is a mounted-but-hidden screen) — without this, a URL
 * excluded elsewhere (the board's Exclude action, a bulk exclude, or the
 * agent's exclude_job tool) never appears in an already-open panel even
 * though queue_job/search_jobs correctly start refusing/hiding it.
 */
export function broadcastExclusionsChanged(): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.exclusions.onChanged)
  }
}

export function broadcastCaptchaDetected(payload: CaptchaDetectedPayload): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.browserControl.onCaptchaDetected, payload)
  }
}

export function broadcastCaptchaResolved(payload: CaptchaResolvedPayload): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.browserControl.onCaptchaResolved, payload)
  }
}
