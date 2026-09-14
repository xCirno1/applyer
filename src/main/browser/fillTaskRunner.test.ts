import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { JSDOM } from 'jsdom'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

const browserMocks = vi.hoisted(() => ({
  openHeadedBrowser: vi.fn(),
  requestAgentPermissions: vi.fn(),
  detectCaptcha: vi.fn().mockResolvedValue({ blocked: false })
}))
vi.mock('./browserController', () => ({ openHeadedBrowser: browserMocks.openHeadedBrowser }))
vi.mock('./captchaDetector', () => ({ detectCaptcha: browserMocks.detectCaptcha }))
const renderMocks = vi.hoisted(() => ({ renderResumePdf: vi.fn() }))
vi.mock('./resumeRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./resumeRenderer')>()),
  renderResumePdf: renderMocks.renderResumePdf
}))
vi.mock('./agentPermissionGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentPermissionGate')>()),
  requestAgentPermissions: browserMocks.requestAgentPermissions
}))

beforeEach(() => {
  testDb = createTestDb().db
  browserMocks.openHeadedBrowser.mockReset()
  browserMocks.requestAgentPermissions.mockReset()
  browserMocks.detectCaptcha.mockReset().mockResolvedValue({ blocked: false })
  renderMocks.renderResumePdf.mockReset()
})

import { runClickButtonTask, runEditTask, runFillTask, runInspectTask } from './fillTaskRunner'
import { getJob, queueJob, setFilled, setSubmitted } from '../db/repositories/jobsRepository'
import { setAgentPermissions, setResumeSettings, setStorageMode } from '../db/repositories/settingsRepository'
import { assignVariant, saveMasterResume, saveVariant } from '../db/repositories/resumeRepository'
import { listActivity } from '../db/repositories/activityLogRepository'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import { existsSync } from 'fs'

function retainablePage(fields: unknown[]): { evaluate: ReturnType<typeof vi.fn> } {
  const page = {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    bringToFront: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(fields),
    locator: vi.fn().mockImplementation(() => ({ fill: vi.fn() })),
    screenshot: vi.fn().mockRejectedValue(new Error('screenshots are not needed in this unit test')),
    once: vi.fn(),
    isClosed: vi.fn().mockReturnValue(false)
  }
  const browser = {
    isConnected: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn()
  }
  browserMocks.openHeadedBrowser.mockResolvedValue({
    browser,
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined)
  })
  return page
}

