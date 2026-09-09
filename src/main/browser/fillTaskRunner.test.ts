import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

const browserMocks = vi.hoisted(() => ({
  launchHeadedContext: vi.fn(),
  requestAgentPermissions: vi.fn(),
  detectCaptcha: vi.fn().mockResolvedValue({ blocked: false })
}))
vi.mock('./browserController', () => ({ launchHeadedContext: browserMocks.launchHeadedContext }))
vi.mock('./captchaDetector', () => ({ detectCaptcha: browserMocks.detectCaptcha }))
vi.mock('./agentPermissionGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentPermissionGate')>()),
  requestAgentPermissions: browserMocks.requestAgentPermissions
}))

beforeEach(() => {
  testDb = createTestDb().db
  browserMocks.launchHeadedContext.mockReset()
  browserMocks.requestAgentPermissions.mockReset()
  browserMocks.detectCaptcha.mockReset().mockResolvedValue({ blocked: false })
})

import { runEditTask, runFillTask, runInspectTask } from './fillTaskRunner'
import { queueJob, setFilled, setSubmitted } from '../db/repositories/jobsRepository'
import { setAgentPermissions } from '../db/repositories/settingsRepository'

function retainablePage(fields: unknown[]): void {
  const page = {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    bringToFront: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(fields),
    once: vi.fn(),
    isClosed: vi.fn().mockReturnValue(false)
  }
  const browser = {
    isConnected: vi.fn().mockReturnValue(true),
    once: vi.fn(),
    close: vi.fn()
  }
  browserMocks.launchHeadedContext.mockResolvedValue({
    browser,
    context: { newPage: vi.fn().mockResolvedValue(page) }
  })
}

describe('runEditTask', () => {
  it('does not open a replacement form when the original Filled application session is gone', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    setFilled(job.id)

    await expect(runEditTask(job.id, [{ fieldId: 'field-email', value: 'jane@example.com' }])).resolves.toEqual({
      status: 'no_active_session',
      jobId: job.id,
      message: 'The original application window is no longer open. Open the job yourself and make changes there.'
    })
  })

  it('refuses to edit a submitted job even if a stale browser session existed', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    setFilled(job.id)
    setSubmitted(job.id)

    const result = await runEditTask(job.id, [{ fieldId: 'field-email', value: 'jane@example.com' }])
    expect(result).toMatchObject({ status: 'failed', jobId: job.id })
    expect(result).toMatchObject({ message: expect.stringContaining('submitted') })
  })
})

describe('retained application sessions', () => {
  it('requires inspection before filling instead of opening a replacement window', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    await expect(runFillTask(job.id, [{ fieldId: 'field-email', value: 'jane@example.com' }])).resolves.toEqual({
      status: 'no_active_session',
      jobId: job.id,
      message: 'No inspected application window is open. Call inspect_application first.'
    })
  })

  it('does not open a replacement window when re-inspecting a Filled job', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    setFilled(job.id)
    await expect(runInspectTask(job.id)).resolves.toMatchObject({ status: 'no_active_session', jobId: job.id })
  })

  it('reports only the permissions that the user denied', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: false })
    retainablePage([
      { fieldId: 'field-email', selector: '#email', label: 'Email', control: 'input', required: true, currentValue: '' },
      { fieldId: 'field-resume', selector: '#resume', label: 'Resume', control: 'file', required: true, currentValue: '' }
    ])
    browserMocks.requestAgentPermissions.mockResolvedValue('deny')
    await expect(runInspectTask(job.id)).resolves.toMatchObject({ status: 'inspected' })

    const result = await runFillTask(job.id, [
      { fieldId: 'field-email', value: 'jane@example.com' },
      { fieldId: 'field-resume', value: 'resume' }
    ])

    expect(browserMocks.requestAgentPermissions).toHaveBeenCalledWith(expect.objectContaining({
      permissions: ['autoUploadDocuments']
    }))
    expect(result).toMatchObject({
      status: 'permission_denied',
      requiredPermissions: ['autoUploadDocuments']
    })
  })
})
