import { describe, it, expect, vi, beforeEach } from 'vitest'
import { __setPackaged, __resetElectronMock } from '../../../test/mocks/electron'

const launchMock = vi.fn()
const executablePathMock = vi.fn()

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
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
vi.mock('../db/repositories/settingsRepository', () => ({
  getBrowserPreference: (...args: unknown[]) => getBrowserPreferenceMock(...args)
}))

import {
  newHeadlessContext,
  launchHeadedContext,
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
    newContext: async () => ({}),
    close: async () => {}
  }
}

beforeEach(() => {
  __resetElectronMock()
  __resetBrowserControllerForTests()
  launchMock.mockReset()
  executablePathMock.mockReset().mockReturnValue('/fake/path/to/chromium')
  runCommandMock.mockReset()
  existsSyncMock.mockReset()
  getBrowserPreferenceMock.mockReset().mockReturnValue('auto')
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
    const first = await launchHeadedContext()
    expect(first.browser).toBeTruthy()
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'chrome' })

    // Even if chrome would now fail, a cached resolution shouldn't re-probe other channels.
    launchMock.mockRejectedValueOnce(new Error('chrome not found this time'))
    await expect(launchHeadedContext()).rejects.toThrow('chrome not found this time')
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
    const { browser } = await launchHeadedContext()
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

    const { browser } = await launchHeadedContext()
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

    const pending = launchHeadedContext()
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

    const firstAttempt = launchHeadedContext()
    await answerInstallPrompt(true)
    await expect(firstAttempt).rejects.toThrow(/network error/)
    expect(runCommandMock).toHaveBeenCalledTimes(1)

    runCommandMock.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    const secondAttempt = launchHeadedContext()
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

    const promise1 = launchHeadedContext()
    const promise2 = launchHeadedContext()
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

    const pending = launchHeadedContext()
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

    const pending = launchHeadedContext()
    await answerInstallPrompt(false)
    await expect(pending).rejects.toThrow(/declined/)
    expect(runCommandMock).not.toHaveBeenCalled()

    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    const retryPending = launchHeadedContext()
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

    const { browser } = await launchHeadedContext()
    expect(browser).toBeTruthy()
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'chrome' })
  })

  it('preference "chrome": fails loudly instead of falling back to msedge or a download when chrome is unavailable', async () => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('chrome')
    launchMock.mockRejectedValue(new Error('chrome not found'))

    await expect(launchHeadedContext()).rejects.toThrow(/System Chrome/)
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(runCommandMock).not.toHaveBeenCalled()
  })

  it('preference "msedge": launches with only the msedge channel', async () => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('msedge')
    launchMock.mockResolvedValue(createFakeBrowser())

    await launchHeadedContext()
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

    const pending = launchHeadedContext()
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
    await launchHeadedContext()
    expect(getResolvedBrowserStatus()).toEqual({ packaged: true, kind: 'chrome', executablePath: null })
  })

  it('reports "managed" with the executable path once resolved via a managed download', async () => {
    __setPackaged(true)
    getBrowserPreferenceMock.mockReturnValue('managed')
    launchMock.mockResolvedValue(createFakeBrowser())
    existsSyncMock.mockReturnValue(true)
    await launchHeadedContext()
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

    await launchHeadedContext()
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'chrome' })

    // A cached resolution alone wouldn't re-probe (see the earlier "reuses the cached
    // channel" test) — invalidating is what lets a preference change take effect live.
    invalidateResolvedBrowser()
    getBrowserPreferenceMock.mockReturnValue('msedge')
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel === 'msedge') return createFakeBrowser()
      throw new Error(`${String(opts.channel)} not found`)
    })

    await launchHeadedContext()
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, args: ['--start-maximized'], channel: 'msedge' })
  })
})
