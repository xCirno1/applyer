import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../../db/testDb'
import * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: ReturnType<typeof createTestDb>['sqlite']
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

const mocks = vi.hoisted(() => ({
  broadcastJobUpdate: vi.fn(),
  broadcastStagesChanged: vi.fn()
}))
vi.mock('../../ipc/jobsBroadcast', () => ({
  broadcastJobUpdate: mocks.broadcastJobUpdate,
  broadcastStagesChanged: mocks.broadcastStagesChanged
}))

beforeEach(() => {
  const created = createTestDb()
  testDb = created.db
  testSqlite = created.sqlite
  mocks.broadcastJobUpdate.mockReset()
  mocks.broadcastStagesChanged.mockReset()
})

import { setApplicationStageTool } from './setApplicationStage'
import { listApplicationStagesTool } from './listApplicationStages'
import { listJobsTool } from './listJobs'
import { getJob, queueJob, setFilled, setSubmitted } from '../../db/repositories/jobsRepository'
import { createStage, setJobsStage } from '../../db/repositories/applicationStagesRepository'
import { BUILTIN_STAGE_IDS } from '@shared/types/applicationStage'

type ToolResult = Awaited<ReturnType<typeof setApplicationStageTool>>

function body(result: ToolResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text)
}

function errorText(result: ToolResult): string {
  expect(result.isError).toBe(true)
  return (result.content[0] as { text: string }).text
}

let urlCounter = 0
function submittedJob(title = 'Engineer'): string {
  const { job } = queueJob({ title, company: 'Acme', url: `https://example.com/mcp-${++urlCounter}` })
  setFilled(job.id)
  setSubmitted(job.id)
  return job.id
}

describe('set_application_stage', () => {
  it('sets a stage by name, case-insensitively, and broadcasts', async () => {
    const id = submittedJob()
    const result = await setApplicationStageTool({ jobId: id, stage: 'interviewing' })
    expect(body(result)).toMatchObject({ status: 'stage_set', jobId: id, stage: 'Interviewing' })
    expect(getJob(id)?.stageId).toBe('interviewing')
    expect(mocks.broadcastJobUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.broadcastStagesChanged).toHaveBeenCalledTimes(1)
  })

  it('sets a custom stage by its name', async () => {
    const stage = createStage('Phone screen')
    const id = submittedJob()
    await setApplicationStageTool({ jobId: id, stage: 'Phone Screen' })
    expect(getJob(id)?.stageId).toBe(stage.id)
  })

  it('clears the stage when none is given', async () => {
    const id = submittedJob()
    setJobsStage([id], 'offer')
    expect(body(await setApplicationStageTool({ jobId: id, stage: null }))).toMatchObject({ status: 'stage_cleared', stage: null })
    expect(getJob(id)?.stageId).toBeNull()
    await setApplicationStageTool({ jobId: id, stage: undefined })
    expect(getJob(id)?.stageId).toBeNull()
  })

  it('lists the existing stages when the name is unknown', async () => {
    const id = submittedJob()
    const text = errorText(await setApplicationStageTool({ jobId: id, stage: 'Hired' }))
    expect(text).toContain('"Hired"')
    expect(text).toContain('"Awaiting response"')
    expect(getJob(id)?.stageId).toBeNull()
  })

  it('refuses a job that is missing or not Submitted', async () => {
    expect(errorText(await setApplicationStageTool({ jobId: 'ghost', stage: 'Offer' }))).toContain('No tracked job')
    const queued = queueJob({ title: 'Queued', company: 'Acme', url: 'https://example.com/mcp-queued' }).job.id
    expect(errorText(await setApplicationStageTool({ jobId: queued, stage: 'Offer' }))).toContain('not submitted')
    expect(mocks.broadcastJobUpdate).not.toHaveBeenCalled()
  })

  it('does not broadcast when the job is already in that stage', async () => {
    const id = submittedJob()
    setJobsStage([id], 'offer')
    await setApplicationStageTool({ jobId: id, stage: 'Offer' })
    expect(mocks.broadcastStagesChanged).not.toHaveBeenCalled()
  })
})

describe('list_application_stages', () => {
  it('lists stages in order with their counts and the no-stage count', async () => {
    const phone = createStage('Phone screen')
    const a = submittedJob()
    submittedJob()
    setJobsStage([a], phone.id)
    const result = body(await listApplicationStagesTool()) as {
      stages: { name: string; id: string; builtin: boolean; submittedJobs: number }[]
      submittedWithoutStage: number
    }
    expect(result.stages.map((stage) => stage.id)).toEqual([...BUILTIN_STAGE_IDS, phone.id])
    expect(result.stages.at(-1)).toEqual({ name: 'Phone screen', id: phone.id, builtin: false, submittedJobs: 1 })
    expect(result.submittedWithoutStage).toBe(1)
  })
})

describe('list_jobs stage filter', () => {
  function jobs(result: ToolResult): { jobId: string; status: string; stage?: string | null }[] {
    return (body(result) as { jobs: { jobId: string; status: string; stage?: string | null }[] }).jobs
  }

  it('reports the stage name on Submitted jobs only', async () => {
    const id = submittedJob()
    setJobsStage([id], 'offer')
    queueJob({ title: 'Queued', company: 'Acme', url: 'https://example.com/mcp-q' })
    const all = jobs(await listJobsTool({ stage: undefined, status: undefined, limit: undefined, offset: undefined }))
    expect(all.find((job) => job.jobId === id)?.stage).toBe('Offer')
    expect(all.find((job) => job.status === 'queued')).not.toHaveProperty('stage')
  })

  it('filters by stage name, or by no stage, implying Submitted', async () => {
    const a = submittedJob()
    const b = submittedJob()
    setJobsStage([a], 'rejected')
    queueJob({ title: 'Queued', company: 'Acme', url: 'https://example.com/mcp-q2' })
    const rejected = jobs(await listJobsTool({ stage: 'Rejected', status: undefined, limit: undefined, offset: undefined }))
    expect(rejected.map((job) => job.jobId)).toEqual([a])
    const none = jobs(await listJobsTool({ stage: 'none', status: 'submitted', limit: undefined, offset: undefined }))
    expect(none.map((job) => job.jobId)).toEqual([b])
  })

  it('refuses an unknown stage, or a stage with another status', async () => {
    expect(errorText(await listJobsTool({ stage: 'Hired', status: undefined, limit: undefined, offset: undefined }))).toContain(
      'Existing stages'
    )
    expect(errorText(await listJobsTool({ stage: 'Offer', status: 'queued', limit: undefined, offset: undefined }))).toContain(
      'only applies to Submitted'
    )
  })

  it('reports a job pointing at an unknown stage as having none', async () => {
    const id = submittedJob()
    testSqlite.pragma('foreign_keys = OFF')
    testDb.update(schema.jobs).set({ stageId: 'ghost' }).where(eq(schema.jobs.id, id)).run()
    testSqlite.pragma('foreign_keys = ON')
    const all = jobs(await listJobsTool({ stage: undefined, status: undefined, limit: undefined, offset: undefined }))
    expect(all[0]?.stage).toBeNull()
  })
})
