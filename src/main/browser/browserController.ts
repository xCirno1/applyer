import type { Browser, BrowserContext, Page } from 'playwright'
import { app } from 'electron'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { appLogger } from '../logger'
import { playwrightBrowsersDir } from '../config/paths'
import { runCommand } from '../config/processUtils'
import { parseDownloadProgressLine } from './downloadProgress'
import { broadcastBrowserSetupProgress, broadcastBrowserSetupStatus } from '../ipc/jobsBroadcast'
import {
  getAllowLocalAddresses,
  getBrowserPreference,
  getRemoteBrowserSettings
} from '../db/repositories/settingsRepository'
import type { ResolvedBrowserStatus } from '@shared/types/ipcEvents'
import type { RemoteBrowserProbe } from '@shared/types/remoteBrowser'
import { protectBrowserContext, protectBrowserPage } from './networkAccess'
import { resolveRemoteBrowserCandidates } from './devToolsActivePort'

const PREFERENCE_LABELS = { chrome: 'System Chrome', msedge: 'System Edge' } as const

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * Long on purpose. A browser that isn't listening refuses the connection immediately, so
 * the timeout never applies to it; what it does bound is the case where the browser holds
 * the handshake open while it asks the user for permission (Chrome 144+'s
 * chrome://inspect/#remote-debugging switch does exactly that, on every connection). Two
 * minutes is enough to notice the prompt and click it, and a prompt nobody answers should
 * still fail eventually rather than hang the agent's tool call forever.
 */
const REMOTE_CONNECT_TIMEOUT_MS = 120_000

/**
 * How long a connect may take before the renderer is told to point the user at the
 * browser's permission prompt. Short enough to be seen while the prompt is still up,
 * long enough that a flag-launched Chrome (no prompt, connects at once) never triggers it.
 */
const REMOTE_ATTACH_ANNOUNCE_DELAY_MS = 1_500

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
  const context = await browser.newContext({
    userAgent: REALISTIC_USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US'
  })
  await protectBrowserContext(context, getAllowLocalAddresses())
  return context
}

/**
 * A visible browser the agent can drive. `newPage()` is the only way to get a page out of
 * it, so every page carries the local-address guard whichever way the browser was obtained,
 * and `close()` is the only way to end a session, so a session never has to know whether
 * the browser underneath is one Applyer launched (close the window) or one it attached to
 * (close only the tab, keep the connection).
 */
export interface HeadedBrowser {
  browser: Browser
  newPage(): Promise<Page>
  /** Ends the session that owns `page`. Safe to call with a page that already closed, or with none. */
  close(page: Page | null): Promise<void>
}

/**
 * Used for anything interactive (login, filling a form): a real, visible window the user can
 * watch and take over. Either a fresh isolated window Applyer launches, or, when Settings >
 * Browser has "attach to a running browser" on, a new tab in the user's own already-running
 * browser (see `shared/types/remoteBrowser.ts` for why and what that trades away).
 */
export async function openHeadedBrowser(): Promise<HeadedBrowser> {
  const remote = getRemoteBrowserSettings()
  if (remote.enabled) return attachHeadedBrowser(remote.endpoint)

  const browser = await launchWithResolution(false)
  const context = await browser.newContext({
    userAgent: REALISTIC_USER_AGENT,
    // null (not a fixed size) lets the page's rendering area follow the real OS window as the
    // user drags/resizes it, instead of Playwright pinning content to a fixed viewport
    // regardless of the window's actual size; the headless context's fixed viewport (above)
    // is deliberately different, since that one is never resized by a human.
    viewport: null,
    locale: 'en-US'
  })
  await protectBrowserContext(context, getAllowLocalAddresses())
  return {
    browser,
    newPage: () => context.newPage(),
    close: async (page) => {
      if (page && !page.isClosed()) await page.close().catch(() => {})
      await browser.close().catch(() => {})
    }
  }
}

