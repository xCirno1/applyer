import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Page } from 'playwright'

const mocks = vi.hoisted(() => ({
  newHeadlessContext: vi.fn(),
  detectCaptcha: vi.fn(),
  searchThroughChallenge: vi.fn(),
  getSearchChallengeFallback: vi.fn()
}))

vi.mock('./browserController', () => ({ newHeadlessContext: mocks.newHeadlessContext }))
vi.mock('./captchaDetector', () => ({ detectCaptcha: mocks.detectCaptcha }))
vi.mock('./searchChallenge', () => ({ searchThroughChallenge: mocks.searchThroughChallenge }))
vi.mock('../db/repositories/settingsRepository', () => ({
  getSearchChallengeFallback: mocks.getSearchChallengeFallback
}))
vi.mock('../logger', () => ({ appLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { readSearchPage } from './searchPage'

function headless(): { page: Page; close: ReturnType<typeof vi.fn>; goto: ReturnType<typeof vi.fn>; waitForSelector: ReturnType<typeof vi.fn> } {
  const goto = vi.fn().mockResolvedValue(null)
  const waitForSelector = vi.fn().mockResolvedValue(null)
  const page = { goto, waitForSelector } as unknown as Page
  const close = vi.fn().mockResolvedValue(undefined)
  mocks.newHeadlessContext.mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page), close })
  return { page, close, goto, waitForSelector }
}

const spec = {
  source: 'seek' as const,
  host: 'www.seek.com.au',
  url: 'https://www.seek.com.au/jobs?keywords=intern',
  waitFor: 'article[data-automation]',
  read: vi.fn()
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.getSearchChallengeFallback.mockReturnValue(true)
  spec.read.mockReset().mockResolvedValue(['card'])
})

describe('readSearchPage', () => {
  it('reads the headless page when nothing blocks it and closes the context', async () => {
    const h = headless()
    mocks.detectCaptcha.mockResolvedValue({ blocked: false })
    await expect(readSearchPage(spec)).resolves.toEqual({ status: 'ok', value: ['card'] })
    expect(h.goto).toHaveBeenCalledWith(spec.url, expect.objectContaining({ waitUntil: 'domcontentloaded' }))
    expect(h.waitForSelector).toHaveBeenCalledWith(spec.waitFor, expect.anything())
    expect(spec.read).toHaveBeenCalledWith(h.page)
    expect(h.close).toHaveBeenCalled()
    expect(mocks.searchThroughChallenge).not.toHaveBeenCalled()
  })

  it('retries a challenged search in the application browser when the fallback is on', async () => {
    const h = headless()
    mocks.detectCaptcha.mockResolvedValue({ blocked: true, reason: 'challenge_text' })
    mocks.searchThroughChallenge.mockResolvedValue({ status: 'ok', value: ['visible card'] })
    await expect(readSearchPage(spec)).resolves.toEqual({ status: 'ok', value: ['visible card'] })
    // The headless context is gone before the visible window opens.
    expect(h.close).toHaveBeenCalled()
    expect(mocks.searchThroughChallenge).toHaveBeenCalledWith(spec)
    expect(spec.read).not.toHaveBeenCalled()
  })

  it('reports blocked without a retry when the fallback is off', async () => {
    headless()
    mocks.getSearchChallengeFallback.mockReturnValue(false)
    mocks.detectCaptcha.mockResolvedValue({ blocked: true, reason: 'challenge_iframe' })
    await expect(readSearchPage(spec)).resolves.toEqual({
      status: 'blocked',
      warning: 'seek: blocked by a verification challenge on www.seek.com.au (challenge_iframe)'
    })
    expect(mocks.searchThroughChallenge).not.toHaveBeenCalled()
  })

  it('passes a blocked retry through as blocked', async () => {
    headless()
    mocks.detectCaptcha.mockResolvedValue({ blocked: true, reason: 'challenge_text' })
    mocks.searchThroughChallenge.mockResolvedValue({ status: 'blocked', warning: 'seek: still blocked' })
    await expect(readSearchPage(spec)).resolves.toEqual({ status: 'blocked', warning: 'seek: still blocked' })
  })

  it('reports blocked, naming the cause, when the application browser cannot be opened', async () => {
    headless()
    mocks.detectCaptcha.mockResolvedValue({ blocked: true })
    mocks.searchThroughChallenge.mockRejectedValue(new Error('No usable browser found.\ncall log:\n  - launch'))
    const outcome = await readSearchPage(spec)
    expect(outcome.status).toBe('blocked')
    if (outcome.status === 'blocked') {
      expect(outcome.warning).toBe(
        'seek: blocked by a verification challenge on www.seek.com.au (captcha_verification); the application browser could not retry it (No usable browser found.)'
      )
    }
  })

  it('closes the headless context when navigation throws', async () => {
    const h = headless()
    h.goto.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'))
    await expect(readSearchPage(spec)).rejects.toThrow('ERR_NAME_NOT_RESOLVED')
    expect(h.close).toHaveBeenCalled()
  })
})