function retainableDomPage(html: string): Document {
  const dom = new JSDOM(html)
  const visibleRect = {
    x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20,
    toJSON: () => ({})
  } as DOMRect
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => visibleRect
  dom.window.HTMLElement.prototype.getClientRects = () => [visibleRect] as unknown as DOMRectList
  const page = {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    bringToFront: vi.fn(),
    evaluate: vi.fn().mockImplementation(async (callback: (...args: unknown[]) => unknown, arg?: unknown) => {
      const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
      const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
      const previousCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
      Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
      Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value } })
      try {
        return callback(arg)
      } finally {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
        else delete (globalThis as { window?: unknown }).window
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
        else delete (globalThis as { document?: unknown }).document
        if (previousCss) Object.defineProperty(globalThis, 'CSS', previousCss)
        else delete (globalThis as { CSS?: unknown }).CSS
      }
    }),
    locator: vi.fn().mockImplementation((selector: string) => ({
      fill: async (value: string) => {
        const element = dom.window.document.querySelector(selector) as HTMLInputElement | null
        if (!element) throw new Error(`No element matches ${selector}`)
        element.value = value
      },
      click: async () => {
        const element = dom.window.document.querySelector(selector) as HTMLElement | null
        if (!element) throw new Error(`No element matches ${selector}`)
        element.click()
      }
    })),
    screenshot: vi.fn().mockRejectedValue(new Error('screenshots are not written in this unit test')),
    once: vi.fn(),
    isClosed: vi.fn().mockReturnValue(false)
  }
  const browser = {
    isConnected: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn()
  }
  browserMocks.openHeadedBrowser.mockResolvedValue({
    browser,
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined)
  })
  return dom.window.document
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

  it('keeps partial pages Queued and marks only an explicit final step Filled', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: false, autoPressButtons: false })
    retainablePage([
      { fieldId: 'field-email', selector: '#email', label: 'Email', control: 'input', required: true, currentValue: '' }
    ])
    await expect(runInspectTask(job.id)).resolves.toMatchObject({ status: 'inspected', mode: 'fill' })

    await expect(runFillTask(job.id, [{ fieldId: 'field-email', value: 'jane@example.com' }])).resolves.toMatchObject({
      status: 'partially_filled'
    })
    expect(getJob(job.id)?.status).toBe('queued')
    await expect(runInspectTask(job.id)).resolves.toMatchObject({ status: 'inspected', mode: 'fill' })

    await expect(runFillTask(job.id, [], true)).resolves.toMatchObject({ status: 'filled' })
    expect(getJob(job.id)?.status).toBe('filled')
    await expect(runInspectTask(job.id)).resolves.toMatchObject({ status: 'inspected', mode: 'edit' })
  })

  it('retains one ordered screenshot path for each confirmed form page', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/multi-page' })
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: false, autoPressButtons: true })
    const document = retainableDomPage(`
      <form>
        <fieldset id="step-one">
          <label for="email">Email</label><input id="email" name="email">
          <button id="next" type="button">Next</button>
        </fieldset>
        <fieldset id="step-two" hidden>
          <label for="phone">Phone</label><input id="phone" name="phone">
        </fieldset>
      </form>
    `)
    document.getElementById('next')!.addEventListener('click', () => {
      ;(document.getElementById('step-one') as HTMLElement).hidden = true
      ;(document.getElementById('step-two') as HTMLElement).hidden = false
    })

    const first = await runInspectTask(job.id)
    expect(first.status).toBe('inspected')
    if (first.status !== 'inspected') return
    await expect(runFillTask(job.id, [{ fieldId: first.fields[0]!.fieldId, value: 'jane@example.com' }]))
      .resolves.toMatchObject({ status: 'partially_filled' })
    await expect(runClickButtonTask(job.id, first.buttons[0]!.buttonId)).resolves.toMatchObject({ status: 'clicked' })

    const second = await runInspectTask(job.id)
    expect(second.status).toBe('inspected')
    if (second.status !== 'inspected') return
    const result = await runFillTask(job.id, [{ fieldId: second.fields[0]!.fieldId, value: '0400000000' }], true)

    expect(result).toMatchObject({ status: 'filled' })
    if (result.status !== 'filled') return
    expect(result.screenshotPaths.map((path) => path.split(/[\\/]/).pop())).toEqual([`${job.id}.png`, `${job.id}-2.png`])
    expect(getJob(job.id)?.screenshotPaths).toEqual(result.screenshotPaths)
  })

  it('does not add a screenshot slot when navigation leaves the same page visible', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/blocked-next' })
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: false, autoPressButtons: true })
    retainableDomPage(`
      <label for="email">Email</label><input id="email" name="email">
      <button type="button">Next</button>
    `)

    const first = await runInspectTask(job.id)
    expect(first.status).toBe('inspected')
    if (first.status !== 'inspected') return
    await runFillTask(job.id, [{ fieldId: first.fields[0]!.fieldId, value: 'jane@example.com' }])
    await runClickButtonTask(job.id, first.buttons[0]!.buttonId)
    await runInspectTask(job.id)
    const result = await runFillTask(job.id, [], true)

    expect(result).toMatchObject({ status: 'filled' })
    if (result.status !== 'filled') return
    expect(result.screenshotPaths).toHaveLength(1)
  })

  it('keeps an asserted final step Queued when any requested answer is skipped', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job-skipped' })
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: false, autoPressButtons: false })
    retainablePage([
      { fieldId: 'field-email', selector: '#email', label: 'Email', control: 'input', required: true, currentValue: '' }
    ])
    await runInspectTask(job.id)

    const result = await runFillTask(job.id, [
      { fieldId: 'field-email', value: 'jane@example.com' },
      { fieldId: 'stale-field', value: 'missing' }
    ], true)

    expect(result).toMatchObject({ status: 'partially_filled', skippedFields: [expect.stringContaining('field not found')] })
    expect(getJob(job.id)?.status).toBe('queued')
  })

  it('reports only the permissions that the user denied', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: false, autoPressButtons: false })
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