/**
 * One line only: Playwright appends a multi-line call log that is noise in a settings toast
 * or MCP result. A timeout is reworded, since "Timeout 120000ms exceeded" hides what almost
 * certainly happened: the browser put up its permission prompt and nobody accepted it.
 */
function describeConnectError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const firstLine = message.split('\n', 1)[0]?.trim() || 'unknown error'
  if (/\bTimeout \d+ms exceeded\b/.test(firstLine)) {
    return (
      `the browser did not accept the connection within ${Math.round(REMOTE_CONNECT_TIMEOUT_MS / 1000)}s; ` +
      'if it showed a prompt asking to allow remote debugging, it was not accepted in time'
    )
  }
  return firstLine
}

/**
 * Carries the endpoint and the one-line cause separately from the prose, so the IPC layer
 * can hand the renderer a translatable `{ code, params }` while the MCP tool result and the
 * log keep the full English sentence.
 */
export class RemoteBrowserUnreachableError extends Error {
  constructor(
    readonly endpoint: string,
    readonly detail: string
  ) {
    super(
      `Couldn't attach to the browser at ${endpoint} (${detail}). Make sure it is running with remote ` +
        `debugging enabled on that address, or turn off "Attach to a running browser" in Settings > Browser.`
    )
    this.name = 'RemoteBrowserUnreachableError'
  }
}

/**
 * Tries each URL `resolveRemoteBrowserCandidates` derives from the setting, in order, and
 * reports the first candidate's failure if none connects: that one (the websocket path read
 * from the browser's own profile folder, when there is one) is the most specific, whereas
 * the HTTP root tried last fails with an unhelpful 404 against Chrome's newer switch.
 * `announce` tells the renderer to point the user at the browser's permission prompt once
 * the handshake has been pending a while; off for the settings page's own test, which shows
 * that hint itself.
 */
async function connectRemoteBrowser(
  endpoint: string,
  options: { announce: boolean }
): Promise<{ browser: Browser; profileDir: string | null }> {
  const chromium = await getChromium()
  const candidates = await resolveRemoteBrowserCandidates(endpoint)
  const announce = options.announce
    ? setTimeout(() => broadcastBrowserSetupStatus({ status: 'attaching', endpoint }), REMOTE_ATTACH_ANNOUNCE_DELAY_MS)
    : null
  announce?.unref()
  const failures: string[] = []
  try {
    for (const candidate of candidates) {
      try {
        const browser = await chromium.connectOverCDP(candidate.url, { timeout: REMOTE_CONNECT_TIMEOUT_MS })
        appLogger.info(
          `Attached to the browser at ${candidate.url}` +
            (candidate.profileDir ? ` (websocket path read from ${candidate.profileDir})` : '')
        )
        return { browser, profileDir: candidate.profileDir ?? null }
      } catch (err) {
        const detail = describeConnectError(err)
        appLogger.info(`Could not attach to the browser at ${candidate.url}: ${detail}`)
        failures.push(detail)
      }
    }
  } finally {
    if (announce) clearTimeout(announce)
  }
  throw new RemoteBrowserUnreachableError(endpoint, failures[0] ?? 'no connection candidates')
}

interface AttachedBrowser {
  endpoint: string
  browser: Browser
  profileDir: string | null
}

// One connection to the user's browser, shared by every session and by the settings page's
// test, for as long as it stays up. Chrome 144+'s remote-debugging switch asks the user's
// permission on every new CDP connection and offers no way to remember the answer, so the
// only way to ask once per Applyer run rather than once per job is to never let go of the
// connection between jobs. Sessions close their own tab and leave the connection alone.
let attachedBrowser: AttachedBrowser | null = null
// Dedupes concurrent first-attachers so two jobs starting together raise one prompt, not two.
let attachingPromise: Promise<AttachedBrowser> | null = null

/**
 * The shared attached connection for `endpoint`, connecting (and possibly prompting) only if
 * there isn't one already, or the one there is went down, or points somewhere else.
 */
