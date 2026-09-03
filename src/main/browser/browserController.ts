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
import { getBrowserPreference } from '../db/repositories/settingsRepository'
import type { ResolvedBrowserStatus } from '@shared/types/ipcEvents'

const PREFERENCE_LABELS = { chrome: 'System Chrome', msedge: 'System Edge' } as const

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

const INSTALL_CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000

let installConfirmationResolver: ((confirmed: boolean) => void) | null = null
let installConfirmationPromise: Promise<boolean> | null = null

/**
 * Asks the renderer (via a `confirm` status broadcast, shown by `BrowserSetupModal`) whether
 * it's OK to download a managed Chromium, and waits for the answer. Concurrent callers share
 * one prompt/promise rather than each popping their own. Times out to "declined" if nobody
 * answers, so a launch attempt can't hang forever on an unattended machine.
 */
function confirmManagedDownload(): Promise<boolean> {
  if (!installConfirmationPromise) {
    installConfirmationPromise = new Promise<boolean>((resolve) => {
      installConfirmationResolver = resolve
      broadcastBrowserSetupStatus({ status: 'confirm' })
    }).finally(() => {
      installConfirmationResolver = null
      installConfirmationPromise = null
    })
    setTimeout(() => installConfirmationResolver?.(false), INSTALL_CONFIRMATION_TIMEOUT_MS).unref()
  }
  return installConfirmationPromise
}

/** Answers a pending `confirmManagedDownload()` prompt — called from the `browserSetup:respondInstall` IPC handler. A no-op if nothing is currently waiting. */
export function resolveManagedDownloadConfirmation(confirmed: boolean): void {
  installConfirmationResolver?.(confirmed)
}

/**
 * In dev, launches straight from the bundled .local-browsers set. In a packaged build,
 * resolution follows the user's `browser_preference` setting (Settings > Browser):
 * "auto" (default) tries the system's installed Chrome, then Edge (Playwright's `channel`
 * option — a fresh isolated profile, not the user's real browser data), then falls back to
 * downloading a managed Chromium if neither is found; "chrome"/"msedge"/"managed" pin
 * resolution to exactly that option, failing loudly instead of silently trying something
 * else if it's unavailable, since the user explicitly chose it. Whichever resolution
 * succeeds is memoized for the rest of the process so it isn't re-detected on every launch
 * — see `invalidateResolvedBrowser()` for how a preference change takes effect without a
 * restart.
 */
async function launchWithResolution(headless: boolean): Promise<Browser> {
  const chromium = await getChromium()
  // Only meaningful for a real, visible window (paired with the headed context's
  // viewport: null) — opens it filling the screen instead of Chromium's small default,
  // rather than leaving the user to manually resize/reposition it every time.
  const args = headless ? undefined : ['--start-maximized']

  if (!app.isPackaged) {
    return chromium.launch({ headless, args })
  }
  if (resolvedLaunchOptions) {
    return chromium.launch({ headless, args, ...resolvedLaunchOptions })
  }

  const preference = getBrowserPreference()

  if (preference !== 'managed') {
    const channels = preference === 'auto' ? (['chrome', 'msedge'] as const) : ([preference] as const)
    for (const channel of channels) {
      try {
        const browser = await chromium.launch({ headless, args, channel })
        resolvedLaunchOptions = { channel }
        return browser
      } catch (err) {
        appLogger.info(`Browser channel '${channel}' unavailable: ${String(err)}`)
      }
    }
    if (preference !== 'auto') {
      throw new Error(
        `The selected browser (${PREFERENCE_LABELS[preference]}) could not be launched. It may not be ` +
          `installed on this system. Pick a different option in Settings > Browser, or switch to "Auto".`
      )
    }
  }

  try {
    await ensureManagedChromiumDownloaded()
  } catch (err) {
    throw new Error(
      preference === 'managed'
        ? `Couldn't download a managed Chromium: ${String(err)}`
        : `No usable browser found. Tried system Chrome, system Edge, and an automatic ` +
            `Chromium download, but all failed. Last error: ${String(err)}`
    )
  }
  resolvedLaunchOptions = {}
  return chromium.launch({ headless, args })
}

/**
 * Clears the cached channel/download resolution so the next launch re-resolves according
 * to the (possibly just-changed) browser preference, without requiring an app restart.
 * Any browser/context already open from a prior resolution is left running as-is.
 */
export function invalidateResolvedBrowser(): void {
  resolvedLaunchOptions = null
}

/** What Settings > Browser shows as the currently active browser. */
export function getResolvedBrowserStatus(): ResolvedBrowserStatus {
  const packaged = app.isPackaged
  if (!chromiumModule) return { packaged, kind: 'unresolved', executablePath: null }
  if (!packaged) return { packaged, kind: 'dev-bundled', executablePath: chromiumModule.executablePath() }
  if (resolvedLaunchOptions?.channel) return { packaged, kind: resolvedLaunchOptions.channel, executablePath: null }
  if (resolvedLaunchOptions) return { packaged, kind: 'managed', executablePath: chromiumModule.executablePath() }
  return { packaged, kind: 'unresolved', executablePath: null }
}

/**
 * Downloads Playwright's managed Chromium into a writable per-user directory, if not already
 * present. Safe to call concurrently — a second caller awaits the same in-flight
 * confirmation/download rather than starting another. By default asks the user first (via
 * `confirmManagedDownload()`) since this is an unattended, unprompted network download the
 * user may not want; pass `requireConfirmation: false` only for a call that's already an
 * explicit user action (the "Retry" button after a failed download — they already said yes once).
 */
export async function ensureManagedChromiumDownloaded(
  options: { requireConfirmation?: boolean } = {}
): Promise<void> {
  const { requireConfirmation = true } = options
  const chromium = await getChromium()
  if (existsSync(chromium.executablePath())) return
  if (!downloadPromise) {
    downloadPromise = (async () => {
      if (requireConfirmation) {
        const confirmed = await confirmManagedDownload()
        if (!confirmed) {
          throw new Error(
            'Browser download was declined. Job automation needs a browser to continue. Answer the setup ' +
              'prompt to try again, or pick "System Chrome"/"System Edge" in Settings > Browser if one is installed.'
          )
        }
      }
      await downloadManagedChromium()
    })().catch((err) => {
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
    // null (not a fixed size) lets the page's rendering area follow the real OS window as the
    // user drags/resizes it, instead of Playwright pinning content to a fixed viewport
    // regardless of the window's actual size — the headless context's fixed viewport (below)
    // is deliberately different, since that one is never resized by a human.
    viewport: null,
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

/** Test-only: true while a managed-download confirmation prompt is awaiting an answer. */
export function __hasPendingInstallConfirmation(): boolean {
  return installConfirmationResolver !== null
}

/** Test-only: clears module-level resolution state between test cases. */
export function __resetBrowserControllerForTests(): void {
  headlessBrowser = null
  chromiumModule = null
  chromiumImportPromise = null
  resolvedLaunchOptions = null
  downloadPromise = null
  installConfirmationResolver = null
  installConfirmationPromise = null
}
