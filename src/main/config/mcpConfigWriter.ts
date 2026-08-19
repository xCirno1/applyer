import { app } from 'electron'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { claudeAdapter } from './adapters/claudeAdapter'
import { codexAdapter } from './adapters/codexAdapter'
import { mcpSocketPath } from './paths'
import type { McpAdapter, McpInvocation } from './mcpAdapter'
import type {
  McpAutoConfigureResult,
  McpCliId,
  McpConfigDetection,
  McpScope,
  McpVerifyResult
} from '@shared/types/ipcEvents'

const SERVER_NAME = 'applyer'

const ADAPTERS: Record<McpCliId, McpAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter
}

/**
 * The exact command a CLI's MCP config should spawn to reach this app —
 * always the dumb stdio<->socket bridge script, never the full Electron
 * binary directly. In packaged mode the binary itself runs that script via
 * ELECTRON_RUN_AS_NODE=1, which makes it behave as plain Node with zero
 * Chromium/GUI initialization — spawning the binary normally (as we
 * initially tried) triggers Electron's display-server init even for this
 * byte-forwarding role, which fails outright with no $DISPLAY.
 */
export function getMcpInvocation(): McpInvocation {
  const socketPath = mcpSocketPath()
  if (app.isPackaged) {
    const bridgeScript = join(process.resourcesPath, 'mcp-bridge.mjs')
    return { command: process.execPath, args: [bridgeScript, socketPath], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  const bridgeScript = join(app.getAppPath(), 'resources', 'mcp-bridge.mjs')
  return { command: 'node', args: [bridgeScript, socketPath] }
}

export async function detectMcpConfigs(): Promise<McpConfigDetection[]> {
  const results: McpConfigDetection[] = []
  for (const adapter of Object.values(ADAPTERS)) {
    const available = await adapter.isCliAvailable()
    const scopesToCheck: McpScope[] = adapter.supportsWorkspaceScope ? ['user', 'workspace'] : ['user']
    const configuredScopes: McpScope[] = []
    if (available) {
      for (const scope of scopesToCheck) {
        if (await adapter.isConfigured(SERVER_NAME, scope)) configuredScopes.push(scope)
      }
    }
    results.push({
      cli: adapter.id,
      configPath: adapter.cliCommand,
      exists: available,
      supportsWorkspaceScope: adapter.supportsWorkspaceScope,
      configuredScopes
    })
  }
  return results
}

export function getMcpSnippet(cli: McpCliId, scope: McpScope): string {
  return ADAPTERS[cli].getManualSnippet(SERVER_NAME, getMcpInvocation(), scope)
}

export async function autoConfigureMcp(cli: McpCliId, scope: McpScope): Promise<McpAutoConfigureResult> {
  return ADAPTERS[cli].configure(SERVER_NAME, getMcpInvocation(), scope)
}

export async function verifyMcpConnection(): Promise<McpVerifyResult> {
  const invocation = getMcpInvocation()
  const transport = new StdioClientTransport({
    command: invocation.command,
    args: invocation.args,
    env: invocation.env ? { ...getDefaultEnvironment(), ...invocation.env } : undefined
  })
  const client = new Client({ name: 'applyer-onboarding-check', version: '0.1.0' })

  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    await client.close()
    return { success: true, tools: tools.map((t) => t.name) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
