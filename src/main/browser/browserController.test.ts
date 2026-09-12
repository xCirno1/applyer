import { describe, it, expect, vi, beforeEach } from 'vitest'
import { __setPackaged, __resetElectronMock } from '../../../test/mocks/electron'

const launchMock = vi.fn()
const connectOverCDPMock = vi.fn()
const executablePathMock = vi.fn()

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
    connectOverCDP: (...args: unknown[]) => connectOverCDPMock(...args),
    executablePath: (...args: unknown[]) => executablePathMock(...args)
  }
}))

const runCommandMock = vi.fn()
vi.mock('../config/processUtils', () => ({
  runCommand: (...args: unknown[]) => runCommandMock(...args)
}))

const existsSyncMock = vi.fn()
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: (...args: unknown[]) => existsSyncMock(...args) }
})

const getBrowserPreferenceMock = vi.fn()
const getAllowLocalAddressesMock = vi.fn()
const getRemoteBrowserSettingsMock = vi.fn()
vi.mock('../db/repositories/settingsRepository', () => ({
  getBrowserPreference: (...args: unknown[]) => getBrowserPreferenceMock(...args),
  getAllowLocalAddresses: (...args: unknown[]) => getAllowLocalAddressesMock(...args),
  getRemoteBrowserSettings: (...args: unknown[]) => getRemoteBrowserSettingsMock(...args)
}))

const resolveCandidatesMock = vi.fn()
vi.mock('./devToolsActivePort', () => ({
  resolveRemoteBrowserCandidates: (...args: unknown[]) => resolveCandidatesMock(...args)
}))

const broadcastStatusMock = vi.fn()
vi.mock('../ipc/jobsBroadcast', () => ({
  broadcastBrowserSetupStatus: (...args: unknown[]) => broadcastStatusMock(...args),
  broadcastBrowserSetupProgress: vi.fn()
}))

import {
  newHeadlessContext,
  openHeadedBrowser,
  probeRemoteBrowser,
  disconnectAttachedBrowser,
  closeAllBrowsers,
  getResolvedBrowserStatus,
  invalidateResolvedBrowser,
  ensureManagedChromiumDownloaded,
  resolveManagedDownloadConfirmation,
  __hasPendingInstallConfirmation,
  __resetBrowserControllerForTests
} from './browserController'

/** Waits for a confirmManagedDownload() prompt to actually be pending, then answers it — avoids racing the several `await`s launchWithResolution() takes to get there. */
async function answerInstallPrompt(accept: boolean): Promise<void> {
  await vi.waitFor(() => {
    if (!__hasPendingInstallConfirmation()) throw new Error('no pending install confirmation yet')
  })
  resolveManagedDownloadConfirmation(accept)
}

function createFakeBrowser(): { isConnected: () => boolean; newContext: () => Promise<object>; close: () => Promise<void> } {
  return {
    isConnected: () => true,
    newContext: async () => ({ route: vi.fn() }),
    close: async () => {}
  }
}

beforeEach(() => {
  __resetElectronMock()
  __resetBrowserControllerForTests()
  launchMock.mockReset()
  connectOverCDPMock.mockReset()
  executablePathMock.mockReset().mockReturnValue('/fake/path/to/chromium')
  runCommandMock.mockReset()
  existsSyncMock.mockReset()
  getBrowserPreferenceMock.mockReset().mockReturnValue('auto')
  getAllowLocalAddressesMock.mockReset().mockReturnValue(false)
  getRemoteBrowserSettingsMock.mockReset().mockReturnValue({ enabled: false, endpoint: 'http://127.0.0.1:9222' })
  // Default: no profile folder knows the port, so the address is tried as typed.
  resolveCandidatesMock.mockReset().mockImplementation(async (endpoint: string) => [{ url: endpoint }])
  broadcastStatusMock.mockReset()
})

