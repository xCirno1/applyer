import { startMcpSocketServer } from '../mcp-server/transportSocket'
import { mcpSocketPath } from '../config/paths'
import { getStorageRecoveryState } from '../config/storageLocation'

let mcpSocketServer: ReturnType<typeof startMcpSocketServer> | undefined
let started = false

/**
 * Starts the MCP socket server — deferred until storage-location recovery is
 * resolved (or was never needed). Without this gate, an already-connected
 * agent CLI could queue jobs / write documents through MCP tool calls
 * against a fallback database that's about to be abandoned, before the user
 * ever sees the recovery screen. Safe to call more than once — only starts
 * the server the first time it's actually resolved. Called directly from
 * bootstrap.ts when recovery was never needed, and from the
 * retryCustomLocation/useDefaultLocation IPC handlers once the user resolves it.
 */
export function startMcpServerIfStorageResolved(): void {
  if (started || getStorageRecoveryState().needed) return
  started = true
  mcpSocketServer = startMcpSocketServer(mcpSocketPath())
}

export function closeMcpSocketServer(): void {
  mcpSocketServer?.close()
}
