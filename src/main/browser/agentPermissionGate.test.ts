import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentPermissionRequest } from '@shared/types/agentPermissions'

const { requested, resolved } = vi.hoisted(() => ({ requested: vi.fn(), resolved: vi.fn() }))
vi.mock('../ipc/jobsBroadcast', () => ({
  broadcastAgentPermissionRequested: requested,
  broadcastAgentPermissionResolved: resolved
}))

import {
  allowRequestedPermissions,
  listPendingPermissionRequests,
  requestAgentPermissions,
  resolveAgentPermissionRequest
} from './agentPermissionGate'

const INPUT: Omit<AgentPermissionRequest, 'requestId'> = {
  jobId: 'job-1',
  jobTitle: 'Engineer',
  company: 'Acme',
  permissions: ['autoUploadDocuments']
}

beforeEach(() => {
  vi.useRealTimers()
  requested.mockReset()
  resolved.mockReset()
  for (const request of listPendingPermissionRequests()) {
    resolveAgentPermissionRequest(request.requestId, 'deny')
  }
})

describe('agentPermissionGate', () => {
  it('broadcasts, lists, and resolves an allow-once request', async () => {
    const outcome = requestAgentPermissions(INPUT)
    const [request] = listPendingPermissionRequests()

    expect(request).toMatchObject(INPUT)
    expect(requested).toHaveBeenCalledWith(request)
    expect(resolveAgentPermissionRequest(request!.requestId, 'allow_once')).toBe(true)
    await expect(outcome).resolves.toBe('allow_once')
    expect(listPendingPermissionRequests()).toEqual([])
    expect(resolved).toHaveBeenCalledWith(request!.requestId)
  })

  it('fails closed when a request expires', async () => {
    vi.useFakeTimers()
    const outcome = requestAgentPermissions(INPUT, 25)
    const requestId = listPendingPermissionRequests()[0]!.requestId

    await vi.advanceTimersByTimeAsync(25)

    await expect(outcome).resolves.toBe('deny')
    expect(listPendingPermissionRequests()).toEqual([])
    expect(resolved).toHaveBeenCalledWith(requestId)
    vi.useRealTimers()
  })

  it('fails closed if the request cannot be broadcast', async () => {
    requested.mockImplementationOnce(() => {
      throw new Error('window unavailable')
    })
    await expect(requestAgentPermissions(INPUT)).resolves.toBe('deny')
    expect(listPendingPermissionRequests()).toEqual([])
  })

  it('enables only the permissions included in the approved request', () => {
    expect(
      allowRequestedPermissions(
        { autoCompleteFields: false, autoUploadDocuments: false },
        ['autoUploadDocuments']
      )
    ).toEqual({ autoCompleteFields: false, autoUploadDocuments: true })
  })
})
