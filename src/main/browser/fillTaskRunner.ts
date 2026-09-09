import { randomUUID } from 'crypto'
import { writeFileSync, unlinkSync } from 'fs'
import { join, extname } from 'path'
import type { Browser, BrowserContext, Page } from 'playwright'
import { clearBlocking, getJob, refreshFilled, setBlocking, setFilled } from '../db/repositories/jobsRepository'
import { listDocuments, readDocumentBytes } from '../db/repositories/documentsRepository'
import { launchHeadedContext } from './browserController'
import { detectCaptcha } from './captchaDetector'
import {
  fillForm,
  inspectAnswerRequirements,
  inspectApplicationFields,
  type ApplicationField,
  type ApplicationFieldAnswer
} from './formFiller'
import { openGate, resumeGate, isGateOpen, type GateOutcome } from './captchaGate'
import { failJob } from '../jobActions'
import { broadcastJobUpdate, broadcastCaptchaDetected, broadcastCaptchaResolved } from '../ipc/jobsBroadcast'
import { screenshotsDir, tempDir } from '../config/paths'
import { withStorageWriteLock } from '../storageWriteLock'
import { mcpLogger } from '../logger'
import { isNavigableUrl } from '@shared/url'
import type { AgentPermission, AgentPermissions } from '@shared/types/agentPermissions'
import { getAgentPermissions, getStorageMode } from '../db/repositories/settingsRepository'
import { writeSecureFileBuffer } from '../db/encryption'
import { allowRequestedPermissions, requestAgentPermissions } from './agentPermissionGate'

export type FillTaskResult =
  | { status: 'filled'; jobId: string; screenshotPath: string; filledFields: string[]; skippedFields: string[] }
  | { status: 'no_active_session'; jobId: string; message: string }
  | { status: 'permission_denied'; jobId: string; requiredPermissions: Array<keyof AgentPermissions>; message: string }
  | { status: 'failed'; jobId: string; reasonTag: string; message: string }

export type EditTaskResult =
  | { status: 'edited'; jobId: string; screenshotPath: string; filledFields: string[]; skippedFields: string[] }
  | { status: 'no_active_session'; jobId: string; message: string }
  | { status: 'permission_denied'; jobId: string; requiredPermissions: Array<keyof AgentPermissions>; message: string }
  | { status: 'failed'; jobId: string; reasonTag: string; message: string }

export type InspectTaskResult =
  | {
      status: 'inspected'
      jobId: string
      mode: 'fill' | 'edit'
      fields: ApplicationField[]
      storedDocuments: Array<{ kind: 'resume' | 'cover_letter'; filename: string }>
      message: string
    }
  | { status: 'paused_captcha'; jobId: string; taskId: string; message: string }
  | { status: 'no_active_session'; jobId: string; message: string }
  | { status: 'failed'; jobId: string; reasonTag: string; message: string }

interface ApplicationSession {
  browser: Browser
  page: Page
}

const activeApplicationSessions = new Map<string, ApplicationSession>()

function retainApplicationSession(jobId: string, browser: Browser, page: Page): void {
  const previous = activeApplicationSessions.get(jobId)
  if (previous && previous.page !== page) void previous.browser.close().catch(() => {})
  const session = { browser, page }
  activeApplicationSessions.set(jobId, session)
  const discard = (): void => {
    if (activeApplicationSessions.get(jobId) === session) activeApplicationSessions.delete(jobId)
  }
  page.once('close', discard)
  browser.once('disconnected', discard)
}

function getActiveSession(jobId: string): ApplicationSession | null {
  const session = activeApplicationSessions.get(jobId)
  if (!session || !session.browser.isConnected() || session.page.isClosed()) {
    activeApplicationSessions.delete(jobId)
    return null
  }
  return session
}

function extensionFor(originalFilename: string): string {
  return extname(originalFilename) || '.bin'
}

