import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { APPLYER_MCP_TOOLS } from './constants'

/**
 * `APPLYER_MCP_TOOLS` is a second list of the same tool names
 * `src/main/mcp-server/server.ts` registers, kept for the renderer's
 * OpenRouter tool-approval editor (which has no way to import main-process
 * code). This asserts the two never drift: every `server.registerTool(...)`
 * call in that file names exactly the tools listed here, in either order.
 */
describe('APPLYER_MCP_TOOLS', () => {
  it('has no duplicate names', () => {
    const names = APPLYER_MCP_TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every entry has a valid kind', () => {
    for (const tool of APPLYER_MCP_TOOLS) {
      expect(['read', 'write', 'form']).toContain(tool.kind)
    }
  })

  it('matches every tool registered in mcp-server/server.ts', () => {
    const serverPath = fileURLToPath(new URL('../main/mcp-server/server.ts', import.meta.url))
    const source = readFileSync(serverPath, 'utf8')
    const registered = [...source.matchAll(/server\.registerTool\(\s*\n?\s*'([a-z_]+)'/g)].map((m) => m[1])

    expect(registered.length).toBeGreaterThan(0)
    expect(new Set(APPLYER_MCP_TOOLS.map((t) => t.name))).toEqual(new Set(registered))
  })
})
