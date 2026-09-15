import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
let dbBroken = false
vi.mock('../db/index', () => ({
  getDb: () => {
    if (dbBroken) throw new Error('database closed')
    return testDb
  }
}))
const broadcastRunsChanged = vi.fn()
vi.mock('../ipc/jobsBroadcast', () => ({ broadcastRunsChanged: () => broadcastRunsChanged() }))
const warn = vi.fn()
vi.mock('../logger', () => ({ appLogger: { warn: (...args: unknown[]) => warn(...args) } }))

import { __resetRunTracker, getCurrentRun, recordRunEvent, startRun, stopRun } from './runTracker'
import { createRun, loadRunEvents } from '../db/repositories/runsRepository'

beforeEach(() => {
  testDb = createTestDb().db
  dbBroken = false
  broadcastRunsChanged.mockReset()
  warn.mockReset()
  __resetRunTracker()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runTracker', () => {
  it('drops events while no run is in progress', () => {
    recordRunEvent('job_queued', { source: 'seek' })
    expect(getCurrentRun()).toBeNull()
    expect(broadcastRunsChanged).not.toHaveBeenCalled()
  })

  it('records events on the run in progress and coalesces the push', () => {
    const run = startRun('batch')
    expect(broadcastRunsChanged).toHaveBeenCalledTimes(1)

    recordRunEvent('search', { meta: { query: 'x' } })
    recordRunEvent('tool_call', { meta: { tool: 'search_jobs' } })
    expect(broadcastRunsChanged).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(broadcastRunsChanged).toHaveBeenCalledTimes(2)

    expect(loadRunEvents(run.id).map((event) => event.kind)).toEqual(['search', 'tool_call'])
    expect(getCurrentRun()).toMatchObject({ id: run.id, label: 'batch', eventCount: 2 })
  })

  it('stops the run and stops recording', () => {
    const run = startRun()
    recordRunEvent('job_queued')
    const stopped = stopRun()
    expect(stopped?.id).toBe(run.id)
    expect(stopped?.endedAt).toEqual(expect.any(String))
    recordRunEvent('job_queued')
    expect(loadRunEvents(run.id)).toHaveLength(1)
    expect(getCurrentRun()).toBeNull()
  })

  it('stopRun answers null when nothing is running', () => {
    expect(stopRun()).toBeNull()
  })

  it('picks up a run left open in the database (an app restart mid-run)', () => {
    const run = createRun('before restart')
    __resetRunTracker()
    recordRunEvent('job_queued')
    expect(loadRunEvents(run.id)).toHaveLength(1)
  })

  it('never throws at a caller when the database is unavailable', () => {
    startRun()
    dbBroken = true
    expect(() => recordRunEvent('job_queued')).not.toThrow()
    expect(getCurrentRun()).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('does not cache a failed active-run read as "no run"', () => {
    const run = createRun()
    __resetRunTracker()
    dbBroken = true
    recordRunEvent('job_queued')
    dbBroken = false
    recordRunEvent('job_queued')
    expect(loadRunEvents(run.id)).toHaveLength(1)
  })
})
