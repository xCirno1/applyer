import type { Browser, BrowserContext } from 'playwright'
import { app } from 'electron'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { appLogger } from '../logger'
import { playwrightBrowsersDir } from '../config/paths'
import { runCommand } from '../config/processUtils'
import { parseDownloadProgressLine } from './downloadProgress'
import { broadcastBrowserSetupProgress, broadcastBrowserSetupStatus } from '../ipc/jobsBroadcast'

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let headlessBrowser: Browser | null = null

// Playwright resolves/caches PLAYWRIGHT_BROWSERS_PATH at the moment its module is
// first imported, not on every launch call — so the env var must be set right before
// that one-time import, not just before a launch. Importing `chromium` lazily (instead
// of a static top-of-file import) lets us control exactly when that first import
// happens, deferred until a browser is actually needed (always after app.whenReady(),
// since nothing calls into this module before the MCP server starts) — which means we
// never need to call app.getPath('userData') before the app is ready.
let chromiumModule: typeof import('playwright').chromium | null = null
// Dedupes the import itself (not just its result) so concurrent first-callers share
// one `import('playwright')` call rather than each racing their own.
let chromiumImportPromise: Promise<typeof import('playwright').chromium> | null = null

async function getChromium(): Promise<typeof import('playwright').chromium> {
  if (chromiumModule) return chromiumModule
  if (!chromiumImportPromise) {
    // Dev: resolve from node_modules/playwright-core/.local-browsers (populated by
    // postinstall) instead of the system-wide ~/.cache/ms-playwright, so a packaged
    // build doesn't depend on it. Packaged: a writable, per-user directory — see
    // launchWithResolution()/ensureManagedChromiumDownloaded() below.
    process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged ? playwrightBrowsersDir() : '0'
    chromiumImportPromise = import('playwright').then((mod) => {
      chromiumModule = mod.chromium
      return chromiumModule
    })
  }
  return chromiumImportPromise
}

let resolvedLaunchOptions: { channel?: 'chrome' | 'msedge' } | null = null
let downloadPromise: Promise<void> | null = null

/**
 * In dev, launches straight from the bundled .local-browsers set. In a packaged
 * build, tries the system's installed Chrome, then Edge (Playwright's `channel`
 * option — a fresh isolated profile, not the user's real browser data), and only
 * falls back to downloading a managed Chromium if neither is found. Whichever
 * resolution succeeds is memoized for the rest of the process so it isn't
 * re-detected on every launch.
 */
async function launchWithResolution(headless: boolean): Promise<Browser> {
  const chromium = await getChromium()

  if (!app.isPackaged) {
    return chromium.launch({ headless })
  }
  if (resolvedLaunchOptions) {
    return chromium.launch({ headless, ...resolvedLaunchOptions })
  }

  for (const channel of ['chrome', 'msedge'] as const) {
    try {
      const browser = await chromium.launch({ headless, channel })
      resolvedLaunchOptions = { channel }
      return browser
    } catch (err) {
      appLogger.info(`Browser channel '${channel}' unavailable: ${String(err)}`)
    }
  }

  try {
    await ensureManagedChromiumDownloaded()
  } catch (err) {
    throw new Error(
      `No usable browser found. Tried system Chrome, system Edge, and an automatic ` +
        `Chromium download, but all failed. Last error: ${String(err)}`
    )
  }
  resolvedLaunchOptions = {}
  return chromium.launch({ headless })
}

/** Downloads Playwright's managed Chromium into a writable per-user directory, if not already present. Safe to call concurrently — a second caller awaits the same in-flight download rather than starting another. */
export async function ensureManagedChromiumDownloaded(): Promise<void> {
  const chromium = await getChromium()
  if (existsSync(chromium.executablePath())) return
  if (!downloadPromise) {
    downloadPromise = downloadManagedChromium().catch((err) => {
      downloadPromise = null // allow a later call (e.g. the renderer's retry action) to try again
      throw err
    })
  }
  return downloadPromise
}

async function downloadManagedChromium(): Promise<void> {
  const require = createRequire(import.meta.url)
  // 'playwright-core/cli.js' isn't in that package's `exports` map and can't be
  // resolved directly — its package.json is, so resolve that and join cli.js onto it.
  const cliPath = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js')

  broadcastBrowserSetupStatus({ status: 'downloading' })
  const result = await runCommand(process.execPath, [cliPath, 'install', 'chromium'], {
    // Mirrors config/mcpConfigWriter.ts's getMcpInvocation(): spawning the packaged
    // Electron binary itself as plain Node (no Chromium/GUI init, no dependency on a
    // system `node` binary existing).
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeoutMs: 10 * 60 * 1000,
    onStdout: (chunk) => {
      const parsed = parseDownloadProgressLine(chunk)
      if (parsed) broadcastBrowserSetupProgress(parsed)
    }
  })

  if (result.code !== 0) {
    const message = result.stderr.trim() || `exited with code ${result.code}`
    broadcastBrowserSetupStatus({ status: 'error', message })
    throw new Error(`playwright install chromium failed: ${message}`)
  }
  broadcastBrowserSetupStatus({ status: 'ready' })
}

async function getHeadlessBrowser(): Promise<Browser> {
  if (!headlessBrowser || !headlessBrowser.isConnected()) {
    headlessBrowser = await launchWithResolution(true)
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
  const browser = await launchWithResolution(false)
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

/** Test-only: clears module-level resolution state between test cases. */
export function __resetBrowserControllerForTests(): void {
  headlessBrowser = null
  chromiumModule = null
  chromiumImportPromise = null
  resolvedLaunchOptions = null
  downloadPromise = null
}
