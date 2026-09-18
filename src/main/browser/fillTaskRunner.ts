import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import type { Page } from 'playwright'
import { clearBlocking, getJob, refreshFilled, setBlocking, setFilled } from '../db/repositories/jobsRepository'
import { listDocuments, readDocumentBytes } from '../db/repositories/documentsRepository'
import { openHeadedBrowser, type HeadedBrowser } from './browserController'
import { renderResumePdf, resolveResumeAttachment, resumeFileName } from './resumeRenderer'
import { removeFile, removeMaterializedDocument } from './attachmentCleanup'
import { logActivity } from '../db/repositories/activityLogRepository'
import { detectCaptcha } from './captchaDetector'
import {
  clickApplicationButton,
  fillForm,
  inspectAnswerRequirements,
  inspectApplicationButtons,
  inspectApplicationFields,
  type ApplicationButton,
  type ApplicationField,
  type ApplicationFieldAnswer
} from './formFiller'
import { openGate, resumeGate, isGateOpen, type GateOutcome } from './captchaGate'
import { failJob } from '../jobActions'
import { recordRunEvent } from '../runs/runTracker'
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
  | { status: 'filled'; jobId: string; screenshotPath: string; screenshotPaths: string[]; filledFields: string[]; skippedFields: string[] }
  | {
      status: 'partially_filled'
      jobId: string
      screenshotPath: string
      screenshotPaths: string[]
      filledFields: string[]
      skippedFields: string[]
      message: string
    }
  | { status: 'no_active_session'; jobId: string; message: string }
  | { status: 'permission_denied'; jobId: string; requiredPermissions: Array<keyof AgentPermissions>; message: string }
  | { status: 'failed'; jobId: string; reasonTag: string; message: string }

export type EditTaskResult =
  | { status: 'edited'; jobId: string; screenshotPath: string; screenshotPaths: string[]; filledFields: string[]; skippedFields: string[] }
  | { status: 'no_active_session'; jobId: string; message: string }
  | { status: 'permission_denied'; jobId: string; requiredPermissions: Array<keyof AgentPermissions>; message: string }
  | { status: 'failed'; jobId: string; reasonTag: string; message: string }

export type InspectTaskResult =
  | {
      status: 'inspected'
      jobId: string
      mode: 'fill' | 'edit'
      fields: ApplicationField[]
      buttons: ApplicationButton[]
      /** `source` says which resume the `resume` file value attaches: the job's assigned variant, the master, or (absent) the upload. */
      storedDocuments: Array<{ kind: 'resume' | 'cover_letter'; filename: string; source?: 'variant' | 'master' }>
      message: string
    }
  | { status: 'paused_captcha'; jobId: string; taskId: string; message: string }
  | { status: 'no_active_session'; jobId: string; message: string }
  | { status: 'failed'; jobId: string; reasonTag: string; message: string }

export type ClickButtonTaskResult =
  | { status: 'clicked'; jobId: string; button: ApplicationButton; message: string }
  | { status: 'no_active_session'; jobId: string; message: string }
  | { status: 'permission_denied'; jobId: string; requiredPermissions: ['autoPressButtons']; message: string }
  | { status: 'failed'; jobId: string; reasonTag: string; message: string }

interface ApplicationSession {
  headed: HeadedBrowser
  page: Page
  /** Remains fill while the agent advances through the initially opened form. */
  phase: 'fill' | 'edit'
  currentStepIndex: number
  stepFingerprints: string[]
  screenshotPaths: string[]
  obsoleteScreenshotPaths: string[]
  pendingNavigation?: { direction: 'forward' | 'back'; fromFingerprint: string }
}

const activeApplicationSessions = new Map<string, ApplicationSession>()

function retainApplicationSession(jobId: string, headed: HeadedBrowser, page: Page): void {
  const previous = activeApplicationSessions.get(jobId)
  if (previous && previous.page !== page) void previous.headed.close(previous.page)
  const session: ApplicationSession = {
    headed,
    page,
    phase: 'fill',
    currentStepIndex: 0,
    stepFingerprints: [],
    screenshotPaths: [],
    obsoleteScreenshotPaths: []
  }
  activeApplicationSessions.set(jobId, session)
  const discard = (): void => {
    if (activeApplicationSessions.get(jobId) === session) activeApplicationSessions.delete(jobId)
    // The attached browser's connection outlives every session, so a listener left on it
    // per finished job would pile up for the whole run.
    headed.browser.off('disconnected', discard)
  }
  page.once('close', discard)
  headed.browser.on('disconnected', discard)
}

