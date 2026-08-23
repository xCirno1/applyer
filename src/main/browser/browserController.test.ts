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

import {
  newHeadlessContext,
  launchHeadedContext,
  __resetBrowserControllerForTests
} from './browserController'

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
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, channel: 'chrome' })

    // Even if chrome would now fail, a cached resolution shouldn't re-probe other channels.
    launchMock.mockRejectedValueOnce(new Error('chrome not found this time'))
    await expect(launchHeadedContext()).rejects.toThrow('chrome not found this time')
    expect(launchMock).toHaveBeenCalledTimes(2)
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false, channel: 'chrome' })
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
    expect(launchMock).toHaveBeenNthCalledWith(1, { headless: false, channel: 'chrome' })
    expect(launchMock).toHaveBeenNthCalledWith(2, { headless: false, channel: 'msedge' })
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
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false })
  })

  it('packaged: both channels fail and not yet downloaded — downloads then launches with no channel', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel) throw new Error(`${opts.channel} not found`)
      return createFakeBrowser()
    })
    existsSyncMock.mockReturnValue(false)
    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    const { browser } = await launchHeadedContext()
    expect(browser).toBeTruthy()
    expect(runCommandMock).toHaveBeenCalledTimes(1)
    const [, args] = runCommandMock.mock.calls[0] as [string, string[]]
    expect(args).toContain('install')
    expect(args).toContain('chromium')
    expect(launchMock).toHaveBeenLastCalledWith({ headless: false })
  })

  it('packaged: a failed download resets state so a later call retries', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel) throw new Error(`${opts.channel} not found`)
      return createFakeBrowser()
    })
    existsSyncMock.mockReturnValue(false)
    runCommandMock.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'network error' })

    await expect(launchHeadedContext()).rejects.toThrow(/network error/)
    expect(runCommandMock).toHaveBeenCalledTimes(1)

    runCommandMock.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    const { browser } = await launchHeadedContext()
    expect(browser).toBeTruthy()
    expect(runCommandMock).toHaveBeenCalledTimes(2)
  })

  it('packaged: concurrent callers during an in-flight download share one download, not two', async () => {
    __setPackaged(true)
    launchMock.mockImplementation(async (opts: { channel?: string }) => {
      if (opts.channel) throw new Error(`${opts.channel} not found`)
      return createFakeBrowser()
    })
    existsSyncMock.mockReturnValue(false)
    runCommandMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    const [r1, r2] = await Promise.all([launchHeadedContext(), launchHeadedContext()])
    expect(r1.browser).toBeTruthy()
    expect(r2.browser).toBeTruthy()
    expect(runCommandMock).toHaveBeenCalledTimes(1)
  })
})
