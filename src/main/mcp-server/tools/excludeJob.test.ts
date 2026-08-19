import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { excludeJobTool } from './excludeJob'
import { isUrlExcluded } from '../../db/repositories/jobExclusionsRepository'

function parse(result: Awaited<ReturnType<typeof excludeJobTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('excludeJobTool', () => {
  it('excludes a URL, tagging it as agent-excluded (never user)', async () => {
    const result = await excludeJobTool({
      url: 'https://example.com/1',
      title: 'Bad Fit',
      company: undefined,
      reason: 'not remote'
    })
    expect(parse(result)).toMatchObject({ status: 'excluded' })
    expect(isUrlExcluded('https://example.com/1')).toBe(true)
  })

  it('reports "already_excluded" for a repeated call, without erroring', async () => {
    await excludeJobTool({ url: 'https://example.com/1', title: undefined, company: undefined, reason: undefined })
    const result = await excludeJobTool({ url: 'https://example.com/1', title: undefined, company: undefined, reason: undefined })
    expect(parse(result)).toMatchObject({ status: 'already_excluded' })
    expect(result.isError).toBeUndefined()
  })
})
