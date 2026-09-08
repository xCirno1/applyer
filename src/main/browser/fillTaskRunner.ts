import { randomUUID } from 'crypto'
import { writeFileSync, unlinkSync } from 'fs'
import { join, extname } from 'path'
import type { Browser, BrowserContext, Page } from 'playwright'
import { getJob, setFilled, setBlocking } from '../db/repositories/jobsRepository'
import { getProfile } from '../db/repositories/profileRepository'
import { listDocuments, readDocumentBytes } from '../db/repositories/documentsRepository'
import { launchHeadedContext } from './browserController'
import { detectCaptcha } from './captchaDetector'
import { fillForm, inspectFillRequirements } from './formFiller'
import { openGate, resumeGate, isGateOpen, type GateOutcome } from './captchaGate'
import { failJob } from '../jobActions'
import { broadcastJobUpdate, broadcastCaptchaDetected, broadcastCaptchaResolved } from '../ipc/jobsBroadcast'
import { screenshotsDir, tempDir } from '../config/paths'
import { withStorageWriteLock } from '../storageWriteLock'
import { mcpLogger } from '../logger'
import { isNavigableUrl } from '@shared/url'
import type { ProfileFields } from '@shared/types/profile'
import type { AgentPermissions } from '@shared/types/agentPermissions'
import { getAgentPermissions, getStorageMode } from '../db/repositories/settingsRepository'
import { writeSecureFileBuffer } from '../db/encryption'
import { allowRequestedPermissions, requestAgentPermissions } from './agentPermissionGate'

export type FillTaskResult =
  | { status: 'filled'; jobId: string; screenshotPath: string; filledFields: string[]; skippedFields: string[] }
  | { status: 'paused_captcha'; jobId: string; taskId: string; message: string }
  | {
      status: 'permission_denied'
      jobId: string
      requiredPermissions: Array<keyof AgentPermissions>
      message: string
    }
  | { status: 'failed'; jobId: string; reasonTag: string; message: string }

function extensionFor(originalFilename: string): string {
  return extname(originalFilename) || '.bin'
}

function materializeDocument(kind: 'resume' | 'cover_letter'): string | undefined {
  const doc = listDocuments().find((d) => d.kind === kind)
  if (!doc) return undefined
  const bytes = readDocumentBytes(doc.id)
  if (!bytes) return undefined
  const tempPath = join(tempDir(), `${randomUUID()}${extensionFor(doc.originalFilename)}`)
  // 0600: this is the decrypted resume, written to a directory every account
  // on the machine can read. The default mode would leave it world-readable
  // for as long as the fill takes. (No effect on Windows, which ignores the
  // mode and inherits the directory's ACL.)
  writeFileSync(tempPath, bytes, { mode: 0o600 })
  return tempPath
}