function materializeDocument(kind: 'resume' | 'cover_letter'): string | undefined {
  const doc = listDocuments().find((candidate) => candidate.kind === kind)
  if (!doc) return undefined
  const bytes = readDocumentBytes(doc.id)
  if (!bytes) return undefined
  const path = join(tempDir(), `${randomUUID()}${extensionFor(doc.originalFilename)}`)
  writeFileSync(path, bytes, { mode: 0o600 })
  return path
}

function safeUnlink(path: string | undefined): void {
  if (!path) return
  try {
    unlinkSync(path)
  } catch {
    // Best-effort cleanup of a short-lived decrypted document.
  }
}

async function captureScreenshot(page: Page, jobId: string): Promise<string> {
  const path = join(screenshotsDir(), `${jobId}.png`)
  const image = await page.screenshot().catch(() => null)
  if (image) {
    const mode = getStorageMode() ?? 'encrypted'
    writeFileSync(path, writeSecureFileBuffer(image, mode), { mode: 0o600 })
  }
  return path
}

function failAndReturn(jobId: string, reasonTag: string, message: string): InspectTaskResult {
  failJob(jobId, reasonTag, message)
  return { status: 'failed', jobId, reasonTag, message }
}

async function waitForCaptchaResolution(taskId: string, jobId: string, page: Page): Promise<GateOutcome> {
  const stopSignal = { stopped: false }
  const pollPromise: Promise<GateOutcome> = (async () => {
    while (!stopSignal.stopped) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      if (!stopSignal.stopped && !(await detectCaptcha(page).catch(() => ({ blocked: true }) as const)).blocked) return 'resolved' as const
    }
    return 'resolved' as const
  })()
  const outcome = await Promise.race([openGate(taskId, jobId, page), pollPromise])
  stopSignal.stopped = true
  if (isGateOpen(taskId)) resumeGate(taskId)
  return outcome
}

async function continueInspectionAfterCaptcha(
  taskId: string,
  jobId: string,
  page: Page,
  browser: Browser
): Promise<void> {
  const outcome = await waitForCaptchaResolution(taskId, jobId, page)
  if (outcome === 'cancelled') {
    await browser.close().catch(() => {})
    failJob(jobId, 'captcha_verification', 'The verification challenge was not resolved in time (or was cancelled).')
    return
  }
  clearBlocking(jobId)
  const updated = getJob(jobId)
  if (updated) broadcastJobUpdate(updated)
  broadcastCaptchaResolved({ taskId, jobId })
}

async function inspectSession(jobId: string, page: Page): Promise<InspectTaskResult> {
  const job = getJob(jobId)
  if (!job) return { status: 'failed', jobId, reasonTag: 'other', message: 'Job not found.' }
  try {
    await page.bringToFront()
    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return {
        status: 'failed',
        jobId,
        reasonTag: 'captcha_verification',
        message: 'Resolve the verification challenge in the open application window, then inspect the form again.'
      }
    }
    const fields = await inspectApplicationFields(page)
    const storedDocuments = listDocuments().filter(
      (document): document is typeof document & { kind: 'resume' | 'cover_letter' } =>
        document.kind === 'resume' || document.kind === 'cover_letter'
    ).map((document) => ({
      kind: document.kind,
      filename: document.originalFilename
    }))
    return {
      status: 'inspected',
      jobId,
      mode: job.status === 'filled' ? 'edit' : 'fill',
      fields,
      storedDocuments,
      message:
        job.status === 'filled'
          ? 'Use edit_application with fieldId/value pairs from this result. Labels are context only. Attachments cannot be changed while editing.'
          : 'Use fill_application with fieldId/value pairs from this result. Labels are context only. For a file field, use resume or cover_letter only when that stored document is listed.'
    }
  } catch (error) {
    return { status: 'failed', jobId, reasonTag: 'other', message: `Could not inspect the open application form: ${String(error)}` }
  }
}

