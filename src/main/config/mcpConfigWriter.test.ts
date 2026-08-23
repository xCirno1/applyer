import { describe, it, expect, vi, beforeEach } from 'vitest'
import { __setPackaged } from '../../../test/mocks/electron'

const { claudeAdapter, codexAdapter } = vi.hoisted(() => ({
  claudeAdapter: {
    id: 'claude' as const,
    displayName: 'Claude Code',
    cliCommand: 'claude',
    supportsWorkspaceScope: true,
    isCliAvailable: vi.fn(),
    isConfigured: vi.fn(),
    configure: vi.fn(),
    getManualSnippet: vi.fn(() => 'claude-snippet')
  },
  codexAdapter: {
    id: 'codex' as const,
    displayName: 'Codex CLI',
    cliCommand: 'codex',
    supportsWorkspaceScope: false,
    isCliAvailable: vi.fn(),
    isConfigured: vi.fn(),
    configure: vi.fn(),
    getManualSnippet: vi.fn(() => 'codex-snippet')
  }
}))

vi.mock('./adapters/claudeAdapter', () => ({ claudeAdapter }))
vi.mock('./adapters/codexAdapter', () => ({ codexAdapter }))

import { getMcpInvocation, detectMcpConfigs, getMcpSnippet, autoConfigureMcp, verifyMcpConnection } from './mcpConfigWriter'

beforeEach(() => {
  claudeAdapter.isCliAvailable.mockReset().mockResolvedValue(false)
  claudeAdapter.isConfigured.mockReset().mockResolvedValue(false)
  claudeAdapter.configure.mockReset()
  codexAdapter.isCliAvailable.mockReset().mockResolvedValue(false)
  codexAdapter.isConfigured.mockReset().mockResolvedValue(false)
  codexAdapter.configure.mockReset()
  __setPackaged(false)
})

describe('getMcpInvocation', () => {
  it('spawns via node + resources/mcp-bridge.mjs in dev mode', () => {
    __setPackaged(false)
    const invocation = getMcpInvocation()
    expect(invocation.command).toBe('node')
    expect(invocation.args[0]).toContain('mcp-bridge.mjs')
    expect(invocation.env).toBeUndefined()
  })

  it('spawns the packaged binary as plain Node via ELECTRON_RUN_AS_NODE when packaged', () => {
    // process.resourcesPath only exists (and is read-only) inside a real
    // Electron process — cast to a mutable shape to stand one up for this test.
    const mutableProcess = process as unknown as { resourcesPath?: string }
    const original = mutableProcess.resourcesPath
    mutableProcess.resourcesPath = '/fake/resources'
    try {
      __setPackaged(true)
      const invocation = getMcpInvocation()
      expect(invocation.command).toBe(process.execPath)
      expect(invocation.args[0]).toBe('/fake/resources/mcp-bridge.mjs')
      expect(invocation.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    } finally {
      mutableProcess.resourcesPath = original
    }
  })

  it('always passes the socket path as the second arg', () => {
    const invocation = getMcpInvocation()
    expect(invocation.args[1]).toMatch(/mcp\.sock$/)
  })
})

describe('detectMcpConfigs', () => {
  it('reports an unavailable CLI with no configured scopes checked', async () => {
    const results = await detectMcpConfigs()
    const claude = results.find((r) => r.cli === 'claude')!
    expect(claude.exists).toBe(false)
    expect(claude.configuredScopes).toEqual([])
    expect(claudeAdapter.isConfigured).not.toHaveBeenCalled()
  })

  it('checks both user and workspace scope for an available CLI that supports workspace scope', async () => {
    claudeAdapter.isCliAvailable.mockResolvedValue(true)
    claudeAdapter.isConfigured.mockImplementation(async (_name: string, scope: string) => scope === 'user')

    const results = await detectMcpConfigs()
    const claude = results.find((r) => r.cli === 'claude')!
    expect(claude.exists).toBe(true)
    expect(claude.supportsWorkspaceScope).toBe(true)
    expect(claude.configuredScopes).toEqual(['user'])
    expect(claudeAdapter.isConfigured).toHaveBeenCalledWith('applyer', 'user')
    expect(claudeAdapter.isConfigured).toHaveBeenCalledWith('applyer', 'workspace')
  })

  it('only checks user scope for a CLI that does not support workspace scope', async () => {
    codexAdapter.isCliAvailable.mockResolvedValue(true)
    codexAdapter.isConfigured.mockResolvedValue(true)

    const results = await detectMcpConfigs()
    const codex = results.find((r) => r.cli === 'codex')!
    expect(codex.configuredScopes).toEqual(['user'])
    expect(codexAdapter.isConfigured).toHaveBeenCalledTimes(1)
    expect(codexAdapter.isConfigured).toHaveBeenCalledWith('applyer', 'user')
  })

  it('returns one entry per known adapter', async () => {
    const results = await detectMcpConfigs()
    expect(results.map((r) => r.cli).sort()).toEqual(['claude', 'codex'])
  })
})

describe('getMcpSnippet', () => {
  it('delegates to the matching adapter with the server name, invocation, and scope', () => {
    const snippet = getMcpSnippet('claude', 'workspace')
    expect(snippet).toBe('claude-snippet')
    expect(claudeAdapter.getManualSnippet).toHaveBeenCalledWith(
      'applyer',
      expect.objectContaining({ args: expect.any(Array) }),
      'workspace'
    )
  })
})

describe('autoConfigureMcp', () => {
  it('delegates to the matching adapter\'s configure()', async () => {
    claudeAdapter.configure.mockResolvedValue({ success: true })
    const result = await autoConfigureMcp('claude', 'user')
    expect(result).toEqual({ success: true })
    expect(claudeAdapter.configure).toHaveBeenCalledWith('applyer', expect.any(Object), 'user')
  })
})

describe('verifyMcpConnection', () => {
  it('returns success:false (not a thrown error) when the configured command cannot be spawned/connected to', async () => {
    __setPackaged(false)
    // Dev-mode invocation points `node` at resources/mcp-bridge.mjs under
    // app.getAppPath(), which our electron mock sets to process.cwd() (the
    // real repo root) — that file exists for real, but nothing is listening
    // on the (nonexistent) socket path it's told to bridge to, so the
    // connection genuinely fails end-to-end, exercising the real
    // StdioClientTransport failure path rather than a mocked one.
    const result = await verifyMcpConnection()
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  }, 15000)
})