async function getAttachedBrowser(endpoint: string, options: { announce: boolean }): Promise<AttachedBrowser> {
  if (attachedBrowser?.endpoint === endpoint && attachedBrowser.browser.isConnected()) return attachedBrowser
  if (attachingPromise) return attachingPromise
  attachingPromise = (async () => {
    // A connection to a different endpoint, or a dead one, is replaced rather than kept around.
    await disconnectAttachedBrowser()
    const { browser, profileDir } = await connectRemoteBrowser(endpoint, options)
    const attached: AttachedBrowser = { endpoint, browser, profileDir }
    browser.once('disconnected', () => {
      if (attachedBrowser === attached) attachedBrowser = null
    })
    attachedBrowser = attached
    return attached
  })().finally(() => {
    attachingPromise = null
  })
  return attachingPromise
}

/**
 * Drops the shared connection to the user's browser, if any. Called when the setting changes
 * (a new endpoint, or attaching turned off) and at quit; otherwise the connection is kept so
 * the browser's permission prompt is answered once per run, not once per job. Open tabs are
 * the user's now and are left alone.
 */
export async function disconnectAttachedBrowser(): Promise<void> {
  const attached = attachedBrowser
  attachedBrowser = null
  if (!attached) return
  try {
    await attached.browser.close()
  } catch (err) {
    appLogger.warn(`Failed to disconnect from the attached browser cleanly: ${String(err)}`)
  }
}

/**
 * The user's default profile is `contexts()[0]` on a CDP-attached browser; that, not a
 * `newContext()` (which would be a fresh, signed-out incognito context), is the whole point
 * of attaching. No user-agent/viewport/locale overrides either: this is their real browser,
 * and pretending otherwise would only make the session look less like them.
 */
async function attachHeadedBrowser(endpoint: string): Promise<HeadedBrowser> {
  const { browser } = await getAttachedBrowser(endpoint, { announce: true })
  const context = browser.contexts()[0]
  if (!context) {
    await disconnectAttachedBrowser()
    throw new Error(
      `The browser at ${endpoint} exposes no profile to attach to. Start it normally (with a window open) ` +
        `and remote debugging enabled, or turn off "Attach to a running browser" in Settings > Browser.`
    )
  }
  const allowLocalAddresses = getAllowLocalAddresses()
  return {
    browser,
    newPage: async () => {
      const page = await context.newPage()
      try {
        // Page-level, not context-level: the context is the user's whole browser, and
        // routing it would push every request from every one of their tabs through here.
        await protectBrowserPage(page, allowLocalAddresses)
      } catch (err) {
        await page.close().catch(() => {})
        throw err
      }
      return page
    },
    // Only the tab: the connection is shared and outlives this session (see attachedBrowser).
    close: async (page) => {
      if (page && !page.isClosed()) await page.close().catch(() => {})
    }
  }
}

/**
 * Settings > Browser's "Test connection": attaches and reads what's there, without opening
 * anything. The connection is kept as the shared one, so a test followed by a job is one
 * permission prompt, not two. Throws with the same wording a real launch would, so what the
 * user sees in the settings toast is what the agent would see in a tool result.
 */
export async function probeRemoteBrowser(endpoint: string): Promise<RemoteBrowserProbe> {
  const { browser, profileDir } = await getAttachedBrowser(endpoint, { announce: false })
  const context = browser.contexts()[0]
  return {
    browserVersion: browser.version(),
    hasDefaultContext: context !== undefined,
    pageCount: context ? context.pages().length : 0,
    profileDir
  }
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
  await disconnectAttachedBrowser()
}

/** Test-only: true while a managed-download confirmation prompt is awaiting an answer. */
export function __hasPendingInstallConfirmation(): boolean {
  return installConfirmationResolver !== null
}

/** Test-only: clears module-level resolution state between test cases. */
export function __resetBrowserControllerForTests(): void {
  headlessBrowser = null
  attachedBrowser = null
  attachingPromise = null
  chromiumModule = null
  chromiumImportPromise = null
  resolvedLaunchOptions = null
  downloadPromise = null
  installConfirmationResolver = null
  installConfirmationPromise = null
}
