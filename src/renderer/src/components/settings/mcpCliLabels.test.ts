import { describe, it, expect } from 'vitest'
import { CLI_LABELS } from './mcpCliLabels'

describe('CLI_LABELS', () => {
  it('has a human-readable label for every McpCliId', () => {
    expect(CLI_LABELS).toEqual({ claude: 'Claude Code', codex: 'Codex CLI' })
  })
})