describe('resume attachment', () => {
  function resumeFormPage(): { setInputFiles: ReturnType<typeof vi.fn> } {
    const setInputFiles = vi.fn().mockResolvedValue(undefined)
    const page = retainablePage([
      { fieldId: 'field-resume', selector: '#resume', label: 'Resume', control: 'file', required: true, currentValue: '' }
    ])
    page.evaluate.mockResolvedValue([
      { fieldId: 'field-resume', selector: '#resume', label: 'Resume', control: 'file', required: true, currentValue: '' }
    ])
    const locator = vi.fn().mockImplementation(() => ({ fill: vi.fn(), setInputFiles }))
    ;(page as unknown as { locator: unknown }).locator = locator
    return { setInputFiles }
  }

  beforeEach(() => {
    setStorageMode('plaintext')
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: true, autoPressButtons: false })
  })

  it('attaches a rendered tailored resume under a human-readable name and cleans it up', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'compact' })
    assignVariant(job.id, saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT, templateId: 'modern' }).id)
    renderMocks.renderResumePdf.mockResolvedValue(Buffer.from('%PDF-1.4 tailored'))
    const { setInputFiles } = resumeFormPage()

    const inspected = await runInspectTask(job.id)
    expect(inspected).toMatchObject({
      status: 'inspected',
      storedDocuments: [{ kind: 'resume', filename: 'Alex Morgan - Resume.pdf', source: 'variant' }]
    })

    let attachedPath = ''
    let existedWhenAttached = false
    setInputFiles.mockImplementation(async (path: string) => {
      attachedPath = path
      existedWhenAttached = existsSync(path)
    })
    const result = await runFillTask(job.id, [{ fieldId: 'field-resume', value: 'resume' }])

    expect(result).toMatchObject({ status: 'partially_filled', filledFields: ['Resume'], skippedFields: [] })
    expect(renderMocks.renderResumePdf).toHaveBeenCalledWith(SAMPLE_RESUME_CONTENT, 'modern', 'letter', {})
    expect(attachedPath.split(/[\\/]/).pop()).toBe('Alex Morgan - Resume.pdf')
    expect(existedWhenAttached).toBe(true)
    expect(existsSync(attachedPath)).toBe(false)
    expect(listActivity({ jobId: job.id }).entries.some((entry) => entry.message === 'Attached the tailored resume')).toBe(true)
  })

  it('falls back to the master only when that is the chosen fallback', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT, templateId: 'classic', pageSize: 'a4' })
    renderMocks.renderResumePdf.mockResolvedValue(Buffer.from('%PDF-1.4 master'))
    const { setInputFiles } = resumeFormPage()

    await runInspectTask(job.id)
    // Default fallback is the original upload, and nothing was uploaded.
    await expect(runFillTask(job.id, [{ fieldId: 'field-resume', value: 'resume' }])).resolves.toMatchObject({
      status: 'failed',
      message: expect.stringContaining('Skipped: Resume (value must name an available stored document')
    })
    expect(renderMocks.renderResumePdf).not.toHaveBeenCalled()

    setResumeSettings({ fallbackAttachment: 'master', autoTailor: false })
    await expect(runInspectTask(job.id)).resolves.toMatchObject({
      storedDocuments: [{ kind: 'resume', source: 'master' }]
    })
    await expect(runFillTask(job.id, [{ fieldId: 'field-resume', value: 'resume' }])).resolves.toMatchObject({
      filledFields: ['Resume']
    })
    expect(renderMocks.renderResumePdf).toHaveBeenCalledWith(SAMPLE_RESUME_CONTENT, 'classic', 'a4', {})
    expect(setInputFiles).toHaveBeenCalledTimes(1)
  })

  it('reports a render failure on the field instead of attaching something else', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    assignVariant(job.id, saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT }).id)
    renderMocks.renderResumePdf.mockRejectedValue(new Error('browser download was declined'))
    const { setInputFiles } = resumeFormPage()

    await runInspectTask(job.id)
    const result = await runFillTask(job.id, [{ fieldId: 'field-resume', value: 'resume' }])

    expect(result).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('Skipped: Resume (tailored resume could not be rendered: Error: browser download was declined)')
    })
    expect(setInputFiles).not.toHaveBeenCalled()
    expect(listActivity({ jobId: job.id, level: 'warn' }).entries.some((entry) => entry.message.includes('could not be rendered'))).toBe(true)
  })

  it('does not record an attachment when the upload itself fails', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    assignVariant(job.id, saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT }).id)
    renderMocks.renderResumePdf.mockResolvedValue(Buffer.from('%PDF-1.4 tailored'))
    const { setInputFiles } = resumeFormPage()
    setInputFiles.mockRejectedValue(new Error('input detached'))

    await runInspectTask(job.id)
    const result = await runFillTask(job.id, [{ fieldId: 'field-resume', value: 'resume' }])

    expect(result).toMatchObject({ status: 'failed', message: expect.stringContaining('Skipped: Resume') })
    expect(setInputFiles).toHaveBeenCalledTimes(1)
    expect(listActivity({ jobId: job.id }).entries.some((entry) => entry.message === 'Attached the tailored resume')).toBe(false)
  })

  it('does not record an attachment for a stale field id', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    assignVariant(job.id, saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT }).id)
    renderMocks.renderResumePdf.mockResolvedValue(Buffer.from('%PDF-1.4 tailored'))
    const { setInputFiles } = resumeFormPage()

    await runInspectTask(job.id)
    const result = await runFillTask(job.id, [{ fieldId: 'field-gone', value: 'resume' }])

    expect(result).toMatchObject({ status: 'failed', message: expect.stringContaining('field not found') })
    expect(setInputFiles).not.toHaveBeenCalled()
    expect(listActivity({ jobId: job.id }).entries.some((entry) => entry.message === 'Attached the tailored resume')).toBe(false)
  })

  it('does not render for a text answer that merely says resume', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    assignVariant(job.id, saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT }).id)
    retainablePage([
      { fieldId: 'field-source', selector: '#source', label: 'How did you hear about us', control: 'input', required: false, currentValue: '' }
    ])
    await runInspectTask(job.id)
    await expect(runFillTask(job.id, [{ fieldId: 'field-source', value: 'resume' }])).resolves.toMatchObject({
      filledFields: ['How did you hear about us']
    })
    expect(renderMocks.renderResumePdf).not.toHaveBeenCalled()
  })

  it('does not render when no answer names the resume', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    assignVariant(job.id, saveVariant({ name: 'Backend', content: SAMPLE_RESUME_CONTENT }).id)
    retainablePage([
      { fieldId: 'field-email', selector: '#email', label: 'Email', control: 'input', required: true, currentValue: '' }
    ])
    await runInspectTask(job.id)
    await runFillTask(job.id, [{ fieldId: 'field-email', value: 'jane@example.com' }])
    expect(renderMocks.renderResumePdf).not.toHaveBeenCalled()
  })
})

