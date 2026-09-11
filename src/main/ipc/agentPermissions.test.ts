import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/types/ipcEvents'
import type { AgentPermissionRequest, AgentPermissions } from '@shared/types/agentPermissions'
import { __invokeIpc, __resetIpcMock } from '../../../test/mocks/electron'

const REQUEST: AgentPermissionRequest = {
  requestId: 'request-1',
  jobId: 'job-1',
  jobTitle: 'Engineer',
  company: 'Acme',
  permissions: ['autoUploadDocuments']
}

const mocks = vi.hoisted(() => ({
  listPendingPermissionRequests: vi.fn(),
  getPendingPermissionRequest: vi.fn(),
  resolveAgentPermissionRequest: vi.fn(),
  allowRequestedPermissions: vi.fn(
    (current: AgentPermissions, requested: Array<keyof AgentPermissions>): AgentPermissions => {
      const next = { ...current }
      for (const permission of requested) next[permission] = true
      return next
    }
  ),
  getAgentPermissions: vi.fn(),
  setAgentPermissions: vi.fn(),
  logActivity: vi.fn(),
  broadcastAgentPermissionsChanged: vi.fn()
}))

const {
  listPendingPermissionRequests,
  getPendingPermissionRequest,
  resolveAgentPermissionRequest,
  allowRequestedPermissions,
  getAgentPermissions,
  setAgentPermissions,
  broadcastAgentPermissionsChanged
} = mocks

vi.mock('../browser/agentPermissionGate', () => ({
  listPendingPermissionRequests: mocks.listPendingPermissionRequests,
  getPendingPermissionRequest: mocks.getPendingPermissionRequest,
  resolveAgentPermissionRequest: mocks.resolveAgentPermissionRequest,
  allowRequestedPermissions: mocks.allowRequestedPermissions
}))

vi.mock('../db/repositories/settingsRepository', () => ({
  getAgentPermissions: mocks.getAgentPermissions,
  setAgentPermissions: mocks.setAgentPermissions
}))

vi.mock('../db/repositories/activityLogRepository', () => ({ logActivity: mocks.logActivity }))

vi.mock('./jobsBroadcast', () => ({
  broadcastAgentPermissionsChanged: mocks.broadcastAgentPermissionsChanged
}))

import { registerAgentPermissionsIpc } from './agentPermissions'

beforeEach(() => {
  vi.clearAllMocks()
  listPendingPermissionRequests.mockReturnValue([REQUEST])
  getPendingPermissionRequest.mockReturnValue(REQUEST)
  resolveAgentPermissionRequest.mockReturnValue(true)
  getAgentPermissions.mockReturnValue({ autoCompleteFields: false, autoUploadDocuments: false, autoPressButtons: false })
  __resetIpcMock()
  registerAgentPermissionsIpc()
})

describe('agent permission IPC', () => {
  it('returns the pending snapshot', () => {
    expect(__invokeIpc(IPC.agentPermissions.listPending)).toEqual([REQUEST])
  })

  it('allows one attempt without changing persistent settings', () => {
    expect(
      __invokeIpc(IPC.agentPermissions.respond, { requestId: REQUEST.requestId, decision: 'allow_once' })
    ).toEqual({ ok: true, permissions: undefined })
    expect(setAgentPermissions).not.toHaveBeenCalled()
    expect(resolveAgentPermissionRequest).toHaveBeenCalledWith(REQUEST.requestId, 'allow_once')
  })

  it('always allows only the capabilities in the pending request', () => {
    expect(
      __invokeIpc(IPC.agentPermissions.respond, { requestId: REQUEST.requestId, decision: 'allow_always' })
    ).toEqual({
      ok: true,
      permissions: { autoCompleteFields: false, autoUploadDocuments: true, autoPressButtons: false }
    })
    expect(allowRequestedPermissions).toHaveBeenCalledWith(
      { autoCompleteFields: false, autoUploadDocuments: false, autoPressButtons: false },
      ['autoUploadDocuments']
    )
    expect(setAgentPermissions).toHaveBeenCalledWith({
      autoCompleteFields: false,
      autoUploadDocuments: true,
      autoPressButtons: false
    })
    expect(broadcastAgentPermissionsChanged).toHaveBeenCalledWith({
      autoCompleteFields: false,
      autoUploadDocuments: true,
      autoPressButtons: false
    })
  })

  it.each([
    undefined,
    null,
    {},
    { requestId: 2, decision: 'deny' },
    { requestId: 'request-1', decision: 'maybe' }
  ])('rejects malformed responses without resolving the gate: %j', (payload) => {
    expect(__invokeIpc(IPC.agentPermissions.respond, payload)).toEqual({
      ok: false,
      error: { code: 'agentPermissionNotWaiting' }
    })
    expect(resolveAgentPermissionRequest).not.toHaveBeenCalled()
  })

  it('rejects a response after its request has expired', () => {
    getPendingPermissionRequest.mockReturnValueOnce(null)
    expect(
      __invokeIpc(IPC.agentPermissions.respond, { requestId: REQUEST.requestId, decision: 'deny' })
    ).toEqual({ ok: false, error: { code: 'agentPermissionNotWaiting' } })
    expect(resolveAgentPermissionRequest).not.toHaveBeenCalled()
  })

  it('keeps the request pending if permanent settings cannot be saved', () => {
    setAgentPermissions.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect(
      __invokeIpc(IPC.agentPermissions.respond, { requestId: REQUEST.requestId, decision: 'allow_always' })
    ).toEqual({ ok: false, error: { code: 'unexpected', params: { message: 'disk full' } } })
    expect(resolveAgentPermissionRequest).not.toHaveBeenCalled()
  })
})
