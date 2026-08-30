import { agentWorkspaceDir } from '../paths'
import { commandExists, runCommand } from '../processUtils'
import type { McpAdapter } from '../mcpAdapter'
import type { McpScope } from '@shared/types/ipcEvents'

function quote(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg
}

/**
 * `local` scope is keyed by cwd, so `workspace` scope is implemented as a
 * `local`-scope entry rooted at Applyer's dedicated terminal cwd — that
 * makes the server visible only to CLI sessions started from Applyer's
 * terminal, without the shared-`.mcp.json`/approval dance `project` scope
 * would require.
 */
function scopeFlag(scope: McpScope): 'user' | 'local' {
  return scope === 'workspace' ? 'local' : 'user'
}

function scopeCwd(scope: McpScope): string | undefined {
  return scope === 'workspace' ? agentWorkspaceDir() : undefined
}

export const claudeAdapter: McpAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  cliCommand: 'claude',
  supportsWorkspaceScope: true,

  isCliAvailable: () => commandExists('claude'),

  async isConfigured(serverName, scope) {
    const result = await runCommand('claude', ['mcp', 'get', serverName], { cwd: scopeCwd(scope) })
    return result.code === 0
  },

  async configure(serverName, { command, args, env }, scope) {
    const envFlags = Object.entries(env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`])
    const result = await runCommand(
      'claude',
      // `-e`/`--env` is a variadic option: if it comes before the positional
      // <name> argument, it greedily swallows the name as another env pair
      // ("Invalid environment variable format: <name>"), so <name> must
      // come first — see `claude mcp add --help`'s own example order.
      ['mcp', 'add', '--scope', scopeFlag(scope), serverName, ...envFlags, '--', command, ...args],
      { cwd: scopeCwd(scope) }
    )
    if (result.code === 0) return { success: true }
    return { success: false, error: result.stderr.trim() || `claude mcp add exited with code ${result.code}` }
  },

  getManualSnippet(serverName, { command, args, env }, scope) {
    const envFlags = Object.entries(env ?? {})
      .map(([key, value]) => `-e ${key}=${value}`)
      .join(' ')
    const addCommand = `claude mcp add --scope ${scopeFlag(scope)} ${serverName}${envFlags ? ' ' + envFlags : ''} -- ${quote(command)} ${args.map(quote).join(' ')}`
    const cwd = scopeCwd(scope)
    return cwd ? `cd ${quote(cwd)} && ${addCommand}` : addCommand
  }
}
