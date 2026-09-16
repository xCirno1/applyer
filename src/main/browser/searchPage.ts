import { newHeadlessContext } from './browserController'
import { detectCaptcha } from './captchaDetector'
import { searchThroughChallenge, type SearchChallengeRequest } from './searchChallenge'
import { getSearchChallengeFallback } from '../db/repositories/settingsRepository'
import { appLogger } from '../logger'

/**
 * The one way a browser-driven aggregator (Indeed, LinkedIn, Seek, Jora,
 * Prosple) reads its search page: open it headless, wait for the listing
 * to render, check for a verification challenge, read the cards. Kept out
 * of the scrapers so that what happens on a challenge is decided once:
 * with the fallback on (Settings > Job search), the same page is opened
 * again in the application browser and the user is asked to clear the
 * challenge (`searchChallenge.ts`); with it off, or once that fails too,
 * the search reports itself as blocked and the other sources carry on.
 *
 * `read` runs against whichever page answered, so a scraper's extraction
 * never knows or cares which browser it is looking at.
 */

const NAVIGATION_TIMEOUT_MS = 20000
const SETTLE_TIMEOUT_MS = 8000

export type SearchPageSpec<T> = SearchChallengeRequest<T>

export type SearchPageOutcome<T> = { status: 'ok'; value: T } | { status: 'blocked'; warning: string }

export async function readSearchPage<T>(spec: SearchPageSpec<T>): Promise<SearchPageOutcome<T>> {
  const { source, host, url, waitFor, read } = spec
  const context = await newHeadlessContext()
  let reason: string
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
    if (waitFor) await page.waitForSelector(waitFor, { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
    const captcha = await detectCaptcha(page)
    if (!captcha.blocked) return { status: 'ok', value: await read(page) }
    reason = captcha.reason ?? 'captcha_verification'
  } finally {
    await context.close()
  }

  if (!getSearchChallengeFallback()) {
    return { status: 'blocked', warning: `${source}: blocked by a verification challenge on ${host} (${reason})` }
  }
  try {
    return await searchThroughChallenge(spec)
  } catch (err) {
    // The application browser could not be opened or the page would not
    // load there either; the headless refusal is still the honest answer.
    appLogger.warn(`${source}: retrying the search in the application browser failed: ${String(err)}`)
    return {
      status: 'blocked',
      warning: `${source}: blocked by a verification challenge on ${host} (${reason}); the application browser could not retry it (${describe(err)})`
    }
  }
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.split('\n', 1)[0]?.trim() || 'unknown error'
}