describe('browserController — launch resolution', () => {
  it('dev mode: launches with no channel, no resolution logic', async () => {
    launchMock.mockResolvedValue(createFakeBrowser())
    await newHeadlessContext()
    expect(launchMock).toHaveBeenCalledWith({ headless: true })
    expect(runCommandMock).not.toHaveBeenCalled()
  })

  it('packaged: chrome succeeds, and a later call reuses the cached channel without re-probing', async () => {
    __setPackaged(true)
    launchMock.mockResolvedValueOnce(createFakeBrowser())
    const first = await openHeadedBrowser()
    expect(first.browser).toBeTruthy()
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'chrome' })

    // Even if chrome would now fail, a cached resolution shouldn't re-probe other channels.
    launchMock.mockRejectedValueOnce(new Error('chrome not found this time'))
    await expect(openHeadedBrowser()).rejects.toThrow('chrome not found this time')
    expect(launchMock).toHaveBeenCalledTimes(2)
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'chrome' })
  })

  it('packaged: falls back to msedge when chrome is unavailable', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel === 'chrome') throw new Error('chrome not found')
      if (opts.channel === 'msedge') return createFakeBrowser()
      throw new Error('unexpected channel: ' + opts.channel)
    })
    const { browser } = await openHeadedBrowser()
    expect(browser).toBeTruthy()
    expect(launchMock).toHaveBeenNthCalledWith(1, { headless: false, args: ['--start-maximized'], channel: 'chrome' })
    expect(launchMock).toHaveBeenNthCalledWith(2, { headless: false, args: ['--start-maximized'], channel: 'msedge' })
  })

  it('packaged: both channels fail but the browser is already downloaded — launches with no channel, skips the download', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel) throw new Error(`${opts.channel} not found`)
      return createFakeBrowser()
    })
    existsSyncMock.mockReturnValue(true)

    const { browser } = await openHeadedBrowser()
    expect(browser).toBeTruthy()
    expect(runCommandMock).not.toHaveBeenCalled()
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'] })
  })

  it('packaged: both channels fail and not yet downloaded — prompts, then downloads and launches with no channel once confirmed', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel) throw new Error(`${opts.channel} not found`)
      return createFakeBrowser()
    })
    existsSyncMock.mockReturnValue(false)
    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    const pending = openHeadedBrowser()
    await answerInstallPrompt(true)
    const { browser } = await pending
    expect(browser).toBeTruthy()
    expect(runCommandMock).toHaveBeenCalledTimes(1)
    const [, args] = runCommandMock.mock.calls[0] as [string, string[]]
    expect(args).toContain('install')
    expect(args).toContain('chromium')
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'] })
  })

  it('packaged: a failed download resets state so a later call prompts and retries', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel) throw new Error(`${opts.channel} not found`)
      return createFakeBrowser()
    })
    existsSyncMock.mockReturnValue(false)
    runCommandMock.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'network error' })

    const firstAttempt = openHeadedBrowser()
    await answerInstallPrompt(true)
    await expect(firstAttempt).rejects.toThrow(/network error/)
    expect(runCommandMock).toHaveBeenCalledTimes(1)

    runCommandMock.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    const secondAttempt = openHeadedBrowser()
    await answerInstallPrompt(true)
    const { browser } = await secondAttempt
    expect(browser).toBeTruthy()
    expect(runCommandMock).toHaveBeenCalledTimes(2)
  })

  it('packaged: concurrent callers during an in-flight download share one prompt and one download, not two', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel) throw new Error(`${opts.channel} not found`)
      return createFakeBrowser()
    })
    existsSyncMock.mockReturnValue(false)
    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    const promise1 = openHeadedBrowser()
    const promise2 = openHeadedBrowser()
    await answerInstallPrompt(true)
    const [r1, r2] = await Promise.all([promise1, promise2])
    expect(r1.browser).toBeTruthy()
    expect(r2.browser).toBeTruthy()
    expect(runCommandMock).toHaveBeenCalledTimes(1)
  })
})

