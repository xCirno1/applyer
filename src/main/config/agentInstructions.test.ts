import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { __resetElectronMock } from '../../../test/mocks/electron'
import { buildAgentInstructions, writeAgentInstructions } from './agentInstructions'
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
      'inspect_application',
      'click_application_button',
      'fill_application',
      'edit_application',
      'flag_failure',
      'exclude_job',
      'update_profile',
      'add_company_board',
      'list_company_boards',
      'get_resume',
      'set_master_resume',
      'save_resume_variant',
      'assign_resume',
      'delete_resume_variant'
    ]) {
      expect(content).toContain(tool)
    }
    expect(content).toContain('navigate backward')
  })

  it('adds the tailoring step to the flow only when auto-tailor is on', () => {
    const manual = buildAgentInstructions({ autoTailor: false })
    const auto = buildAgentInstructions({ autoTailor: true })
    expect(manual).not.toContain('pick a resume variant for each queued job')
    expect(manual).not.toContain('tailor_resume')
    expect(auto).not.toContain('tailor_resume')
    expect(manual).toContain('only when the user asks')
    expect(auto).toContain(
      '`queue_job` for\ngood matches → pick a resume variant for each queued job (`assign_resume`, or `save_resume_variant` for a new one) → `inspect_application`'
    )
    expect(auto).toContain('assign\nthe closest one')
    expect(auto).toContain('automatic resume tailoring')
    expect(auto).not.toContain('{TAILOR_STEP}')
    expect(manual).not.toContain('{TAILOR_NOTE}')
  })

  it('falls back to manual tailoring when settings cannot be read', () => {
    writeAgentInstructions()
    const content = readFileSync(join(agentWorkspaceDir(), 'CLAUDE.md'), 'utf-8')
    expect(content).toBe(buildAgentInstructions({ autoTailor: false }))
    writeAgentInstructions({ autoTailor: true })
    expect(readFileSync(join(agentWorkspaceDir(), 'CLAUDE.md'), 'utf-8')).toBe(buildAgentInstructions({ autoTailor: true }))
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
