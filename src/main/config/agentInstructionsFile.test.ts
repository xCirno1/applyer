import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'
import { __resetElectronMock, __setEncryptionAvailable } from '../../../test/mocks/electron'

// The write path with a real (in-memory) database, kept apart from
// agentInstructions.test.ts, which covers the no-database fallback.
let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  __resetElectronMock()
  testDb = createTestDb().db
})

import { buildAgentInstructions, writeAgentInstructions } from './agentInstructions'
import { saveCustomSystemPrompt } from './customSystemPrompt'
import { setStorageMode } from '../db/repositories/settingsRepository'
import { agentWorkspaceDir } from './paths'

function readBoth(): { claude: string; agents: string } {
  const dir = agentWorkspaceDir()
  return {
    claude: readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'),
    agents: readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
  }
}

describe('writeAgentInstructions with custom instructions', () => {
  it('embeds the text in both files in plaintext storage mode', () => {
    setStorageMode('plaintext')
    saveCustomSystemPrompt('Only remote roles.')
    writeAgentInstructions()
    const { claude, agents } = readBoth()
    expect(claude).toBe(agents)
    expect(claude).toBe(
      buildAgentInstructions({
        autoTailor: false,
        customPrompt: 'Only remote roles.',
        embedCustomPrompt: true
      })
    )
  })

  it('never writes the text to disk in encrypted storage mode', () => {
    setStorageMode('encrypted')
    saveCustomSystemPrompt('Only remote roles.')
    writeAgentInstructions()
    const { claude, agents } = readBoth()
    expect(claude).not.toContain('Only remote roles.')
    expect(agents).not.toContain('Only remote roles.')
    expect(claude).toContain("MCP server's instructions")
  })

  it('still writes the built-in instructions when the stored text cannot be decrypted', () => {
    setStorageMode('encrypted')
    saveCustomSystemPrompt('Only remote roles.')
    __setEncryptionAvailable(false)
    writeAgentInstructions()
    expect(readBoth().claude).toBe(buildAgentInstructions({ autoTailor: false }))
  })

  it('drops the section once the instructions are cleared', () => {
    setStorageMode('plaintext')
    saveCustomSystemPrompt('Only remote roles.')
    writeAgentInstructions()
    saveCustomSystemPrompt('')
    writeAgentInstructions()
    expect(readBoth().claude).toBe(buildAgentInstructions({ autoTailor: false }))
  })
})