describe('runClickButtonTask', () => {
  it('requires a retained inspected application window', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })

    await expect(runClickButtonTask(job.id, 'applyer-button-next')).resolves.toEqual({
      status: 'no_active_session',
      jobId: job.id,
      message: 'No inspected application window is open. Call inspect_application first.'
    })
  })

  it('refuses to navigate a submitted job', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/job' })
    setFilled(job.id)
    setSubmitted(job.id)

    const result = await runClickButtonTask(job.id, 'applyer-button-next')

    expect(result).toMatchObject({ status: 'failed', jobId: job.id, message: expect.stringContaining('submitted') })
  })

  it('requires user permission before pressing a retained application button', async () => {
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/button-permission' })
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: false, autoPressButtons: false })
    const page = retainablePage([])
    page.evaluate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ buttonId: 'applyer-button-next', label: 'Next', selector: '[data-applyer-button]' }])
      .mockResolvedValueOnce([{ buttonId: 'applyer-button-next', label: 'Next', selector: '[data-applyer-button]' }])
      .mockResolvedValue(undefined)
    await runInspectTask(job.id)
    browserMocks.requestAgentPermissions.mockResolvedValue('deny')

    const result = await runClickButtonTask(job.id, 'applyer-button-next')

    expect(browserMocks.requestAgentPermissions).toHaveBeenCalledWith(expect.objectContaining({
      permissions: ['autoPressButtons']
    }))
    expect(result).toMatchObject({ status: 'permission_denied', requiredPermissions: ['autoPressButtons'] })
  })
})
