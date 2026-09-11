import { describe, it, expect, vi, beforeEach } from 'vitest'

const runCommand = vi.fn()
const commandExists = vi.fn()
vi.mock('../processUtils', () => ({
  runCommand: (...args: unknown[]) => runCommand(...args),
  commandExists: (...args: unknown[]) => commandExists(...args)
}))

import { claudeAdapter } from './claudeAdapter'
import type { McpInvocation } from '../mcpAdapter'

const invocation: McpInvocation = { command: 'node', args: ['/path/to/bridge.mjs', '/tmp/mcp.sock'] }

beforeEach(() => {
  runCommand.mockReset()
  commandExists.mockReset()
})

describe('claudeAdapter', () => {
  it('identifies itself correctly', () => {
    expect(claudeAdapter.id).toBe('claude')
    expect(claudeAdapter.cliCommand).toBe('claude')
    expect(claudeAdapter.supportsWorkspaceScope).toBe(true)
  })

  it('isCliAvailable defers to commandExists("claude")', async () => {
    commandExists.mockResolvedValue(true)
    await expect(claudeAdapter.isCliAvailable()).resolves.toBe(true)
    expect(commandExists).toHaveBeenCalledWith('claude')
  })

  it('isConfigured runs `claude mcp get <name>` and succeeds on exit code 0', async () => {
    runCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    await expect(claudeAdapter.isConfigured('applyer', 'user')).resolves.toBe(true)
    expect(runCommand).toHaveBeenCalledWith('claude', ['mcp', 'get', 'applyer'], { cwd: undefined })
  })

  it('isConfigured for workspace scope runs in the agent workspace cwd', async () => {
    runCommand.mockResolvedValue({ code: 1, stdout: '', stderr: '' })
    await expect(claudeAdapter.isConfigured('applyer', 'workspace')).resolves.toBe(false)
    const [, , opts] = runCommand.mock.calls[0] as [string, string[], { cwd?: string }]
    expect(opts.cwd).toBeTruthy()
    expect(opts.cwd).toContain('workspace')
  })

  it('configure builds a `claude mcp add --scope user` command with env flags after the server name', async () => {
    runCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    const result = await claudeAdapter.configure('applyer', { ...invocation, env: { FOO: 'bar' } }, 'user')
    expect(result).toEqual({ success: true })
    // The server name must precede `-e`/`--env`: it's a variadic option, so
    // placing it before the positional <name> makes the CLI swallow <name>
    // as another env pair ("Invalid environment variable format: <name>").
    expect(runCommand).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'add', '--scope', 'user', 'applyer', '-e', 'FOO=bar', '--', 'node', '/path/to/bridge.mjs', '/tmp/mcp.sock'],
      { cwd: undefined }
    )
  })

  it('configure maps workspace scope to the `local` scope flag', async () => {
    runCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    await claudeAdapter.configure('applyer', invocation, 'workspace')
    const [, args] = runCommand.mock.calls[0] as [string, string[]]
    expect(args).toContain('--scope')
    expect(args[args.indexOf('--scope') + 1]).toBe('local')
  })

  it('configure surfaces stderr as the error message on failure', async () => {
    runCommand.mockResolvedValue({ code: 1, stdout: '', stderr: 'permission denied\n' })
    const result = await claudeAdapter.configure('applyer', invocation, 'user')
    expect(result).toEqual({ success: false, error: 'permission denied' })
  })

  it('configure falls back to a generic error message when stderr is empty', async () => {
    runCommand.mockResolvedValue({ code: 1, stdout: '', stderr: '' })
    const result = await claudeAdapter.configure('applyer', invocation, 'user')
    expect(result).toEqual({ success: false, error: 'claude mcp add exited with code 1' })
  })

  it('getManualSnippet quotes arguments containing whitespace', () => {
    const snippet = claudeAdapter.getManualSnippet('applyer', { command: 'node', args: ['/a b/bridge.mjs'] }, 'user')
    expect(snippet).toContain('"/a b/bridge.mjs"')
    expect(snippet).toContain('claude mcp add --scope user')
  })

  it('getManualSnippet for workspace scope prefixes a `cd` into the workspace dir', () => {
    const snippet = claudeAdapter.getManualSnippet('applyer', invocation, 'workspace')
    expect(snippet.startsWith('cd ')).toBe(true)
    expect(snippet).toContain('&& claude mcp add --scope local')
  })

  it('getManualSnippet includes -e flags for each env var', () => {
    const snippet = claudeAdapter.getManualSnippet('applyer', { ...invocation, env: { A: '1', B: '2' } }, 'user')
    expect(snippet).toContain('-e A=1')
    expect(snippet).toContain('-e B=2')
  })
})
