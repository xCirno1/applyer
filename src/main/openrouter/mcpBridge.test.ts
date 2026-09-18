import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import { __resetElectronMock } from '../../../test/mocks/electron'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
})

import { listToolDefinitions, callTool, __resetMcpBridgeForTests } from './mcpBridge'
import { queueJob } from '../db/repositories/jobsRepository'

beforeEach(() => {
  __resetMcpBridgeForTests()
})

describe('listToolDefinitions', () => {
  it('converts every MCP tool into an OpenAI function definition with an object schema', async () => {
    const tools = await listToolDefinitions()
    expect(tools.length).toBeGreaterThan(10)
    for (const tool of tools) {
      expect(tool.type).toBe('function')
      expect(tool.function.name.length).toBeGreaterThan(0)
      expect(tool.function.parameters).toMatchObject({ type: 'object' })
    }
    const listJobs = tools.find((t) => t.function.name === 'list_jobs')
    expect(listJobs).toBeDefined()
    expect(listJobs?.function.description?.length).toBeGreaterThan(0)
  })

  it('caches the tool list after the first call', async () => {
    const first = await listToolDefinitions()
    const second = await listToolDefinitions()
    expect(second).toBe(first)
  })
})

describe('callTool', () => {
  it('flattens a text tool result and reports isError false on success', async () => {
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1', matchScore: 80 })
    const result = await callTool('list_jobs', { status: undefined, limit: undefined, offset: undefined })
    expect(result.isError).toBe(false)
    const body = JSON.parse(result.text) as { total: number }
    expect(body.total).toBe(1)
  })

  it('never throws: an unknown tool name comes back as an error result', async () => {
    const result = await callTool('not_a_real_tool', {})
    expect(result.isError).toBe(true)
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('treats non-object arguments as an empty argument set rather than throwing', async () => {
    const result = await callTool('list_jobs', 'not an object')
    expect(result.isError).toBe(false)
  })
})