/** Opens a queued application once, or re-inspects its retained live form. */
export async function runInspectTask(jobId: string): Promise<InspectTaskResult> {
  const job = getJob(jobId)
  if (!job) return { status: 'failed', jobId, reasonTag: 'other', message: 'Job not found.' }
  if (job.status !== 'queued' && job.status !== 'filled') {
    return { status: 'failed', jobId, reasonTag: 'other', message: `A ${job.status} job cannot be inspected for filling.` }
  }

  const retained = getActiveSession(jobId)
  if (retained) return inspectSession(jobId, retained.page)
  if (job.status === 'filled') {
    return {
      status: 'no_active_session',
      jobId,
      message: 'The original application window is no longer open. Open the job yourself and make changes there.'
    }
  }

  const targetUrl = job.applicationUrl || job.url
  if (!isNavigableUrl(targetUrl)) {
    return failAndReturn(jobId, 'form_not_supported', `This job's application link is not an http(s) URL, so it cannot be opened: ${targetUrl}`)
  }

  let browser: Browser
  let context: BrowserContext
  try {
    const headed = await launchHeadedContext()
    browser = headed.browser
    context = headed.context
  } catch (error) {
    return failAndReturn(jobId, 'browser_unavailable', `Couldn't prepare a browser: ${String(error)}`)
  }

  let page: Page
  try {
    page = await context.newPage()
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1500)
    retainApplicationSession(jobId, browser, page)
  } catch (error) {
    await browser.close().catch(() => {})
    return failAndReturn(jobId, 'form_not_supported', `Failed to open the application page: ${String(error)}`)
  }

  const captcha = await detectCaptcha(page)
  if (captcha.blocked) {
    const taskId = randomUUID()
    setBlocking(jobId, captcha.reason ?? 'captcha_verification', taskId)
    const updated = getJob(jobId)
    if (updated) broadcastJobUpdate(updated)
    broadcastCaptchaDetected({ taskId, jobId, jobTitle: job.title, company: job.company })
    await page.bringToFront().catch(() => {})
    continueInspectionAfterCaptcha(taskId, jobId, page, browser).catch((error) => {
      mcpLogger.error(`Application inspection continuation crashed: ${String(error)}`)
    })
    return {
      status: 'paused_captcha',
      jobId,
      taskId,
      message: 'Resolve the verification challenge in the visible window, then call inspect_application again.'
    }
  }
  return inspectSession(jobId, page)
}

async function authorizeAnswers(
  jobId: string,
  jobTitle: string,
  company: string,
  page: Page,
  answers: ApplicationFieldAnswer[],
  includeDocuments: boolean
): Promise<
  | { status: 'allowed'; permissions: AgentPermissions }
  | { status: 'denied'; deniedPermissions: AgentPermission[] }
> {
  const storedPermissions = getAgentPermissions()
  const fields = await inspectApplicationFields(page)
  const required = inspectAnswerRequirements(fields, answers, includeDocuments)
  const disabled = required.filter((permission) => !storedPermissions[permission])
  if (disabled.length === 0) return { status: 'allowed', permissions: storedPermissions }
  const decision = await requestAgentPermissions({ jobId, jobTitle, company, permissions: disabled })
  return decision === 'deny'
    ? { status: 'denied', deniedPermissions: disabled }
    : { status: 'allowed', permissions: allowRequestedPermissions(storedPermissions, disabled) }
}

