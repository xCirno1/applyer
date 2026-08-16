import { chromium, type Browser, type BrowserContext } from 'playwright'
import { appLogger } from '../logger'

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let headlessBrowser: Browser | null = null

async function getHeadlessBrowser(): Promise<Browser> {
  if (!headlessBrowser || !headlessBrowser.isConnected()) {
    headlessBrowser = await chromium.launch({ headless: true })
  }
  return headlessBrowser
}

/** Used for read-only work (searching, fetching a job description) — never for anything interactive. */
export async function newHeadlessContext(): Promise<BrowserContext> {
  const browser = await getHeadlessBrowser()
  return browser.newContext({
    userAgent: REALISTIC_USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US'
  })
}

/** Used for anything interactive (login, filling a form) — a real, visible window the user can watch and take over. Caller owns closing both. */
export async function launchHeadedContext(): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    userAgent: REALISTIC_USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US'
  })
  return { browser, context }
}

export async function closeAllBrowsers(): Promise<void> {
  if (headlessBrowser) {
    try {
      await headlessBrowser.close()
    } catch (err) {
      appLogger.warn(`Failed to close headless browser cleanly: ${String(err)}`)
    }
    headlessBrowser = null
  }
}
