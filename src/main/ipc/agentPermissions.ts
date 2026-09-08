import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import {
  isAgentPermissionDecision,
  type AgentPermissionDecision,
  type AgentPermissions
} from '@shared/types/agentPermissions'
import {
  allowRequestedPermissions,
  getPendingPermissionRequest,
  listPendingPermissionRequests,
  resolveAgentPermissionRequest
} from '../browser/agentPermissionGate'
import { getAgentPermissions, setAgentPermissions } from '../db/repositories/settingsRepository'
import { logActivity } from '../db/repositories/activityLogRepository'
import { broadcastAgentPermissionsChanged } from './jobsBroadcast'
import { appLogger } from '../logger'

function readResponse(payload: unknown): { requestId: string; decision: AgentPermissionDecision } | null {
  if (!payload || typeof payload !== 'object') return null
  const { requestId, decision } = payload as { requestId?: unknown; decision?: unknown }
  return typeof requestId === 'string' && requestId.length > 0 && isAgentPermissionDecision(decision)
    ? { requestId, decision }
    : null
}

export function registerAgentPermissionsIpc(): void {
  ipcMain.handle(IPC.agentPermissions.listPending, () => listPendingPermissionRequests())

  ipcMain.handle(IPC.agentPermissions.respond, (_event, payload: unknown) => {
    const response = readResponse(payload)
    if (!response) return { ok: false, error: appError('agentPermissionNotWaiting') }

    const request = getPendingPermissionRequest(response.requestId)
    if (!request) return { ok: false, error: appError('agentPermissionNotWaiting') }

    let permissions: AgentPermissions | undefined
    try {
      if (response.decision === 'allow_always') {
        permissions = allowRequestedPermissions(getAgentPermissions(), request.permissions)
        setAgentPermissions(permissions)
        broadcastAgentPermissionsChanged(permissions)
      }

      if (!resolveAgentPermissionRequest(response.requestId, response.decision)) {
        return { ok: false, error: appError('agentPermissionNotWaiting') }
      }

      try {
        logActivity('info', `Agent permission request ${response.decision}`, {
          jobId: request.jobId,
          permissions: request.permissions
        })
      } catch (error) {
        appLogger.warn(`Could not log agent permission decision: ${String(error)}`)
      }
      return { ok: true, permissions }
    } catch (error) {
      try {
        logActivity('error', 'Could not resolve agent permission request', {
          jobId: request.jobId,
          error: String(error)
        })
      } catch (logError) {
        appLogger.error(`Could not resolve or log agent permission request: ${String(logError)}`)
      }
      return { ok: false, error: unexpectedError(error) }
    }
  })
}