describe('browserController — install confirmation', () => {
  beforeEach(() => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('managed')
    existsSyncMock.mockReturnValue(false)
  })

  it('does not download until the prompt is answered', async () => {
    launchMock.mockResolvedValue(createFakeBrowser())
    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    const pending = openHeadedBrowser()
    await vi.waitFor(() => {
      if (!__hasPendingInstallConfirmation()) throw new Error('not yet prompted')
    })
    expect(runCommandMock).not.toHaveBeenCalled()

    resolveManagedDownloadConfirmation(true)
    await pending
    expect(runCommandMock).toHaveBeenCalledTimes(1)
  })

  it('declining throws a clear error instead of downloading, and resets state so a later call re-prompts', async () => {
    launchMock.mockResolvedValue(createFakeBrowser())

    const pending = openHeadedBrowser()
    await answerInstallPrompt(false)
    await expect(pending).rejects.toThrow(/declined/)
    expect(runCommandMock).not.toHaveBeenCalled()

    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    const retryPending = openHeadedBrowser()
    await answerInstallPrompt(true)
    await retryPending
    expect(runCommandMock).toHaveBeenCalledTimes(1)
  })

  it('requireConfirmation: false (the Retry button path) skips the prompt entirely', async () => {
    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    await ensureManagedChromiumDownloaded({ requireConfirmation: false })
    expect(__hasPendingInstallConfirmation()).toBe(false)
    expect(runCommandMock).toHaveBeenCalledTimes(1)
  })
})

describe('browserController — browser preference', () => {
  it('preference "chrome": launches with only the chrome channel, never probes msedge', async () => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('chrome')
    launchMock.mockResolvedValue(createFakeBrowser())

    const { browser } = await openHeadedBrowser()
    expect(browser).toBeTruthy()
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'chrome' })
  })

  it('preference "chrome": fails loudly instead of falling back to msedge or a download when chrome is unavailable', async () => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('chrome')
    launchMock.mockRejectedValue(new Error('chrome not found'))

    await expect(openHeadedBrowser()).rejects.toThrow(/System Chrome/)
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(runCommandMock).not.toHaveBeenCalled()
  })

  it('preference "msedge": launches with only the msedge channel', async () => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('msedge')
    launchMock.mockResolvedValue(createFakeBrowser())

    await openHeadedBrowser()
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'msedge' })
  })

  it('preference "managed": skips channel probing entirely and downloads/launches directly', async () => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('managed')
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel) throw new Error('should never probe a channel under "managed"')
      return createFakeBrowser()
    })
    existsSyncMock.mockReturnValue(false)
    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    const pending = openHeadedBrowser()
    await answerInstallPrompt(true)
    const { browser } = await pending
    expect(browser).toBeTruthy()
    expect(runCommandMock).toHaveBeenCalledTimes(1)
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'] })
  })
})

describe('browserController — resolved status', () => {
  it('is "unresolved" before any browser has been launched', () => {
    expect(getResolvedBrowserStatus()).toEqual({ packaged: false, kind: 'unresolved', executablePath: null })
  })

  it('reports "dev-bundled" with the executable path once launched in dev mode', async () => {
    launchMock.mockResolvedValue(createFakeBrowser())
    await newHeadlessContext()
    expect(getResolvedBrowserStatus()).toEqual({
      packaged: false,
      kind: 'dev-bundled',
      executablePath: '/fake/path/to/chromium'
    })
  })

  it('reports the resolved channel (no path) once launched via a system browser channel', async () => {
    __setPackaged(true)
    launchMock.mockResolvedValue(createFakeBrowser())
    await openHeadedBrowser()
    expect(getResolvedBrowserStatus()).toEqual({ packaged: true, kind: 'chrome', executablePath: null })
  })

  it('reports "managed" with the executable path once resolved via a managed download', async () => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('managed')
    launchMock.mockResolvedValue(createFakeBrowser())
    existsSyncMock.mockReturnValue(true)
    await openHeadedBrowser()
    expect(getResolvedBrowserStatus()).toEqual({
      packaged: true,
      kind: 'managed',
      executablePath: '/fake/path/to/chromium'
    })
  })
})

describe('browserController — invalidateResolvedBrowser', () => {
  it('clears the cached resolution so the next launch re-resolves under the (new) preference', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel === 'chrome') return createFakeBrowser()
      throw new Error(`${String(opts.channel)} not found`)
    })

    await openHeadedBrowser()
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'chrome' })

    // A cached resolution alone wouldn't re-probe (see the earlier "reuses the cached
    // channel" test) — invalidating is what lets a preference change take effect live.
    invalidateResolvedBrowser()
    getBrowserPreferenceMock.mockReturnValue('msedge')
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel === 'msedge') return createFakeBrowser()
      throw new Error(`${String(opts.channel)} not found`)
    })

    await openHeadedBrowser()
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'msedge' })
  })
})

