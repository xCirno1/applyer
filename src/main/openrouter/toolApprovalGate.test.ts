import { describe, it, expect, beforeEach } from 'vitest'
import {
  cancelApprovalsForSession,
  listPendingApprovals,
  requestApproval,
  resolveApproval,
  __resetToolApprovalGateForTests
} from './toolApprovalGate'
import type { PendingToolApproval } from '@shared/types/chat'

beforeEach(() => {
  __resetToolApprovalGateForTests()
})

function request(overrides: Partial<PendingToolApproval> = {}): PendingToolApproval {
  return {
    sessionId: 's1',
    messageId: 'm1',
    toolCallId: 'call1',
    name: 'queue_job',
    arguments: '{}',
    ...overrides
  }
}

describe('toolApprovalGate', () => {
  it('resolves the matching promise with the decision, not cancelled', async () => {
    const promise = requestApproval(request())
    expect(resolveApproval('call1', 'allow_once')).toBe(true)
    expect(await promise).toEqual({ decision: 'allow_once', cancelled: false })
  })

  it('resolveApproval returns false for an id nobody is waiting on', () => {
    expect(resolveApproval('unknown', 'deny')).toBe(false)
  })

  it('lists pending approvals and removes them once resolved', async () => {
    const promise = requestApproval(request())
    expect(listPendingApprovals()).toEqual([request()])
    resolveApproval('call1', 'deny')
    await promise
    expect(listPendingApprovals()).toEqual([])
  })

  it('cancelApprovalsForSession resolves only that session\'s pending calls, as a cancelled deny', async () => {
    const a = requestApproval(request({ sessionId: 's1', toolCallId: 'a' }))
    const b = requestApproval(request({ sessionId: 's2', toolCallId: 'b' }))
    cancelApprovalsForSession('s1')
    expect(await a).toEqual({ decision: 'deny', cancelled: true })
    expect(listPendingApprovals()).toEqual([request({ sessionId: 's2', toolCallId: 'b' })])
    resolveApproval('b', 'allow_once')
    expect(await b).toEqual({ decision: 'allow_once', cancelled: false })
  })

  it('cancelling a session with nothing pending is a harmless no-op', () => {
    expect(() => cancelApprovalsForSession('nobody')).not.toThrow()
  })

  it('resolving twice the second time reports false, since the first delete already removed it', () => {
    const promise = requestApproval(request())
    expect(resolveApproval('call1', 'allow_always')).toBe(true)
    expect(resolveApproval('call1', 'deny')).toBe(false)
    return promise.then((resolution) => expect(resolution.decision).toBe('allow_always'))
  })
})
