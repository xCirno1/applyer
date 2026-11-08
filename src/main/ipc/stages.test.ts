import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { IPC } from '@shared/types/ipcEvents'
import { BUILTIN_STAGE_IDS } from '@shared/types/applicationStage'
import { createTestDb } from '../db/testDb'
import { __invokeIpc, __resetElectronMock } from '../../../test/mocks/electron'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

const mocks = vi.hoisted(() => ({
  broadcastJobUpdate: vi.fn(),
  broadcastStagesChanged: vi.fn()
}))
vi.mock('./jobsBroadcast', () => ({
  broadcastJobUpdate: mocks.broadcastJobUpdate,
  broadcastStagesChanged: mocks.broadcastStagesChanged
}))

import { registerStagesIpc } from './stages'
import { getJob, queueJob, setFilled, setSubmitted } from '../db/repositories/jobsRepository'
import { createStage, getStage, setJobsStage } from '../db/repositories/applicationStagesRepository'

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
  mocks.broadcastJobUpdate.mockReset()
  mocks.broadcastStagesChanged.mockReset()
  registerStagesIpc()
})

let urlCounter = 0
function submittedJob(): string {
  const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: `https://example.com/ipc-${++urlCounter}` })
  setFilled(job.id)
  setSubmitted(job.id)
  return job.id
}

describe('stages:list and stages:counts', () => {
  it('lists the stages and the Submitted counts', async () => {
    const id = submittedJob()
    setJobsStage([id], 'offer')
    const list = (await __invokeIpc(IPC.stages.list)) as { stages: { id: string }[] }
    expect(list.stages.map((stage) => stage.id)).toEqual([...BUILTIN_STAGE_IDS])
    const counts = (await __invokeIpc(IPC.stages.counts)) as { counts: { stageId: string | null; count: number }[] }
    expect(counts.counts.find((entry) => entry.stageId === 'offer')?.count).toBe(1)
    expect(counts.counts.at(-1)).toEqual({ stageId: null, count: 0 })
  })
})

describe('stages:create / rename / reorder', () => {
  it('creates a stage and broadcasts', async () => {
    const result = (await __invokeIpc(IPC.stages.create, { label: 'Phone screen' })) as { ok: boolean; value: { id: string } }
    expect(result.ok).toBe(true)
    expect(getStage(result.value.id)?.label).toBe('Phone screen')
    expect(mocks.broadcastStagesChanged).toHaveBeenCalledTimes(1)
  })

  it('returns a typed error for a clash or a malformed payload, without broadcasting', async () => {
    createStage('Phone screen')
    expect(await __invokeIpc(IPC.stages.create, { label: 'phone screen' })).toEqual({
      ok: false,
      error: { code: 'stageNameTaken', params: { name: 'phone screen' } }
    })
    expect(await __invokeIpc(IPC.stages.create, { label: 42 })).toMatchObject({ ok: false, error: { code: 'invalidStageName' } })
    expect(await __invokeIpc(IPC.stages.create, null)).toMatchObject({ ok: false })
    expect(mocks.broadcastStagesChanged).not.toHaveBeenCalled()
  })

  it('renames a custom stage and refuses a built-in one', async () => {
    const stage = createStage('Phone screen')
    expect(await __invokeIpc(IPC.stages.rename, { stageId: stage.id, label: 'Recruiter call' })).toMatchObject({
      ok: true,
      value: { label: 'Recruiter call' }
    })
    expect(await __invokeIpc(IPC.stages.rename, { stageId: 'offer', label: 'Offer letter' })).toMatchObject({
      ok: false,
      error: { code: 'stageBuiltinLocked' }
    })
    expect(await __invokeIpc(IPC.stages.rename, { stageId: 'ghost', label: 'Whatever' })).toMatchObject({
      ok: false,
      error: { code: 'stageNotFound' }
    })
  })

  it('reorders, and rejects a payload that is not a list of ids', async () => {
    const order = [...BUILTIN_STAGE_IDS].reverse()
    const result = (await __invokeIpc(IPC.stages.reorder, { orderedIds: order })) as { ok: boolean; value: { id: string }[] }
    expect(result.value.map((stage) => stage.id)).toEqual(order)
    expect(await __invokeIpc(IPC.stages.reorder, { orderedIds: 'offer' })).toMatchObject({ ok: false })
  })
})

describe('stages:remove', () => {
  it('deletes a stage, pushes every job it cleared and reports how many', async () => {
    const stage = createStage('Phone screen')
    const a = submittedJob()
    const b = submittedJob()
    setJobsStage([a, b], stage.id)
    expect(await __invokeIpc(IPC.stages.remove, { stageId: stage.id })).toEqual({ ok: true, value: { clearedJobs: 2 } })
    expect(getJob(a)?.stageId).toBeNull()
    expect(mocks.broadcastJobUpdate).toHaveBeenCalledTimes(2)
    expect(mocks.broadcastStagesChanged).toHaveBeenCalledTimes(1)
  })

  it('treats an unknown stage as already gone and refuses a built-in', async () => {
    expect(await __invokeIpc(IPC.stages.remove, { stageId: 'ghost' })).toEqual({ ok: true, value: { clearedJobs: 0 } })
    expect(mocks.broadcastStagesChanged).not.toHaveBeenCalled()
    expect(await __invokeIpc(IPC.stages.remove, { stageId: 'offer' })).toMatchObject({ ok: false, error: { code: 'stageBuiltinLocked' } })
    expect(await __invokeIpc(IPC.stages.remove, {})).toMatchObject({ ok: false, error: { code: 'stageNotFound' } })
  })
})

describe('stages:setJobStage', () => {
  it('sets the stage on Submitted jobs and reports the ones it skipped', async () => {
    const submitted = submittedJob()
    const queued = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/ipc-queued' }).job.id
    const result = (await __invokeIpc(IPC.stages.setJobStage, { jobIds: [submitted, queued], stageId: 'interviewing' })) as {
      ok: boolean
      value: { jobs: { id: string; stageId: string | null }[]; skippedIds: string[] }
    }
    expect(result.ok).toBe(true)
    expect(result.value.jobs.map((job) => [job.id, job.stageId])).toEqual([[submitted, 'interviewing']])
    expect(result.value.skippedIds).toEqual([queued])
    expect(mocks.broadcastJobUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.broadcastStagesChanged).toHaveBeenCalledTimes(1)
  })

  it('clears a stage with null', async () => {
    const id = submittedJob()
    setJobsStage([id], 'offer')
    await __invokeIpc(IPC.stages.setJobStage, { jobIds: [id], stageId: null })
    expect(getJob(id)?.stageId).toBeNull()
  })

  it('refuses an unknown stage and malformed payloads without writing', async () => {
    const id = submittedJob()
    expect(await __invokeIpc(IPC.stages.setJobStage, { jobIds: [id], stageId: 'ghost' })).toMatchObject({
      ok: false,
      error: { code: 'stageNotFound' }
    })
    expect(await __invokeIpc(IPC.stages.setJobStage, { jobIds: [], stageId: 'offer' })).toMatchObject({ ok: false })
    expect(await __invokeIpc(IPC.stages.setJobStage, { jobIds: [id] })).toMatchObject({ ok: false })
    expect(getJob(id)?.stageId).toBeNull()
    expect(mocks.broadcastJobUpdate).not.toHaveBeenCalled()
  })
})
