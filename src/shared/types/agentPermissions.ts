export interface AgentPermissions {
  /** Lets form automation enter profile values such as name, email and phone. */
  autoCompleteFields: boolean
  /** Lets form automation attach stored resumes and cover letters. */
  autoUploadDocuments: boolean
}

export type AgentPermission = keyof AgentPermissions
export type AgentPermissionDecision = 'allow_once' | 'allow_always' | 'deny'

export interface AgentPermissionRequest {
  requestId: string
  jobId: string
  jobTitle: string
  company: string
  permissions: AgentPermission[]
}

const AGENT_PERMISSION_KEYS = new Set<AgentPermission>(['autoCompleteFields', 'autoUploadDocuments'])

export function isAgentPermission(value: unknown): value is AgentPermission {
  return typeof value === 'string' && AGENT_PERMISSION_KEYS.has(value as AgentPermission)
}

export function isAgentPermissionDecision(value: unknown): value is AgentPermissionDecision {
  return value === 'allow_once' || value === 'allow_always' || value === 'deny'
}

export function isAgentPermissionRequest(value: unknown): value is AgentPermissionRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AgentPermissionRequest>
  return (
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    typeof candidate.jobId === 'string' &&
    candidate.jobId.length > 0 &&
    typeof candidate.jobTitle === 'string' &&
    typeof candidate.company === 'string' &&
    Array.isArray(candidate.permissions) &&
    candidate.permissions.length > 0 &&
    candidate.permissions.every(isAgentPermission)
  )
}

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  autoCompleteFields: true,
  autoUploadDocuments: false
}

/** Safe fallback for unreadable or invalid persisted permission data. */
export const DENIED_AGENT_PERMISSIONS: AgentPermissions = {
  autoCompleteFields: false,
  autoUploadDocuments: false
}

export function isAgentPermissions(value: unknown): value is AgentPermissions {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AgentPermissions>
  return typeof candidate.autoCompleteFields === 'boolean' && typeof candidate.autoUploadDocuments === 'boolean'
}
