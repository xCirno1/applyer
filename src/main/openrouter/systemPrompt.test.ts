import { describe, it, expect } from 'vitest'
import { buildChatSystemPrompt } from './systemPrompt'
import { buildAgentToolGuide } from '../config/agentInstructions'

describe('buildChatSystemPrompt', () => {
  it('names the model, states today\'s date, and never mentions the terminal', () => {
    const prompt = buildChatSystemPrompt({
      autoTailor: false,
      modelId: 'openai/gpt-5',
      now: new Date('2026-09-16T12:00:00.000Z')
    })
    expect(prompt).toContain('`openai/gpt-5`')
    expect(prompt).toContain('Today\'s date is 2026-09-16.')
    expect(prompt).not.toContain('terminal working directory')
    expect(prompt).not.toContain('This file is regenerated')
  })

  it('tells the agent it has no filesystem/shell and must never claim to have submitted an application', () => {
    const prompt = buildChatSystemPrompt({ autoTailor: false, modelId: 'x/model' })
    expect(prompt).toContain('no filesystem')
    expect(prompt).toContain('no shell')
    expect(prompt.toLowerCase()).toContain('never claim')
    expect(prompt.toLowerCase()).toContain('submitted')
  })

  it('appends the exact shared tool guide for the given autoTailor value', () => {
    for (const autoTailor of [true, false]) {
      const prompt = buildChatSystemPrompt({ autoTailor, modelId: 'x/model' })
      const guide = buildAgentToolGuide({ autoTailor })
      expect(prompt.endsWith(guide)).toBe(true)
    }
  })

  it('documents every MCP tool by name via the shared guide', () => {
    const prompt = buildChatSystemPrompt({ autoTailor: false, modelId: 'x/model' })
    for (const tool of [
      'get_profile',
      'search_jobs',
      'queue_job',
      'inspect_application',
      'fill_application',
      'save_resume_variant'
    ]) {
      expect(prompt).toContain(tool)
    }
  })

  it('defaults to the real current date when none is given', () => {
    const prompt = buildChatSystemPrompt({ autoTailor: false, modelId: 'x/model' })
    const todayIso = new Date().toISOString().slice(0, 10)
    expect(prompt).toContain(`Today's date is ${todayIso}.`)
  })
})
