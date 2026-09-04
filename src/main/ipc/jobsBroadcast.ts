import type { WebContents } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import type { JobRecord } from '@shared/types/job'
import type {
  CaptchaDetectedPayload,
  CaptchaResolvedPayload,
  BrowserDownloadProgressPayload,
  BrowserSetupStatusPayload
} from '@shared/types/ipcEvents'
import type { StorageLocationProgressPayload } from '@shared/types/storageLocation'
import type { BoardFetchedPayload } from '@shared/types/companyBoard'
import { notifyForJobUpdate, notifyForVerification } from '../notificationService'

let webContentsRef: WebContents | null = null

export function registerJobsBroadcastTarget(webContents: WebContents): void {
  webContentsRef = webContents
}

export function broadcastJobUpdate(job: JobRecord): void {
  notifyForJobUpdate(job)
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

/**
 * Payload-less, same reasoning as `broadcastExclusionsChanged` — the tracked
 * boards are written from the Company Boards panel *and* by the agent's
 * `add_company_board` tool, and the panel stays mounted-but-hidden while
 * another screen is showing.
 */
export function broadcastCompanyBoardsChanged(): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.companyBoards.onChanged)
  }
}

/**
 * One board's fetch result, unlike the payload-less signal above.
 *
 * A manual fetch of a selection runs several boards at a time and can take a
 * while for the slow ones, so each result is pushed as it lands: the row
 * stops spinning and shows its new count the moment *that* board answers,
 * instead of the whole selection waiting on the slowest member. It carries
 * the row so the panel can replace one entry rather than re-reading the
 * watchlist once per board.
 */
export function broadcastCompanyBoardFetched(payload: BoardFetchedPayload): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.companyBoards.onFetched, payload)
  }
}

/**
 * Payload-less, same reasoning as `broadcastExclusionsChanged`. Needed
 * because the profile can now be written from two places at once: the
 * Settings form and the agent's `update_profile` tool. Settings is a
 * mounted-but-hidden screen holding an editable draft of the profile it
 * fetched on mount, so without this signal an agent-side update would stay
 * invisible there — and the next Save would silently write the stale draft
 * back over it.
 */
export function broadcastProfileChanged(): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.profile.onChanged)
  }
}

export function broadcastCaptchaDetected(payload: CaptchaDetectedPayload): void {
  notifyForVerification(payload)
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.browserControl.onCaptchaDetected, payload)
  }
}

export function broadcastCaptchaResolved(payload: CaptchaResolvedPayload): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.browserControl.onCaptchaResolved, payload)
  }
}

export function broadcastBrowserSetupProgress(payload: BrowserDownloadProgressPayload): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.browserSetup.onProgress, payload)
  }
}

export function broadcastBrowserSetupStatus(payload: BrowserSetupStatusPayload): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.browserSetup.onStatus, payload)
  }
}

export function broadcastStorageLocationProgress(payload: StorageLocationProgressPayload): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.storageLocation.onProgress, payload)
  }
}
