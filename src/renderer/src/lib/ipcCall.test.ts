import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callIpc } from './ipcCall'

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('callIpc', () => {
  it('returns what the call resolved to', async () => {
    await expect(callIpc('jobs.list', async () => ({ jobs: [], total: 3 }), { jobs: [], total: 0 })).resolves.toEqual({
      jobs: [],
      total: 3
    })
  })

  it('does not log when the call succeeds', async () => {
    await callIpc('jobs.list', async () => 'ok', 'fallback')
    expect(consoleError).not.toHaveBeenCalled()
  })

  // The case this exists for: `profile.get` throws by design when the OS
  // keyring is unavailable, and the unhandled rejection used to skip the
  // `set({ loading: false })` after it, leaving a skeleton forever.
  it('returns the fallback when the call rejects', async () => {
    const fallback = { profile: null, documents: [] }
    await expect(
      callIpc('profile.get', async () => {
        throw new Error('encrypted storage is unavailable')
      }, fallback)
    ).resolves.toBe(fallback)
  })

  it('logs the rejection with its context, so the console says which call failed', async () => {
    const error = new Error('keyring unavailable')
    await callIpc('profile.get', async () => Promise.reject(error), null)
    expect(consoleError).toHaveBeenCalledWith('IPC call failed: profile.get', error)
  })

  it('catches a synchronous throw from the call itself, not just a rejected promise', async () => {
    await expect(
      callIpc(
        'jobs.list',
        () => {
          throw new Error('window.api was not injected')
        },
        'fallback'
      )
    ).resolves.toBe('fallback')
  })

  it('passes a falsy fallback through as-is rather than treating it as absent', async () => {
    await expect(callIpc('x', async () => Promise.reject(new Error('no')), null)).resolves.toBeNull()
    await expect(callIpc('x', async () => Promise.reject(new Error('no')), 0)).resolves.toBe(0)
    await expect(callIpc('x', async () => Promise.reject(new Error('no')), '')).resolves.toBe('')
    await expect(callIpc('x', async () => Promise.reject(new Error('no')), false)).resolves.toBe(false)
  })

  it('survives a rejection with a non-Error value', async () => {
    await expect(callIpc('x', async () => Promise.reject('a string'), 'fallback')).resolves.toBe('fallback')
    expect(consoleError).toHaveBeenCalledWith('IPC call failed: x', 'a string')
  })
})
