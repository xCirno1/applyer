import type { Page } from 'playwright'
import { appLogger } from '../logger'

export type GateOutcome = 'resolved' | 'cancelled'

interface PendingGate {
  /** The job whose fill is waiting, or null for a search waiting on a site's challenge. */
  jobId: string | null
  page: Page
  resolve: (outcome: GateOutcome) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

const pending = new Map<string, PendingGate>()

/**
 * Opens a gate that resolves when the user clicks Resume/Cancel (via
 * resumeGate/cancelGate) or the timeout elapses (treated as a cancel).
 * The caller is responsible for actually waiting on the returned promise.
 * A fill waits from a detached background task, never from the MCP tool
 * call itself, which must return immediately when a captcha is hit (the
 * job is parked as paused). A search has no job to park, so
 * `searchChallenge.ts` waits inside the tool call instead, with a timeout
 * a fraction of this one.
 */
export function openGate(taskId: string, jobId: string | null, page: Page, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GateOutcome> {
  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      pending.delete(taskId)
      appLogger.warn(`Captcha gate ${taskId} timed out after ${timeoutMs}ms`)
      resolve('cancelled')
    }, timeoutMs)

    pending.set(taskId, { jobId, page, resolve, timeoutHandle })
  })
}

export function getGatePage(taskId: string): Page | undefined {
  return pending.get(taskId)?.page
}

export function resumeGate(taskId: string): boolean {
  const entry = pending.get(taskId)
  if (!entry) return false
  clearTimeout(entry.timeoutHandle)
  pending.delete(taskId)
  entry.resolve('resolved')
  return true
}

export function cancelGate(taskId: string): boolean {
  const entry = pending.get(taskId)
  if (!entry) return false
  clearTimeout(entry.timeoutHandle)
  pending.delete(taskId)
  entry.resolve('cancelled')
  return true
}

export function isGateOpen(taskId: string): boolean {
  return pending.has(taskId)
}