function getActiveSession(jobId: string): ApplicationSession | null {
  const session = activeApplicationSessions.get(jobId)
  if (!session || !session.headed.browser.isConnected() || session.page.isClosed()) {
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

/**
 * The resume a job gets, as a file Playwright can hand to a file input.
 *
 * A tailored variant (or the master, when that is the chosen fallback) is
 * rendered fresh into its own temp directory so the file can carry a
 * human-looking name: the form shows the basename, and so does the ATS to
 * whoever opens the application. Rendering needs the headless browser; when
 * it fails the field is left alone and the failure reported, never silently
 * downgraded to the original upload, since attaching the wrong resume is
 * worse than a skipped field the agent can retry.
 *
 * The "attached" activity entry is not written here: rendering a file is not
 * attaching it, and the form can still refuse the upload. The caller logs it
 * once `fillForm` reports the resume was actually handed to the input.
 */
interface MaterializedResume {
  path?: string
  failure?: string
  /** What the rendered file is, for the activity entry written once it is attached. */
  rendered?: { kind: 'variant' | 'master'; templateId: string; stale: boolean }
}

async function materializeResume(jobId: string): Promise<MaterializedResume> {
  let plan
  try {
    plan = resolveResumeAttachment(jobId)
  } catch (error) {
    logActivity('warn', 'Stored resume could not be read for attachment', { jobId, error: String(error) })
    return { failure: `stored resume could not be read: ${String(error)}` }
  }
  if (plan.kind === 'original') return { path: materializeDocument('resume') }
  try {
    const bytes = await renderResumePdf(plan.content, plan.templateId, plan.pageSize, plan.style)
    const dir = join(tempDir(), randomUUID())
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, resumeFileName(plan.content))
    writeFileSync(path, bytes, { mode: 0o600 })
    return {
      path,
      rendered: { kind: plan.kind, templateId: plan.templateId, stale: plan.kind === 'variant' && plan.stale }
    }
  } catch (error) {
    logActivity('warn', `${plan.kind === 'variant' ? 'Tailored' : 'Master'} resume could not be rendered`, {
      jobId,
      error: String(error)
    })
    return { failure: `${plan.kind === 'variant' ? 'tailored' : 'master'} resume could not be rendered: ${String(error)}` }
  }
}

function logResumeAttached(jobId: string, rendered: NonNullable<MaterializedResume['rendered']>): void {
  logActivity('info', rendered.kind === 'variant' ? 'Attached the tailored resume' : 'Attached the master resume', {
    jobId,
    templateId: rendered.templateId,
    ...(rendered.stale ? { stale: true } : {})
  })
  recordRunEvent('resume_attached', { jobId, meta: { kind: rendered.kind, templateId: rendered.templateId, stale: rendered.stale } })
}

function screenshotPathFor(jobId: string, stepIndex: number): string {
  return join(screenshotsDir(), stepIndex === 0 ? `${jobId}.png` : `${jobId}-${stepIndex + 1}.png`)
}

async function captureScreenshot(page: Page, jobId: string, session: ApplicationSession): Promise<string> {
  const path = screenshotPathFor(jobId, session.currentStepIndex)
  const image = await page.screenshot().catch(() => null)
  if (image) {
    const mode = getStorageMode() ?? 'encrypted'
    writeFileSync(path, writeSecureFileBuffer(image, mode), { mode: 0o600 })
  }
  session.screenshotPaths[session.currentStepIndex] = path
  return path
}

function stepFingerprint(fields: ApplicationField[], buttons: ApplicationButton[]): string {
  return JSON.stringify({
    fields: fields.map(({ label, name, placeholder, autocomplete, control, inputType, options }) => ({
      label,
      name,
      placeholder,
      autocomplete,
      control,
      inputType,
      options
    })),
    buttons: buttons.map(({ label }) => label)
  })
}

function recordInspectedStep(session: ApplicationSession, fingerprint: string): void {
  const pending = session.pendingNavigation
  delete session.pendingNavigation

  if (pending && fingerprint !== pending.fromFingerprint) {
    const knownIndex = session.stepFingerprints.indexOf(fingerprint)
    if (knownIndex >= 0) {
      session.currentStepIndex = knownIndex
    } else {
      const nextIndex = pending.direction === 'forward'
        ? session.currentStepIndex + 1
        : Math.max(0, session.currentStepIndex - 1)
      if (pending.direction === 'forward') {
        session.obsoleteScreenshotPaths.push(...session.screenshotPaths.splice(nextIndex))
        session.stepFingerprints.splice(nextIndex)
      }
      session.currentStepIndex = nextIndex
    }
  }

  session.stepFingerprints[session.currentStepIndex] = fingerprint
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
  headed: HeadedBrowser
): Promise<void> {
  const outcome = await waitForCaptchaResolution(taskId, jobId, page)
  if (outcome === 'cancelled') {
    await headed.close(page)
    failJob(jobId, 'captcha_verification', 'The verification challenge was not resolved in time (or was cancelled).')
    return
  }
  clearBlocking(jobId)
  const updated = getJob(jobId)
  if (updated) broadcastJobUpdate(updated)
  broadcastCaptchaResolved({ taskId, jobId })
  recordRunEvent('captcha_resolved', { source: updated?.source ?? null, jobId })
}

async function inspectSession(jobId: string, page: Page): Promise<InspectTaskResult> {
  const job = getJob(jobId)
  if (!job) return { status: 'failed', jobId, reasonTag: 'other', message: 'Job not found.' }
  const mode = activeApplicationSessions.get(jobId)?.phase ?? (job.status === 'filled' ? 'edit' : 'fill')
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
    const [fields, buttons] = await Promise.all([
      inspectApplicationFields(page),
      inspectApplicationButtons(page)
    ])
    const session = activeApplicationSessions.get(jobId)
    if (session?.page === page) recordInspectedStep(session, stepFingerprint(fields, buttons))
    const storedDocuments = listDocuments().filter(
      (document): document is typeof document & { kind: 'resume' | 'cover_letter' } =>
        document.kind === 'resume' || document.kind === 'cover_letter'
    ).map((document) => ({
      kind: document.kind,
      filename: document.originalFilename
    }))
    // A tailored or master resume is attached in place of the upload, and it
    // exists even when nothing was ever uploaded, so list it as the resume
    // the agent may name. A corrupt stored resume is reported at fill time.
    try {
      const plan = resolveResumeAttachment(jobId)
      if (plan.kind !== 'original') {
        const rendered = { kind: 'resume' as const, filename: resumeFileName(plan.content), source: plan.kind }
        const uploadIndex = storedDocuments.findIndex((document) => document.kind === 'resume')
        if (uploadIndex >= 0) storedDocuments.splice(uploadIndex, 1, rendered)
        else storedDocuments.unshift(rendered)
      }
    } catch (error) {
      logActivity('warn', 'Stored resume could not be read while inspecting a form', { jobId, error: String(error) })
    }
    return {
      status: 'inspected',
      jobId,
      mode,
      fields,
      buttons,
      storedDocuments,
      message:
        mode === 'edit'
          ? 'Use edit_application with fieldId/value pairs from this visible step. If the field to edit is on an earlier step, click a listed Back or Previous button with click_application_button, then inspect again; repeat until the field is visible. Submit controls are never listed. Labels are context only. Attachments cannot be changed while editing.'
          : 'Use fill_application with fieldId/value pairs from this visible step. Leave finalStep false while more application pages remain; set it true only when every page is complete and the form is ready for user review. To correct an answer already on this step, edit_application changes it without touching attachments or the final step. Use click_application_button with a buttonId to navigate, then inspect again. Submit controls are never listed. Labels are context only. For a file field, use resume or cover_letter only when that stored document is listed.'
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

  let headed: HeadedBrowser
  try {
    headed = await openHeadedBrowser()
  } catch (error) {
    return failAndReturn(jobId, 'browser_unavailable', `Couldn't prepare a browser: ${String(error)}`)
  }

  let page: Page | null = null
  try {
    page = await headed.newPage()
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1500)
    retainApplicationSession(jobId, headed, page)
  } catch (error) {
    await headed.close(page)
    return failAndReturn(jobId, 'form_not_supported', `Failed to open the application page: ${String(error)}`)
  }

  const captcha = await detectCaptcha(page)
  if (captcha.blocked) {
    const taskId = randomUUID()
    setBlocking(jobId, captcha.reason ?? 'captcha_verification', taskId)
    const updated = getJob(jobId)
    if (updated) broadcastJobUpdate(updated)
    broadcastCaptchaDetected({ taskId, jobId, jobTitle: job.title, company: job.company })
    recordRunEvent('captcha_paused', { source: job.source, jobId, meta: { reason: captcha.reason ?? 'captcha_verification' } })
    await page.bringToFront().catch(() => {})
    continueInspectionAfterCaptcha(taskId, jobId, page, headed).catch((error) => {
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

/** Clicks an inspected intermediate-navigation button in the retained application window. */
export async function runClickButtonTask(jobId: string, buttonId: string): Promise<ClickButtonTaskResult> {
  const job = getJob(jobId)
  if (!job) return { status: 'failed', jobId, reasonTag: 'other', message: 'Job not found.' }
  if (job.status !== 'queued' && job.status !== 'filled') {
    return {
      status: 'failed',
      jobId,
      reasonTag: 'other',
      message: `A ${job.status} job cannot be navigated.`
    }
  }

  const session = getActiveSession(jobId)
  if (!session) {
    return {
      status: 'no_active_session',
      jobId,
      message: 'No inspected application window is open. Call inspect_application first.'
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
    let permissionDenied = false
    const button = await clickApplicationButton(
      session.page,
      buttonId,
      async () => {
        if (getAgentPermissions().autoPressButtons) return true
        const decision = await requestAgentPermissions({
          jobId,
          jobTitle: job.title,
          company: job.company,
          permissions: ['autoPressButtons']
        })
        permissionDenied = decision === 'deny'
        return !permissionDenied
      },
      async () => {
        await withStorageWriteLock(() => captureScreenshot(session.page, jobId, session))
      }
    ).catch((error) => {
      if (permissionDenied) return null
      throw error
    })
    if (!button) {
      return {
        status: 'permission_denied',
        jobId,
        requiredPermissions: ['autoPressButtons'],
        message: 'The user denied permission to press application buttons or the request timed out. The button was not clicked; inspect again before retrying.'
      }
    }
    await session.page.waitForTimeout(250)
    const fromFingerprint = session.stepFingerprints[session.currentStepIndex]
    if (fromFingerprint) {
      session.pendingNavigation = {
        direction: /^(?:back|go back|previous)\b/i.test(button.label.trim()) ? 'back' : 'forward',
        fromFingerprint
      }
    }
    return {
      status: 'clicked',
      jobId,
      button,
      message: 'The navigation button was clicked. Call inspect_application again before filling or clicking anything else.'
    }
  } catch (error) {
    return {
      status: 'failed',
      jobId,
      reasonTag: 'form_not_supported',
      message: `The button was not clicked: ${String(error)}`
    }
  }
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
  edit: boolean,
  finalStep: boolean
): Promise<FillTaskResult | EditTaskResult> {
  let resume: MaterializedResume | undefined
  let coverLetterPath: string | undefined
  // Rendered only if `fillForm` reaches a file control whose answer names the
  // resume: rendering spins up the headless browser, which a text answer
  // that happens to say "resume" must never trigger.
  const resumeFile = async (): Promise<{ path?: string; unavailableReason?: string }> => {
    resume = await materializeResume(jobId)
    return { path: resume.path, unavailableReason: resume.failure }
  }
  try {
    if (!edit && permissions.autoUploadDocuments) coverLetterPath = materializeDocument('cover_letter')
    const result = answers.length > 0
      ? await fillForm(page, answers, {
          allowFieldCompletion: permissions.autoCompleteFields,
          allowDocumentUploads: !edit && permissions.autoUploadDocuments,
          updateDocuments: !edit,
          resumeFile: !edit && permissions.autoUploadDocuments ? resumeFile : undefined,
          coverLetterFilePath: coverLetterPath
        })
      : { filledFields: [], skippedFields: [], requiredPermissions: [], attachedDocuments: [] }
    if (resume?.rendered && result.attachedDocuments.includes('resume')) logResumeAttached(jobId, resume.rendered)
    if (result.requiredPermissions.length > 0) {
      return {
        status: 'permission_denied',
        jobId,
        requiredPermissions: result.requiredPermissions,
        message: 'The live form changed after permission approval. Inspect it again before retrying.'
      }
    }
    if (result.filledFields.length === 0 && !(finalStep && answers.length === 0)) {
      return {
        status: 'failed',
        jobId,
        reasonTag: 'form_not_supported',
        message:
          `No supplied field was changed.${result.skippedFields.length > 0 ? ` Skipped: ${result.skippedFields.join('; ')}.` : ''}` +
          ' Inspect the live form again and use its current field IDs and option values. If the target is on an earlier step, click a currently listed Back or Previous button, then re-inspect.'
      }
    }
    const completedFinalStep = !edit && finalStep && result.skippedFields.length === 0 &&
      result.filledFields.length === answers.length
    const { screenshotPath, screenshotPaths, job, settled } = await withStorageWriteLock(async () => {
      const session = activeApplicationSessions.get(jobId)
      if (!session || session.page !== page) throw new Error('The retained application session was lost.')
      const current = getJob(jobId)
      if (!current) throw new Error(`Job not found: ${jobId}`)
      const capturedPath = await captureScreenshot(page, jobId, session)
      const capturedPaths = session.screenshotPaths.filter((path): path is string => !!path)
      // "Settled": the form is in its reviewed state (a Filled job edited,
      // or a fill's final step completed), so the old screenshots go and
      // the session moves to edit mode. An edit to a still-Queued job is
      // neither: the fill goes on from where it was.
      const editingFilled = edit && current.status === 'filled'
      const settled = editingFilled || completedFinalStep
      const updated = editingFilled
        ? refreshFilled(jobId, { screenshotPath: capturedPath, screenshotPaths: capturedPaths })
        : completedFinalStep
          ? setFilled(jobId, { screenshotPath: capturedPath, screenshotPaths: capturedPaths })
          : current
      if (settled) {
        for (const obsoletePath of session.obsoleteScreenshotPaths) {
          if (!capturedPaths.includes(obsoletePath)) removeFile(obsoletePath)
        }
        session.obsoleteScreenshotPaths = []
      }
      return { screenshotPath: capturedPath, screenshotPaths: capturedPaths, job: updated, settled }
    })
    if (settled) {
      const session = activeApplicationSessions.get(jobId)
      if (session?.page === page) session.phase = 'edit'
    }
    broadcastJobUpdate(job)
    if (!edit && !completedFinalStep) {
      return {
        status: 'partially_filled',
        jobId,
        screenshotPath,
        screenshotPaths,
        filledFields: result.filledFields,
        skippedFields: result.skippedFields,
        message: finalStep
          ? 'The job remains Queued because at least one requested final answer was skipped. Inspect the form again and retry every skipped answer before setting finalStep to true.'
          : 'This page was filled and the job remains Queued. Navigate and inspect again, or set finalStep to true only when every application page is complete and the form is ready for user review.'
      }
    }
    return {
      status: edit ? 'edited' : 'filled',
      jobId,
      screenshotPath,
      screenshotPaths,
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
    removeMaterializedDocument(resume?.path)
    removeMaterializedDocument(coverLetterPath)
  }
}

async function runAnswerTask(
  jobId: string,
  answers: ApplicationFieldAnswer[],
  edit: boolean,
  finalStep = false
): Promise<FillTaskResult | EditTaskResult> {
  const job = getJob(jobId)
  if (!job) return { status: 'failed', jobId, reasonTag: 'other', message: 'Job not found.' }
  const session = getActiveSession(jobId)
  // Editing is allowed mid-fill too: a Queued job whose earlier answers
  // need correcting is edited in place, without the fill path's
  // attachment handling or its finalStep bookkeeping, and stays Queued.
  const editable = edit ? job.status === 'filled' || job.status === 'queued' : job.status === 'queued'
  if (!editable) {
    return {
      status: 'failed',
      jobId,
      reasonTag: 'other',
      message: `Job is not in the ${edit ? 'Queued or Filled' : 'Queued'} state (currently: ${job.status}).`
    }
  }
  if (!session) {
    return {
      status: 'no_active_session',
      jobId,
      message:
        job.status === 'filled'
          ? 'The original application window is no longer open. Open the job yourself and make changes there.'
          : 'No inspected application window is open. Call inspect_application first.'
    }
  }
  if (!edit && answers.length === 0 && !finalStep) {
    return {
      status: 'failed',
      jobId,
      reasonTag: 'form_not_supported',
      message: 'No answers were supplied. Use an empty answers list only with finalStep true on a fieldless final review page.'
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
        message: `The user denied this permission request or it timed out. The open form was not changed and the job remains ${job.status === 'filled' ? 'Filled' : 'Queued'}.`
      }
    }
    return applyAnswers(jobId, session.page, answers, authorization.permissions, edit, finalStep)
  } catch (error) {
    return { status: 'failed', jobId, reasonTag: 'other', message: `Could not access the open application form: ${String(error)}` }
  }
}

export async function runFillTask(
  jobId: string,
  answers: ApplicationFieldAnswer[],
  finalStep = false
): Promise<FillTaskResult> {
  return runAnswerTask(jobId, answers, false, finalStep) as Promise<FillTaskResult>
}

/** Updates only supplied field IDs in the original visible form and never uploads documents. */
export async function runEditTask(jobId: string, answers: ApplicationFieldAnswer[]): Promise<EditTaskResult> {
  return runAnswerTask(jobId, answers, true) as Promise<EditTaskResult>
}
