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
