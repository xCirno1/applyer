import { commandExists, runCommand } from '../processUtils'
import type { McpAdapter } from '../mcpAdapter'

function quote(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg
}

export const claudeAdapter: McpAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  cliCommand: 'claude',

  isCliAvailable: () => commandExists('claude'),

  async isConfigured(serverName) {
    const result = await runCommand('claude', ['mcp', 'get', serverName])
    return result.code === 0
  },

  async configure(serverName, { command, args, env }) {
    const envFlags = Object.entries(env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`])
    const result = await runCommand('claude', [
      'mcp',
      'add',
      '--scope',
      'user',
      ...envFlags,
      serverName,
      '--',
      command,
      ...args
    ])
    if (result.code === 0) return { success: true }
    return { success: false, error: result.stderr.trim() || `claude mcp add exited with code ${result.code}` }
  },

  getManualSnippet(serverName, { command, args, env }) {
    const envFlags = Object.entries(env ?? {})
      .map(([key, value]) => `-e ${key}=${value}`)
      .join(' ')
    return `claude mcp add --scope user ${envFlags ? envFlags + ' ' : ''}${serverName} -- ${quote(command)} ${args.map(quote).join(' ')}`
  }
}
