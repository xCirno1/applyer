// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppInfo } from '@shared/types/ipcEvents'
import { loadAppInfo, __resetAppInfoCache } from './useAppInfo'

const getInfoMock = vi.fn()

const DEV_INFO: AppInfo = {
  version: '0.1.0',
  isDevBuild: true,
  userDataDir: '/home/someone/.config/applyer-dev'
}

beforeEach(() => {
  __resetAppInfoCache()
  getInfoMock.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { app: { getInfo: getInfoMock } }
  })
})

describe('loadAppInfo', () => {
  it('returns the info from the main process', async () => {
    getInfoMock.mockResolvedValue(DEV_INFO)
    await expect(loadAppInfo()).resolves.toEqual(DEV_INFO)
  })

  it('fetches once no matter how many consumers ask', async () => {
    getInfoMock.mockResolvedValue(DEV_INFO)

    const [first, second] = await Promise.all([loadAppInfo(), loadAppInfo()])

    expect(getInfoMock).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it.each([
    ['null', null],
    ['a non-object', 'nope'],
    ['a missing version', { isDevBuild: true, userDataDir: '/tmp/x' }],
    ['a non-boolean isDevBuild', { version: '1', isDevBuild: 'yes', userDataDir: '/tmp/x' }],
    ['a missing userDataDir', { version: '1', isDevBuild: false }]
  ])('rejects %s payload rather than handing it to the UI', async (_label, payload) => {
    getInfoMock.mockResolvedValue(payload)
    await expect(loadAppInfo()).rejects.toThrow(/Malformed app info/)
  })

  it('retries on the next call after a failure instead of caching the rejection', async () => {
    getInfoMock.mockRejectedValueOnce(new Error('ipc down'))
    await expect(loadAppInfo()).rejects.toThrow('ipc down')

    getInfoMock.mockResolvedValue(DEV_INFO)
    await expect(loadAppInfo()).resolves.toEqual(DEV_INFO)
    expect(getInfoMock).toHaveBeenCalledTimes(2)
  })

  it('retries after a malformed payload too', async () => {
    getInfoMock.mockResolvedValueOnce({})
    await expect(loadAppInfo()).rejects.toThrow(/Malformed app info/)

    getInfoMock.mockResolvedValue(DEV_INFO)
    await expect(loadAppInfo()).resolves.toEqual(DEV_INFO)
  })
})