async function applyAnswers(
  jobId: string,
  page: Page,
  answers: ApplicationFieldAnswer[],
  permissions: AgentPermissions,
  edit: boolean
): Promise<FillTaskResult | EditTaskResult> {
  let resumePath: string | undefined
  let coverLetterPath: string | undefined
  try {
    if (!edit && permissions.autoUploadDocuments) {
      resumePath = materializeDocument('resume')
      coverLetterPath = materializeDocument('cover_letter')
    }
    const result = await fillForm(page, answers, {
      allowFieldCompletion: permissions.autoCompleteFields,
      allowDocumentUploads: !edit && permissions.autoUploadDocuments,
      updateDocuments: !edit,
      resumeFilePath: resumePath,
      coverLetterFilePath: coverLetterPath
    })
    if (result.requiredPermissions.length > 0) {
      return {
        status: 'permission_denied',
        jobId,
        requiredPermissions: result.requiredPermissions,
        message: 'The live form changed after permission approval. Inspect it again before retrying.'
      }
    }
    if (result.filledFields.length === 0) {
      return {
        status: 'failed',
        jobId,
        reasonTag: 'form_not_supported',
        message: 'No supplied field was changed. Inspect the live form again and use its current field IDs and option values.'
      }
    }
    const { screenshotPath, job } = await withStorageWriteLock(async () => {
      const capturedPath = await captureScreenshot(page, jobId)
      const updated = edit
        ? refreshFilled(jobId, { screenshotPath: capturedPath })
        : setFilled(jobId, { screenshotPath: capturedPath })
      return { screenshotPath: capturedPath, job: updated }
    })
    broadcastJobUpdate(job)
    return {
      status: edit ? 'edited' : 'filled',
      jobId,
      screenshotPath,
      filledFields: result.filledFields,
      skippedFields: result.skippedFields
    }
  } catch (error) {
    return {
      status: 'failed',
      jobId,
      reasonTag: 'other',
      message: `${edit ? 'Failed while editing' : 'Failed while filling'} the open form: ${String(error)}`
    }
  } finally {
    safeUnlink(resumePath)
    safeUnlink(coverLetterPath)
  }
}

async function runAnswerTask(jobId: string, answers: ApplicationFieldAnswer[], edit: boolean): Promise<FillTaskResult | EditTaskResult> {
  const job = getJob(jobId)
  if (!job) return { status: 'failed', jobId, reasonTag: 'other', message: 'Job not found.' }
  const expected = edit ? 'filled' : 'queued'
  if (job.status !== expected) {
    return { status: 'failed', jobId, reasonTag: 'other', message: `Job is not in the ${edit ? 'Filled' : 'Queued'} state (currently: ${job.status}).` }
  }
  const session = getActiveSession(jobId)
  if (!session) {
    return {
      status: 'no_active_session',
      jobId,
      message: edit
        ? 'The original application window is no longer open. Open the job yourself and make changes there.'
        : 'No inspected application window is open. Call inspect_application first.'
    }
  }
  try {
    await session.page.bringToFront()
    if ((await detectCaptcha(session.page)).blocked) {
      return {
        status: 'failed',
        jobId,
        reasonTag: 'captcha_verification',
        message: 'Resolve the verification challenge in the open application window, then inspect it again.'
      }
    }
    const authorization = await authorizeAnswers(jobId, job.title, job.company, session.page, answers, !edit)
    if (authorization.status === 'denied') {
      return {
        status: 'permission_denied',
        jobId,
        requiredPermissions: authorization.deniedPermissions,
        message: `The user denied this permission request or it timed out. The open form was not changed and the job remains ${edit ? 'Filled' : 'Queued'}.`
      }
    }
    return applyAnswers(jobId, session.page, answers, authorization.permissions, edit)
  } catch (error) {
    return { status: 'failed', jobId, reasonTag: 'other', message: `Could not access the open application form: ${String(error)}` }
  }
}

export async function runFillTask(jobId: string, answers: ApplicationFieldAnswer[]): Promise<FillTaskResult> {
  return runAnswerTask(jobId, answers, false) as Promise<FillTaskResult>
}

/** Updates only supplied field IDs in the original visible form and never uploads documents. */
export async function runEditTask(jobId: string, answers: ApplicationFieldAnswer[]): Promise<EditTaskResult> {
  return runAnswerTask(jobId, answers, true) as Promise<EditTaskResult>
}
