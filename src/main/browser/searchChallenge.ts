import { randomUUID } from 'crypto'
import type { Page } from 'playwright'
import { openHeadedBrowser } from './browserController'
import { detectCaptcha } from './captchaDetector'
import { openGate, isGateOpen, resumeGate, type GateOutcome } from './captchaGate'
import { broadcastSearchChallengeDetected, broadcastSearchChallengeResolved } from '../ipc/jobsBroadcast'
import { recordRunEvent } from '../runs/runTracker'
import { appLogger } from '../logger'
import type { AggregatorSource } from '@shared/types/jobSource'

/**
 * Retries a search a site refused to answer headless in the application
 * browser: a visible window Applyer launches, or the user's own browser
 * when Settings > Browser attaches to one. Some sites (Prosple, behind
 * Cloudflare's managed challenge) answer a headless browser with an
 * interstitial no matter what it sends, and clear the same page in a real
 * window within seconds, often with no click at all; when they do want a
 * click, the user is the one to give it, so the app says so (a banner in
 * the window and a desktop notification, the same shape as a fill paused
 * on a captcha) rather than trying to get past the challenge by itself.
 *
 * The wait is inside the `search_jobs` call, which is why the timeout is
 * short next to a fill's: a fill parks its job as paused and returns, but
 * a search has nothing to park, and an agent waiting on a tool result
 * should get one in minutes, not a quarter of an hour. Challenges are
 * taken one at a time (a search hitting two blocked sites opens one window
 * after the other, not two at once), and the page is closed whichever way
 * the wait ends.
 */

const CHALLENGE_TIMEOUT_MS = 2 * 60 * 1000
const CHALLENGE_POLL_MS = 2000
const NAVIGATION_TIMEOUT_MS = 20000
const SETTLE_TIMEOUT_MS = 8000

export interface SearchChallengeRequest<T> {
  source: AggregatorSource
  host: string
  url: string
  /** Selector the listing renders into, waited for (briefly) before the page is read. */
  waitFor?: string
  read: (page: Page) => Promise<T>
}

export type SearchChallengeOutcome<T> = { status: 'ok'; value: T } | { status: 'blocked'; warning: string }

let queue: Promise<unknown> = Promise.resolve()

/** Runs `task` after every challenge already waiting; a rejected predecessor does not block the next. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

async function waitForClear(taskId: string, page: Page, timeoutMs: number): Promise<GateOutcome> {
  const stop = { stopped: false }
  const poll = (async (): Promise<GateOutcome> => {
    while (!stop.stopped) {
      await new Promise((resolve) => setTimeout(resolve, CHALLENGE_POLL_MS))
      if (stop.stopped) break
      const check = await detectCaptcha(page).catch(() => ({ blocked: true }) as const)
      if (!check.blocked) return 'resolved'
    }
    return 'resolved'
  })()
  const outcome = await Promise.race([openGate(taskId, null, page, timeoutMs), poll])
  stop.stopped = true
  if (isGateOpen(taskId)) resumeGate(taskId)
  return outcome
}

/**
 * Opens `url` in the application browser, waits for the site's challenge
 * to clear (by itself, or once the user solves it and the banner's Resume
 * re-checks), and reads the page. Never throws for a challenge that stays
 * up: that is a blocked outcome with a warning, like the headless attempt's.
 */
export function searchThroughChallenge<T>(
  request: SearchChallengeRequest<T>,
  timeoutMs = CHALLENGE_TIMEOUT_MS
): Promise<SearchChallengeOutcome<T>> {
  return enqueue(() => runChallenge(request, timeoutMs))
}

async function runChallenge<T>(request: SearchChallengeRequest<T>, timeoutMs: number): Promise<SearchChallengeOutcome<T>> {
  const { source, host, url, waitFor, read } = request
  // Any visible window will do: nothing here needs the user's signed-in
  // profile, so an attached browser that is not running is not a reason to
  // give the site up.
  const headed = await openHeadedBrowser({ whenUnreachable: 'launch' })
  let page: Page | null = null
  try {
    page = await headed.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
    if (waitFor) await page.waitForSelector(waitFor, { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)

    const first = await detectCaptcha(page)
    if (first.blocked) {
      const taskId = `search-${randomUUID()}`
      const reason = first.reason ?? 'captcha_verification'
      appLogger.info(`${source}: search on ${host} waiting on a verification challenge in the application browser (${reason})`)
      broadcastSearchChallengeDetected({ taskId, source, host })
      recordRunEvent('captcha_paused', { source, meta: { reason, search: true } })
      const outcome = await waitForClear(taskId, page, timeoutMs)
      broadcastSearchChallengeResolved({ taskId })
      if (outcome === 'cancelled') {
        return {
          status: 'blocked',
          warning: `${source}: blocked by a verification challenge on ${host} that was not solved in the application browser (cancelled or timed out)`
        }
      }
      recordRunEvent('captcha_resolved', { source, meta: { search: true } })
      if (waitFor) await page.waitForSelector(waitFor, { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
    }
    return { status: 'ok', value: await read(page) }
  } finally {
    await headed.close(page).catch((err) => appLogger.warn(`${source}: could not close the challenge page: ${String(err)}`))
  }
}
