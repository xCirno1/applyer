import { commandExists, runCommand } from '../processUtils'
import type { McpAdapter } from '../mcpAdapter'

function quote(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg
}

export const codexAdapter: McpAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',
  cliCommand: 'codex',
  // Codex's `mcp add` has no --scope flag — it only ever writes to the global
  // ~/.codex/config.toml, so `workspace` scope isn't offered for this CLI.
  supportsWorkspaceScope: false,

  isCliAvailable: () => commandExists('codex'),

  async isConfigured(serverName) {
    const result = await runCommand('codex', ['mcp', 'get', serverName])
    return result.code === 0
  },

  async configure(serverName, { command, args, env }) {
    const envFlags = Object.entries(env ?? {}).flatMap(([key, value]) => ['--env', `${key}=${value}`])
    const result = await runCommand('codex', ['mcp', 'add', ...envFlags, serverName, '--', command, ...args])
    if (result.code === 0) return { success: true }
    return { success: false, error: result.stderr.trim() || `codex mcp add exited with code ${result.code}` }
  },

  getManualSnippet(serverName, { command, args, env }) {
    const envFlags = Object.entries(env ?? {})
      .map(([key, value]) => `--env ${key}=${value}`)
      .join(' ')
    return `codex mcp add ${envFlags ? envFlags + ' ' : ''}${serverName} -- ${quote(command)} ${args.map(quote).join(' ')}`
  }
}
