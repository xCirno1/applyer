import type { McpCliId } from '@shared/types/ipcEvents'

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
  isCliAvailable(): Promise<boolean>
  isConfigured(serverName: string): Promise<boolean>
  configure(serverName: string, invocation: McpInvocation): Promise<McpConfigureResult>
  getManualSnippet(serverName: string, invocation: McpInvocation): string
}