describe('browserController: attaching to a running browser', () => {
  const ENDPOINT = 'http://127.0.0.1:9222'

  function createFakePage(): {
    route: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    isClosed: () => boolean
  } {
    return { route: vi.fn().mockResolvedValue(undefined), on: vi.fn(), close: vi.fn().mockResolvedValue(undefined), isClosed: () => false }
  }

  function createFakeAttachedBrowser(options: { defaultContext?: boolean; pages?: number } = {}): {
    browser: {
      contexts: () => unknown[]
      version: () => string
      close: ReturnType<typeof vi.fn>
      isConnected: () => boolean
      newContext: ReturnType<typeof vi.fn>
      once: ReturnType<typeof vi.fn>
    }
    defaultContext: { newPage: ReturnType<typeof vi.fn>; route: ReturnType<typeof vi.fn>; pages: () => unknown[] }
    page: ReturnType<typeof createFakePage>
    /** Simulates the browser going away (Chrome quit, port turned off): flips isConnected and fires 'disconnected'. */
    drop: () => void
  } {
    const { defaultContext = true, pages = 3 } = options
    const page = createFakePage()
    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      route: vi.fn().mockResolvedValue(undefined),
      pages: () => Array.from({ length: pages }, () => ({}))
    }
    let connected = true
    const disconnectListeners: Array<() => void> = []
    const browser = {
      contexts: () => (defaultContext ? [context] : []),
      version: () => 'Chrome/131.0.6778.85',
      close: vi.fn().mockImplementation(async () => {
        connected = false
      }),
      isConnected: () => connected,
      newContext: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'disconnected') disconnectListeners.push(listener)
      })
    }
    return {
      browser,
      defaultContext: context,
      page,
      drop: () => {
        connected = false
        for (const listener of disconnectListeners.splice(0)) listener()
      }
    }
  }

  beforeEach(() => {
    getRemoteBrowserSettingsMock.mockReturnValue({ enabled: true, endpoint: ENDPOINT })
  })

  it('attaches over CDP instead of launching, and opens pages in the default (signed-in) profile', async () => {
    const fake = createFakeAttachedBrowser()
    connectOverCDPMock.mockResolvedValue(fake.browser)

    const headed = await openHeadedBrowser()
    expect(connectOverCDPMock).toHaveBeenCalledWith(ENDPOINT, { timeout: 120_000 })
    expect(launchMock).not.toHaveBeenCalled()
    expect(headed.browser).toBe(fake.browser)

    const page = await headed.newPage()
    expect(page).toBe(fake.page)
    expect(fake.defaultContext.newPage).toHaveBeenCalledOnce()
    // Never a fresh context: that would be a signed-out incognito profile, defeating the point.
    expect(fake.browser.newContext).not.toHaveBeenCalled()
  })

  it('guards the pages it opens at page level and leaves the user\'s context alone', async () => {
    const fake = createFakeAttachedBrowser()
    connectOverCDPMock.mockResolvedValue(fake.browser)

    const headed = await openHeadedBrowser()
    await headed.newPage()
    expect(fake.page.route).toHaveBeenCalledWith('**/*', expect.any(Function))
    expect(fake.defaultContext.route).not.toHaveBeenCalled()
  })

  it('skips the guard entirely when local addresses are allowed', async () => {
    getAllowLocalAddressesMock.mockReturnValue(true)
    const fake = createFakeAttachedBrowser()
    connectOverCDPMock.mockResolvedValue(fake.browser)

    const headed = await openHeadedBrowser()
    await headed.newPage()
    expect(fake.page.route).not.toHaveBeenCalled()
  })

  it('closes a page it could not guard rather than handing it out unguarded', async () => {
    const fake = createFakeAttachedBrowser()
    fake.page.route.mockRejectedValue(new Error('target closed'))
    connectOverCDPMock.mockResolvedValue(fake.browser)

    const headed = await openHeadedBrowser()
    await expect(headed.newPage()).rejects.toThrow('target closed')
    expect(fake.page.close).toHaveBeenCalledOnce()
  })

  it('fails with a pointer to the setting when nothing is listening on the endpoint', async () => {
    connectOverCDPMock.mockRejectedValue(
      new Error('browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9222\nCall log:\n  - <ws preparing> retrieving websocket url')
    )
    await expect(openHeadedBrowser()).rejects.toThrow(
      `Couldn't attach to the browser at ${ENDPOINT} (browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9222). ` +
        'Make sure it is running with remote debugging enabled on that address, or turn off "Attach to a running browser" in Settings > Browser.'
    )
    expect(launchMock).not.toHaveBeenCalled()
  })

  it('disconnects and fails when the attached browser has no default profile', async () => {
    const fake = createFakeAttachedBrowser({ defaultContext: false })
    connectOverCDPMock.mockResolvedValue(fake.browser)

    await expect(openHeadedBrowser()).rejects.toThrow(`The browser at ${ENDPOINT} exposes no profile to attach to.`)
    expect(fake.browser.close).toHaveBeenCalledOnce()
  })

  it('does not touch the launch resolution: read-only headless work still launches its own browser', async () => {
    launchMock.mockResolvedValue(createFakeBrowser())
    await newHeadlessContext()
    expect(launchMock).toHaveBeenCalledWith({ headless: true })
    expect(connectOverCDPMock).not.toHaveBeenCalled()
  })

  it('launches normally when the setting is off, even with an endpoint stored', async () => {
    getRemoteBrowserSettingsMock.mockReturnValue({ enabled: false, endpoint: ENDPOINT })
    launchMock.mockResolvedValue(createFakeBrowser())
    await openHeadedBrowser()
    expect(launchMock).toHaveBeenCalledWith({ headless: false, args: ['--start-maximized'] })
    expect(connectOverCDPMock).not.toHaveBeenCalled()
  })

  describe('connection candidates', () => {
    const WS = 'ws://127.0.0.1:9222/devtools/browser/d2a53d02'

    it('tries the websocket path read from the profile folder before the address as typed', async () => {
      resolveCandidatesMock.mockResolvedValue([{ url: WS, profileDir: '/home/u/.config/google-chrome' }, { url: ENDPOINT }])
      const fake = createFakeAttachedBrowser()
      connectOverCDPMock.mockResolvedValue(fake.browser)

      await openHeadedBrowser()
      expect(resolveCandidatesMock).toHaveBeenCalledWith(ENDPOINT)
      expect(connectOverCDPMock).toHaveBeenCalledTimes(1)
      expect(connectOverCDPMock).toHaveBeenCalledWith(WS, { timeout: 120_000 })
    })

    it('falls back to the next candidate when the first refuses', async () => {
      resolveCandidatesMock.mockResolvedValue([{ url: WS, profileDir: '/p/stale' }, { url: ENDPOINT }])
      const fake = createFakeAttachedBrowser()
      connectOverCDPMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:9222')).mockResolvedValueOnce(fake.browser)

      const headed = await openHeadedBrowser()
      expect(headed.browser).toBe(fake.browser)
      expect(connectOverCDPMock).toHaveBeenNthCalledWith(1, WS, { timeout: 120_000 })
      expect(connectOverCDPMock).toHaveBeenNthCalledWith(2, ENDPOINT, { timeout: 120_000 })
    })

    it('reports the first candidate\'s failure when every candidate fails, not the HTTP root\'s 404', async () => {
      resolveCandidatesMock.mockResolvedValue([{ url: WS, profileDir: '/p/chrome' }, { url: ENDPOINT }])
      connectOverCDPMock
        .mockRejectedValueOnce(new Error('browserType.connectOverCDP: Unexpected server response: 403'))
        .mockRejectedValueOnce(new Error('browserType.connectOverCDP: Unexpected status 404 when connecting to http://127.0.0.1:9222/json/version/.'))

      await expect(openHeadedBrowser()).rejects.toThrow(
        `Couldn't attach to the browser at ${ENDPOINT} (browserType.connectOverCDP: Unexpected server response: 403).`
      )
      expect(connectOverCDPMock).toHaveBeenCalledTimes(2)
    })

    it('rewords a handshake timeout as an unanswered permission prompt', async () => {
      connectOverCDPMock.mockRejectedValue(new Error('browserType.connectOverCDP: Timeout 120000ms exceeded.\nCall log:\n  - <ws connecting>'))
      await expect(openHeadedBrowser()).rejects.toThrow(
        `Couldn't attach to the browser at ${ENDPOINT} (the browser did not accept the connection within 120s; ` +
          'if it showed a prompt asking to allow remote debugging, it was not accepted in time).'
      )
    })

    it('tells the renderer to point at the permission prompt once a session attach has been pending a while', async () => {
      vi.useFakeTimers()
      try {
        const fake = createFakeAttachedBrowser()
        let finish: (() => void) | undefined
        connectOverCDPMock.mockImplementation(
          () => new Promise((resolve) => {
            finish = () => resolve(fake.browser)
          })
        )
        const pending = openHeadedBrowser()
        await vi.advanceTimersByTimeAsync(1_499)
        expect(broadcastStatusMock).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(broadcastStatusMock).toHaveBeenCalledWith({ status: 'attaching', endpoint: ENDPOINT })
        finish!()
        await pending
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not announce when the browser answers at once, nor for the settings page\'s own test', async () => {
      vi.useFakeTimers()
      try {
        const fake = createFakeAttachedBrowser()
        connectOverCDPMock.mockResolvedValue(fake.browser)
        await openHeadedBrowser()
        await vi.advanceTimersByTimeAsync(5_000)
        expect(broadcastStatusMock).not.toHaveBeenCalled()

        // Force the test's probe to connect afresh; otherwise it would reuse the session above.
        await disconnectAttachedBrowser()
        let finish: (() => void) | undefined
        connectOverCDPMock.mockImplementation(
          () => new Promise((resolve) => {
            finish = () => resolve(fake.browser)
          })
        )
        const probe = probeRemoteBrowser(ENDPOINT)
        await vi.advanceTimersByTimeAsync(5_000)
        expect(broadcastStatusMock).not.toHaveBeenCalled()
        finish!()
        await probe
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // Chrome 144+'s switch asks permission per connection, with no way to remember the
  // answer, so the app holds one connection for the whole run instead of one per job.
  describe('shared connection', () => {
    it('connects once and reuses it for later sessions, closing only the tab in between', async () => {
      const fake = createFakeAttachedBrowser()
      connectOverCDPMock.mockResolvedValue(fake.browser)

      const first = await openHeadedBrowser()
      const page = await first.newPage()
      await first.close(page)
      expect(fake.page.close).toHaveBeenCalledOnce()
      expect(fake.browser.close).not.toHaveBeenCalled()

      const second = await openHeadedBrowser()
      expect(second.browser).toBe(fake.browser)
      expect(connectOverCDPMock).toHaveBeenCalledTimes(1)
    })

    it('shares the connection between the settings test and the next session', async () => {
      const fake = createFakeAttachedBrowser()
      connectOverCDPMock.mockResolvedValue(fake.browser)

      await probeRemoteBrowser(ENDPOINT)
      const headed = await openHeadedBrowser()
      expect(headed.browser).toBe(fake.browser)
      expect(connectOverCDPMock).toHaveBeenCalledTimes(1)
      expect(fake.browser.close).not.toHaveBeenCalled()
    })

    it('reconnects after the browser goes away', async () => {
      const first = createFakeAttachedBrowser()
      const second = createFakeAttachedBrowser()
      connectOverCDPMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser)

      await openHeadedBrowser()
      first.drop()
      const headed = await openHeadedBrowser()
      expect(headed.browser).toBe(second.browser)
      expect(connectOverCDPMock).toHaveBeenCalledTimes(2)
    })

    it('replaces the connection when the endpoint changes', async () => {
      const first = createFakeAttachedBrowser()
      const second = createFakeAttachedBrowser()
      connectOverCDPMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser)

      await openHeadedBrowser()
      getRemoteBrowserSettingsMock.mockReturnValue({ enabled: true, endpoint: 'http://127.0.0.1:9333' })
      const headed = await openHeadedBrowser()
      expect(first.browser.close).toHaveBeenCalledOnce()
      expect(headed.browser).toBe(second.browser)
      expect(connectOverCDPMock).toHaveBeenLastCalledWith('http://127.0.0.1:9333', { timeout: 120_000 })
    })

    it('raises one prompt for two sessions that start together', async () => {
      const fake = createFakeAttachedBrowser()
      let finish: (() => void) | undefined
      connectOverCDPMock.mockImplementation(
        () => new Promise((resolve) => {
          finish = () => resolve(fake.browser)
        })
      )
      const a = openHeadedBrowser()
      const b = openHeadedBrowser()
      await vi.waitFor(() => expect(finish).toBeDefined())
      finish!()
      const [headedA, headedB] = await Promise.all([a, b])
      expect(headedA.browser).toBe(headedB.browser)
      expect(connectOverCDPMock).toHaveBeenCalledTimes(1)
    })

    it('disconnectAttachedBrowser drops it so the next session connects (and prompts) afresh', async () => {
      const first = createFakeAttachedBrowser()
      const second = createFakeAttachedBrowser()
      connectOverCDPMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser)

      await openHeadedBrowser()
      await disconnectAttachedBrowser()
      expect(first.browser.close).toHaveBeenCalledOnce()
      await disconnectAttachedBrowser() // nothing held: a no-op, not a second close
      expect(first.browser.close).toHaveBeenCalledOnce()

      const headed = await openHeadedBrowser()
      expect(headed.browser).toBe(second.browser)
    })

    it('closeAllBrowsers drops the attached connection at quit', async () => {
      const fake = createFakeAttachedBrowser()
      connectOverCDPMock.mockResolvedValue(fake.browser)
      await openHeadedBrowser()
      await closeAllBrowsers()
      expect(fake.browser.close).toHaveBeenCalledOnce()
    })

    it('a launched (not attached) session still closes its whole window', async () => {
      getRemoteBrowserSettingsMock.mockReturnValue({ enabled: false, endpoint: ENDPOINT })
      const closeMock = vi.fn().mockResolvedValue(undefined)
      const page = createFakePage()
      launchMock.mockResolvedValue({
        isConnected: () => true,
        newContext: async () => ({ route: vi.fn(), newPage: async () => page }),
        close: closeMock
      })
      const headed = await openHeadedBrowser()
      await headed.close(await headed.newPage())
      expect(page.close).toHaveBeenCalledOnce()
      expect(closeMock).toHaveBeenCalledOnce()
    })
  })

  describe('probeRemoteBrowser', () => {
    it('reports the version and open tab count without opening anything', async () => {
      const fake = createFakeAttachedBrowser({ pages: 5 })
      connectOverCDPMock.mockResolvedValue(fake.browser)

      await expect(probeRemoteBrowser(ENDPOINT)).resolves.toEqual({
        browserVersion: 'Chrome/131.0.6778.85',
        hasDefaultContext: true,
        pageCount: 5,
        profileDir: null
      })
      expect(connectOverCDPMock).toHaveBeenCalledWith(ENDPOINT, { timeout: 120_000 })
      expect(fake.defaultContext.newPage).not.toHaveBeenCalled()
    })

    it('names the profile folder whose file supplied the websocket path', async () => {
      resolveCandidatesMock.mockResolvedValue([
        { url: 'ws://127.0.0.1:9222/devtools/browser/x', profileDir: '/home/u/.config/google-chrome' },
        { url: ENDPOINT }
      ])
      const fake = createFakeAttachedBrowser()
      connectOverCDPMock.mockResolvedValue(fake.browser)
      await expect(probeRemoteBrowser(ENDPOINT)).resolves.toMatchObject({ profileDir: '/home/u/.config/google-chrome' })
    })

    it('reports a browser with no default profile rather than failing, so the user can see why a session would', async () => {
      const fake = createFakeAttachedBrowser({ defaultContext: false })
      connectOverCDPMock.mockResolvedValue(fake.browser)

      await expect(probeRemoteBrowser(ENDPOINT)).resolves.toEqual({
        browserVersion: 'Chrome/131.0.6778.85',
        hasDefaultContext: false,
        pageCount: 0,
        profileDir: null
      })
    })

    it('surfaces an unreachable endpoint with the same wording a real session would', async () => {
      connectOverCDPMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9222'))
      await expect(probeRemoteBrowser(ENDPOINT)).rejects.toThrow(
        `Couldn't attach to the browser at ${ENDPOINT} (connect ECONNREFUSED 127.0.0.1:9222).`
      )
    })

    it('surfaces a failure reading the browser after connecting', async () => {
      const fake = createFakeAttachedBrowser()
      fake.browser.contexts = () => {
        throw new Error('connection dropped')
      }
      connectOverCDPMock.mockResolvedValue(fake.browser)
      await expect(probeRemoteBrowser(ENDPOINT)).rejects.toThrow('connection dropped')
    })
  })
})
