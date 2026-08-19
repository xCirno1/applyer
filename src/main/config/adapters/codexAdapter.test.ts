import { describe, it, expect, vi, beforeEach } from 'vitest'

const runCommand = vi.fn()
const commandExists = vi.fn()
vi.mock('../processUtils', () => ({
  runCommand: (...args: unknown[]) => runCommand(...args),
  commandExists: (...args: unknown[]) => commandExists(...args)
}))

import { codexAdapter } from './codexAdapter'
import type { McpInvocation } from '../mcpAdapter'

const invocation: McpInvocation = { command: 'node', args: ['/path/to/bridge.mjs', '/tmp/mcp.sock'] }

beforeEach(() => {
  runCommand.mockReset()
  commandExists.mockReset()
})

describe('codexAdapter', () => {
  it('identifies itself correctly and never claims workspace scope support', () => {
    expect(codexAdapter.id).toBe('codex')
    expect(codexAdapter.cliCommand).toBe('codex')
    expect(codexAdapter.supportsWorkspaceScope).toBe(false)
  })

  it('isCliAvailable defers to commandExists("codex")', async () => {
    commandExists.mockResolvedValue(false)
    await expect(codexAdapter.isCliAvailable()).resolves.toBe(false)
    expect(commandExists).toHaveBeenCalledWith('codex')
  })

  it('isConfigured runs `codex mcp get <name>` with no cwd override', async () => {
    runCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    await expect(codexAdapter.isConfigured('applyer', 'user')).resolves.toBe(true)
    expect(runCommand).toHaveBeenCalledWith('codex', ['mcp', 'get', 'applyer'])
  })

  it('configure builds a `codex mcp add` command with --env flags (no --scope, unlike claude)', async () => {
    runCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    const result = await codexAdapter.configure('applyer', { ...invocation, env: { FOO: 'bar' } }, 'user')
    expect(result).toEqual({ success: true })
    expect(runCommand).toHaveBeenCalledWith('codex', [
      'mcp',
      'add',
      '--env',
      'FOO=bar',
      'applyer',
      '--',
      'node',
      '/path/to/bridge.mjs',
      '/tmp/mcp.sock'
    ])
  })

  it('configure surfaces stderr as the error message on failure', async () => {
    runCommand.mockResolvedValue({ code: 1, stdout: '', stderr: 'no such command\n' })
    const result = await codexAdapter.configure('applyer', invocation, 'user')
    expect(result).toEqual({ success: false, error: 'no such command' })
  })

  it('getManualSnippet uses --env flags and never a --scope flag', () => {
    const snippet = codexAdapter.getManualSnippet('applyer', { ...invocation, env: { A: '1' } }, 'user')
    expect(snippet).toBe('codex mcp add --env A=1 applyer -- node /path/to/bridge.mjs /tmp/mcp.sock')
    expect(snippet).not.toContain('--scope')
  })

  it('getManualSnippet quotes arguments containing whitespace', () => {
    const snippet = codexAdapter.getManualSnippet('applyer', { command: 'node', args: ['/a b/bridge.mjs'] }, 'user')
    expect(snippet).toContain('"/a b/bridge.mjs"')
  })
})
