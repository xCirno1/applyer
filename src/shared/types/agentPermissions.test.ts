import { describe, expect, it } from 'vitest'
import {
  isAgentPermissionDecision,
  isAgentPermissionRequest
} from './agentPermissions'

const VALID_REQUEST = {
  requestId: 'request-1',
  jobId: 'job-1',
  jobTitle: 'Engineer',
  company: 'Acme',
  permissions: ['autoCompleteFields']
}

describe('agent permission boundary guards', () => {
  it('accepts a complete permission request', () => {
    expect(isAgentPermissionRequest(VALID_REQUEST)).toBe(true)
  })

  it.each([
    null,
    {},
    { ...VALID_REQUEST, requestId: '' },
    { ...VALID_REQUEST, jobId: 1 },
    { ...VALID_REQUEST, permissions: [] },
    { ...VALID_REQUEST, permissions: ['submitApplication'] },
    { ...VALID_REQUEST, permissions: 'autoCompleteFields' }
  ])('rejects malformed permission requests: %j', (value) => {
    expect(isAgentPermissionRequest(value)).toBe(false)
  })

  it.each(['allow_once', 'allow_always', 'deny'])('accepts the %s decision', (decision) => {
    expect(isAgentPermissionDecision(decision)).toBe(true)
  })

  it.each([undefined, '', 'allow', true])('rejects an unknown decision: %j', (decision) => {
    expect(isAgentPermissionDecision(decision)).toBe(false)
  })
})
