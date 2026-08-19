import type { McpCliId, McpScope } from '@shared/types/ipcEvents'

export interface McpInvocation {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpConfigureResult {
  success: boolean
  error?: string
}

export interface McpAdapter {
  id: McpCliId
  displayName: string
  cliCommand: string
  /** Whether this CLI has a per-project/cwd-scoped config Applyer can target for `workspace` scope. */
  supportsWorkspaceScope: boolean
  isCliAvailable(): Promise<boolean>
  isConfigured(serverName: string, scope: McpScope): Promise<boolean>
  configure(serverName: string, invocation: McpInvocation, scope: McpScope): Promise<McpConfigureResult>
  getManualSnippet(serverName: string, invocation: McpInvocation, scope: McpScope): string
}
