import { randomUUID } from 'crypto'
import type {
  AgentPermission,
  AgentPermissionDecision,
  AgentPermissionRequest
} from '@shared/types/agentPermissions'
import { appLogger } from '../logger'
import {
  broadcastAgentPermissionRequested,
  broadcastAgentPermissionResolved
} from '../ipc/jobsBroadcast'

interface PendingPermission {
  request: AgentPermissionRequest
  resolve: (decision: AgentPermissionDecision) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const pending = new Map<string, PendingPermission>()

function announceNextPendingRequest(): void {
  const next = pending.values().next().value as PendingPermission | undefined
  if (!next) return
  try {
    broadcastAgentPermissionRequested(next.request)
  } catch (error) {
    // The request remains listable and retains its own timeout. A recreated
    // renderer can still recover it through the pending snapshot.
    appLogger.warn(`Could not announce the next agent permission request: ${String(error)}`)
  }
}

/**
 * Pauses a fill attempt until the renderer answers or the request expires.
 * Requests are retained for `listPendingPermissionRequests`, so a renderer
 * that mounts after the MCP call began cannot miss the one-shot broadcast.
 */
export function requestAgentPermissions(
  input: Omit<AgentPermissionRequest, 'requestId'>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<AgentPermissionDecision> {
  const request: AgentPermissionRequest = {
    ...input,
    requestId: randomUUID(),
    permissions: [...new Set(input.permissions)]
  }

  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      pending.delete(request.requestId)
      appLogger.warn(`Agent permission request ${request.requestId} timed out after ${timeoutMs}ms`)
      try {
        broadcastAgentPermissionResolved(request.requestId)
      } catch (error) {
        appLogger.warn(`Could not broadcast expired agent permission request: ${String(error)}`)
      }
      resolve('deny')
      announceNextPendingRequest()
    }, timeoutMs)

    pending.set(request.requestId, { request, resolve, timeoutHandle })
    try {
      broadcastAgentPermissionRequested(request)
    } catch (error) {
      clearTimeout(timeoutHandle)
      pending.delete(request.requestId)
      appLogger.error(`Could not show agent permission request: ${String(error)}`)
      resolve('deny')
    }
  })
}

export function listPendingPermissionRequests(): AgentPermissionRequest[] {
  return [...pending.values()].map(({ request }) => ({ ...request, permissions: [...request.permissions] }))
}

export function getPendingPermissionRequest(requestId: string): AgentPermissionRequest | null {
  const request = pending.get(requestId)?.request
  return request ? { ...request, permissions: [...request.permissions] } : null
}

export function resolveAgentPermissionRequest(requestId: string, decision: AgentPermissionDecision): boolean {
  const entry = pending.get(requestId)
  if (!entry) return false
  clearTimeout(entry.timeoutHandle)
  pending.delete(requestId)
  try {
    broadcastAgentPermissionResolved(requestId)
  } catch (error) {
    appLogger.warn(`Could not broadcast resolved agent permission request: ${String(error)}`)
  }
  entry.resolve(decision)
  announceNextPendingRequest()
  return true
}

/** Applies an approved request to a one-attempt permission snapshot. */
export function allowRequestedPermissions(
  current: Readonly<Record<AgentPermission, boolean>>,
  requested: readonly AgentPermission[]
): Record<AgentPermission, boolean> {
  const allowed = { ...current }
  for (const permission of requested) allowed[permission] = true
  return allowed
}
