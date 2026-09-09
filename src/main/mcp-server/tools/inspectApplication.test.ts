import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))
const runInspectTask = vi.fn()
vi.mock('../../browser/fillTaskRunner', () => ({ runInspectTask: (...args: unknown[]) => runInspectTask(...args) }))

beforeEach(() => {
  testDb = createTestDb().db
  runInspectTask.mockReset()
})

import { inspectApplicationTool } from './inspectApplication'

describe('inspectApplicationTool', () => {
  it('returns live questions and options to the agent', async () => {
    runInspectTask.mockResolvedValue({ status: 'inspected', jobId: 'job-1', mode: 'fill', fields: [{ fieldId: 'field-eligible', label: 'Eligible?', control: 'select', required: true, currentValue: '', options: [{ label: 'Yes', value: 'yes' }] }], storedDocuments: [], message: 'ready' })
    const result = await inspectApplicationTool({ jobId: 'job-1' })
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ status: 'inspected', fields: [{ fieldId: 'field-eligible', label: 'Eligible?' }] })
    expect(runInspectTask).toHaveBeenCalledWith('job-1')
  })
})
