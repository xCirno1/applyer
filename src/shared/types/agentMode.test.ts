import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_MODE, isAgentMode } from './agentMode'

describe('isAgentMode', () => {
  it('accepts cli and openrouter', () => {
    expect(isAgentMode('cli')).toBe(true)
    expect(isAgentMode('openrouter')).toBe(true)
  })

  it.each([undefined, null, '', 'terminal', 42, {}])('rejects an unknown value: %j', (value) => {
    expect(isAgentMode(value)).toBe(false)
  })

  it('defaults to cli', () => {
    expect(DEFAULT_AGENT_MODE).toBe('cli')
  })
})
