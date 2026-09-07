export interface AgentPermissions {
  /** Lets form automation enter profile values such as name, email and phone. */
  autoCompleteFields: boolean
  /** Lets form automation attach stored resumes and cover letters. */
  autoUploadDocuments: boolean
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
