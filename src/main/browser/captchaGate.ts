import type { Page } from 'playwright'
import { appLogger } from '../logger'

export type GateOutcome = 'resolved' | 'cancelled'

interface PendingGate {
  jobId: string
  page: Page
  resolve: (outcome: GateOutcome) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

const pending = new Map<string, PendingGate>()

/**
 * Opens a gate that resolves when the user clicks Resume/Cancel (via
 * resumeGate/cancelGate) or the timeout elapses (treated as a cancel).
 * The caller is responsible for actually waiting on the returned promise —
 * critically, from a detached background task, never from the MCP tool
 * call itself, which must return immediately when a captcha is hit.
 */
export function openGate(taskId: string, jobId: string, page: Page, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GateOutcome> {
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