function safeUnlink(path: string | undefined): void {
  if (!path) return
  try {
    unlinkSync(path)
  } catch {
    // best-effort cleanup — not worth failing the task over
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

function failAndReturn(jobId: string, reasonTag: string, message: string): FillTaskResult {
  failJob(jobId, reasonTag, message)
  return { status: 'failed', jobId, reasonTag, message }
}

/**
 * Races the user clicking Resume/Cancel against auto-detecting that the
 * challenge cleared on its own (polled every 2s) — whichever happens first
 * wins. If auto-detect wins, the manual gate is resolved too so it doesn't
 * linger waiting for a click that will never come.
 */
async function waitForCaptchaResolution(taskId: string, jobId: string, page: Page): Promise<GateOutcome> {
  const stopSignal = { stopped: false }

  const pollPromise: Promise<GateOutcome> = (async (): Promise<GateOutcome> => {
    while (!stopSignal.stopped) {
      await new Promise((r) => setTimeout(r, 2000))
      if (stopSignal.stopped) break
      const check = await detectCaptcha(page).catch(() => ({ blocked: true }) as const)
      if (!check.blocked) return 'resolved'
    }
    return 'resolved'
  })()

  const outcome = await Promise.race([openGate(taskId, jobId, page), pollPromise])
  stopSignal.stopped = true
  if (isGateOpen(taskId)) {
    resumeGate(taskId)
  }
  return outcome
}

async function performFill(
  jobId: string,
  page: Page,
  browser: Browser,
  profile: ProfileFields,
  permissions: AgentPermissions
): Promise<FillTaskResult> {
  let resumePath: string | undefined
  let coverLetterPath: string | undefined

  try {
    if (permissions.autoUploadDocuments) {
      resumePath = materializeDocument('resume')
      coverLetterPath = materializeDocument('cover_letter')
    }

    const { filledFields, skippedFields, requiredPermissions } = await fillForm(page, profile, {
      allowFieldCompletion: permissions.autoCompleteFields,
      allowDocumentUploads: permissions.autoUploadDocuments,
      resumeFilePath: resumePath,
      coverLetterFilePath: coverLetterPath
    })

    if (requiredPermissions.length > 0) {
      await browser.close().catch(() => {})
      return {
        status: 'permission_denied',
        jobId,
        requiredPermissions,
        message: 'The form changed after permission was approved and now needs additional access. Run fill_application again to review it.'
      }
    }

    if (filledFields.length === 0) {
      await browser.close().catch(() => {})
      return failAndReturn(jobId, 'form_not_supported', "Couldn't identify any recognizable fields on this application form. It may need to be filled manually.")
    }

    // Screenshot capture + the DB row it's referenced from are what a
    // storage-location migration's copy-then-snapshot must never race — see
    // storageWriteLock.ts.
    const { screenshotPath, job } = await withStorageWriteLock(async () => {
      const capturedPath = await captureScreenshot(page, jobId)
      return { screenshotPath: capturedPath, job: setFilled(jobId, { screenshotPath: capturedPath }) }
    })
    broadcastJobUpdate(job)

    // The browser window is deliberately left open — the user reviews,
    // edits, and submits it themselves. We never close it out from under them.
    return { status: 'filled', jobId, screenshotPath, filledFields, skippedFields }
  } catch (err) {
    await browser.close().catch(() => {})
    return failAndReturn(jobId, 'other', `Failed while filling the form: ${String(err)}`)
  } finally {
    safeUnlink(resumePath)
    safeUnlink(coverLetterPath)
  }
}

async function authorizeAndPerformFill(
  jobId: string,
  jobTitle: string,
  company: string,
  page: Page,
  browser: Browser,
  profile: ProfileFields
): Promise<FillTaskResult> {
  try {
    const storedPermissions = getAgentPermissions()
    const documents = listDocuments()
    const requiredPermissions = await inspectFillRequirements(page, profile, {
      resume: documents.some((document) => document.kind === 'resume'),
      coverLetter: documents.some((document) => document.kind === 'cover_letter')
    })
    const disabledPermissions = requiredPermissions.filter((permission) => !storedPermissions[permission])

    let effectivePermissions = storedPermissions
    if (disabledPermissions.length > 0) {
      const decision = await requestAgentPermissions({
        jobId,
        jobTitle,
        company,
        permissions: disabledPermissions
      })
      if (decision === 'deny') {
        await browser.close().catch(() => {})
        return {
          status: 'permission_denied',
          jobId,
          requiredPermissions: disabledPermissions,
          message: 'The user denied this permission request or it timed out. The job remains Queued.'
        }
      }
      effectivePermissions = allowRequestedPermissions(storedPermissions, disabledPermissions)
    }

    return performFill(jobId, page, browser, profile, effectivePermissions)
  } catch (error) {
    await browser.close().catch(() => {})
    return failAndReturn(jobId, 'other', `Could not inspect or authorize this application form: ${String(error)}`)
  }
}

async function continueAfterCaptcha(
  taskId: string,
  jobId: string,
  page: Page,
  browser: Browser,
  profile: ProfileFields,
  jobTitle: string,
  company: string
): Promise<void> {
  const outcome = await waitForCaptchaResolution(taskId, jobId, page)
  if (outcome === 'cancelled') {
    await browser.close().catch(() => {})
    failJob(jobId, 'captcha_verification', 'The verification challenge was not resolved in time (or was cancelled).')
    return
  }
  broadcastCaptchaResolved({ taskId, jobId })
  await authorizeAndPerformFill(jobId, jobTitle, company, page, browser, profile)
}

export async function runFillTask(jobId: string): Promise<FillTaskResult> {
  const job = getJob(jobId)
  if (!job) {
    return failAndReturn(jobId, 'other', 'Job not found.')
  }
  if (job.status !== 'queued') {
    return { status: 'failed', jobId, reasonTag: 'other', message: `Job is not in the Queued state (currently: ${job.status}).` }
  }

  const profile = getProfile()
  if (!profile) {
    return { status: 'failed', jobId, reasonTag: 'other', message: 'No profile found; complete onboarding first.' }
  }

  const targetUrl = job.applicationUrl || job.url
  // `applicationUrl` is the one field here that no tool schema ever saw: the
  // scrapers copy it out of an ATS feed's `applyUrl`/`hostedUrl` (see
  // `scrapers/ashby.ts`, `scrapers/lever.ts`), so it is third-party data
  // being handed to `page.goto` in a *visible* window with the candidate's
  // resume already staged for upload. Checked before a browser is even
  // launched, so a bad URL costs nothing.
  if (!isNavigableUrl(targetUrl)) {
    return failAndReturn(
      jobId,
      'form_not_supported',
      `This job's application link is not an http(s) URL, so it cannot be opened: ${targetUrl}`
    )
  }

  let browser: Browser
  let context: BrowserContext
  try {
    const headed = await launchHeadedContext()
    browser = headed.browser
    context = headed.context
  } catch (err) {
    return failAndReturn(jobId, 'browser_unavailable', `Couldn't prepare a browser: ${String(err)}`)
  }

  let page: Page
  try {
    page = await context.newPage()
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // Client-rendered application forms (Ashby, Workday) finish mounting fields shortly after load.
    await page.waitForTimeout(1500)
  } catch (err) {
    await browser.close().catch(() => {})
    return failAndReturn(jobId, 'form_not_supported', `Failed to open the application page: ${String(err)}`)
  }

  const captcha = await detectCaptcha(page)
  if (captcha.blocked) {
    const taskId = randomUUID()
    setBlocking(jobId, captcha.reason ?? 'captcha_verification', taskId)
    const updated = getJob(jobId)
    if (updated) broadcastJobUpdate(updated)
    broadcastCaptchaDetected({ taskId, jobId, jobTitle: job.title, company: job.company })
    await page.bringToFront().catch(() => {})

    // Deliberately not awaited — the tool call must return now, not block
    // for up to 15 minutes on the user resolving the challenge.
    continueAfterCaptcha(taskId, jobId, page, browser, profile, job.title, job.company).catch((err) => {
      mcpLogger.error(`Fill task continuation crashed: ${String(err)}`)
    })

    return {
      status: 'paused_captcha',
      jobId,
      taskId,
      message: 'A verification challenge appeared in the browser window; resolve it there, then click Resume in the app (or it will resume automatically once the challenge clears).'
    }
  }

  return authorizeAndPerformFill(jobId, job.title, job.company, page, browser, profile)
}
