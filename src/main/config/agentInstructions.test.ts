import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { __resetElectronMock } from '../../../test/mocks/electron'
import { writeAgentInstructions } from './agentInstructions'
import { agentWorkspaceDir } from './paths'

beforeEach(() => {
  __resetElectronMock()
})

describe('writeAgentInstructions', () => {
  it('writes identical CLAUDE.md and AGENTS.md into the agent workspace dir', () => {
    writeAgentInstructions()
    const dir = agentWorkspaceDir()
    const claudeMd = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')
    const agentsMd = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(claudeMd).toBe(agentsMd)
  })

  it('documents every MCP tool by name', () => {
    writeAgentInstructions()
    const content = readFileSync(join(agentWorkspaceDir(), 'CLAUDE.md'), 'utf-8')
    for (const tool of [
      'get_profile',
      'search_jobs',
      'get_job_details',
      'list_jobs',
      'queue_job',
      'fill_application',
      'flag_failure',
      'exclude_job'
    ]) {
      expect(content).toContain(tool)
    }
  })

  it('overwrites stale content on a second call', () => {
    writeAgentInstructions()
    const path = join(agentWorkspaceDir(), 'CLAUDE.md')
    const first = readFileSync(path, 'utf-8')
    writeAgentInstructions()
    const second = readFileSync(path, 'utf-8')
    expect(second).toBe(first)
  })
})
